interface Config {
  supabaseUrl: string;
  serviceKey: string;
  githubToken: string;
  owner: string;
  repo: string;
}

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
}

class RateLimited extends Error {}

const ACTIVE = new Set(['queued', 'in_progress', 'requested', 'waiting', 'pending']);
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, ...headers, 'Content-Type': 'application/json' },
  });
}

// Web-standard handler kept separate from Deno startup for offline boundary tests.
export function createRefreshHandler(config: Config, http: typeof fetch = fetch) {
  const workflowUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/workflows/scrape_jobs.yml`;
  const githubHeaders = {
    Authorization: `Bearer ${config.githubToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Xphire-Job-Scout',
    'Content-Type': 'application/json',
  };
  const serviceHeaders = {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    'Content-Type': 'application/json',
  };

  async function rpc(name: string, signal: AbortSignal, body: object = {}) {
    const response = await http(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: serviceHeaders, body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error('Refresh lease unavailable');
    return response.status === 204 ? null : await response.json();
  }

  function parseRuns(value: unknown): WorkflowRun[] {
    if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid workflow status');
    return value.map((run) => {
      if (!run || !Number.isSafeInteger(run.id) || run.id <= 0 || typeof run.status !== 'string'
        || (run.conclusion !== null && typeof run.conclusion !== 'string')) {
        throw new Error('Invalid workflow status');
      }
      // Cache only the public status projection, never GitHub's full payload.
      return { id: run.id, status: run.status, conclusion: run.conclusion };
    });
  }

  async function runs(signal: AbortSignal): Promise<WorkflowRun[]> {
    const admitted = await rpc('reserve_job_refresh_budget', signal, { p_kind: 'github' });
    if (admitted === false) throw new RateLimited();
    if (admitted !== true) throw new Error('Invalid GitHub budget');
    const response = await http(`${workflowUrl}/runs?per_page=100`, {
      headers: githubHeaders, signal,
    });
    if (!response.ok) throw new Error('Workflow status unavailable');
    const body = await response.json();
    return parseRuns(body.workflow_runs);
  }

  let statusInFlight: Promise<[WorkflowRun[], boolean]> | null = null;
  function cachedStatus(signal: AbortSignal): Promise<[WorkflowRun[], boolean]> {
    if (statusInFlight) return statusInFlight;
    statusInFlight = (async (): Promise<[WorkflowRun[], boolean]> => {
      const token = crypto.randomUUID();
      const snapshot = await rpc('claim_job_refresh_status', signal, { p_token: token });
      if (!snapshot || typeof snapshot.pending !== 'boolean') throw new Error('Invalid refresh status');
      if (snapshot.kind === 'cached') return [parseRuns(snapshot.workflow_runs), snapshot.pending];
      if (snapshot.kind !== 'fetch') throw new Error('Refresh status is being checked');
      const workflowRuns = await runs(signal);
      const pending = await rpc('finish_job_refresh_status', signal, { p_token: token, p_runs: workflowRuns });
      if (typeof pending !== 'boolean') throw new Error('Invalid refresh lease');
      return [workflowRuns, pending];
    })().finally(() => { statusInFlight = null; });
    return statusInFlight;
  }

  function running(run?: WorkflowRun, previous?: WorkflowRun) {
    return json({ status: 'running', estimatedMinutes: 15,
      ...(run ? { runId: run.id } : previous ? { previousRunId: previous.id } : {}) });
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'GET' && req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }
    try {
      // Bound the entire request, not each of its sequential upstream calls.
      const signal = AbortSignal.timeout(12_000);
      if (!config.supabaseUrl || !config.serviceKey || !config.githubToken) {
        throw new Error('Refresh service is not configured');
      }
      const authorization = req.headers.get('Authorization') ?? '';
      if (req.method === 'POST' && !authorization?.match(/^Bearer\s+\S+$/i)) {
        return json({ error: 'Sign in to refresh jobs' }, 401);
      }
      // A database-backed global budget applies across Edge Function instances.
      // Do not trust client-supplied IP headers as a rate-limit identity.
      const admitted = await rpc('reserve_job_refresh_budget', signal, { p_kind: 'request' });
      if (admitted === false) {
        return json({ error: 'Too many refresh requests. Please try again shortly.' }, 429, { 'Retry-After': '60' });
      }
      if (admitted !== true) throw new Error('Invalid refresh budget');
      if (req.method === 'POST') {
        // Do not merely decode a token or trust gateway verify_jwt: GET is public.
        const userResponse = await http(`${config.supabaseUrl}/auth/v1/user`, {
          headers: { apikey: config.serviceKey, Authorization: authorization },
          signal,
        });
        if (userResponse.status === 401 || userResponse.status === 403) {
          return json({ error: 'Sign in to refresh jobs' }, 401);
        }
        if (!userResponse.ok) throw new Error('Authentication unavailable');
        const user = await userResponse.json();
        if (!user.id || user.is_anonymous) return json({ error: 'Sign in to refresh jobs' }, 401);
      }

      const [workflowRuns, pending] = req.method === 'GET'
        ? await cachedStatus(signal)
        : await Promise.all([runs(signal), rpc('job_refresh_pending', signal)]);
      if (typeof pending !== 'boolean') throw new Error('Invalid refresh lease');
      const active = workflowRuns.find((run) => ACTIVE.has(run.status));
      if (active || pending) return running(active, workflowRuns[0]);

      if (req.method === 'GET') {
        const latest = workflowRuns[0];
        return json({
          status: !latest ? 'idle' : latest.status === 'completed'
            ? latest.conclusion === 'success' ? 'completed' : 'failed' : 'idle',
          estimatedMinutes: 15,
          ...(latest ? { runId: latest.id } : {}),
        });
      }

      const token = crypto.randomUUID();
      const acquired = await rpc('acquire_job_refresh_lease', signal, { p_token: token });
      if (acquired === false) return running(undefined, workflowRuns[0]);
      if (acquired !== true) throw new Error('Invalid refresh lease');

      // Check again after acquiring: a scheduled run may have started meanwhile.
      let checkedRuns: WorkflowRun[];
      try {
        checkedRuns = await runs(signal);
      } catch (error) {
        // This denial is known to precede any dispatch, unlike an ambiguous timeout.
        if (error instanceof RateLimited) await rpc('release_job_refresh_lease', signal, { p_token: token });
        throw error;
      }
      const existing = checkedRuns.find((run) => ACTIVE.has(run.status));
      if (existing) {
        await rpc('release_job_refresh_lease', signal, { p_token: token });
        return running(existing);
      }
      const response = await http(`${workflowUrl}/dispatches`, {
        method: 'POST', headers: githubHeaders,
        body: JSON.stringify({ ref: 'main' }), signal,
      });
      if (!response.ok) {
        await rpc('release_job_refresh_lease', signal, { p_token: token });
        throw new Error('Workflow dispatch rejected');
      }
      // Keep the lease until expiry: GitHub may not expose the new run immediately.
      // On a network timeout it is also retained, since dispatch may have succeeded.
      return json({ status: 'started', estimatedMinutes: 15,
        ...(workflowRuns[0] ? { previousRunId: workflowRuns[0].id } : {}) }, 202);
    } catch (error) {
      if (error instanceof RateLimited) {
        return json({ error: 'Too many refresh requests. Please try again shortly.' }, 429, { 'Retry-After': '60' });
      }
      // Never return upstream payloads or configuration/secrets to the browser.
      return json({ error: 'Job refresh is temporarily unavailable. Please try again.' }, 503);
    }
  };
}
