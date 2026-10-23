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

const ACTIVE = new Set(['queued', 'in_progress', 'requested', 'waiting', 'pending']);
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
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

  async function runs(signal: AbortSignal): Promise<WorkflowRun[]> {
    const response = await http(`${workflowUrl}/runs?per_page=100`, {
      headers: githubHeaders, signal,
    });
    if (!response.ok) throw new Error('Workflow status unavailable');
    const body = await response.json();
    if (!Array.isArray(body.workflow_runs)) throw new Error('Invalid workflow status');
    return body.workflow_runs;
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
      if (req.method === 'POST') {
        const authorization = req.headers.get('Authorization');
        if (!authorization?.match(/^Bearer\s+\S+$/i)) {
          return json({ error: 'Sign in to refresh jobs' }, 401);
        }
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

      const [workflowRuns, pending] = await Promise.all([runs(signal), rpc('job_refresh_pending', signal)]);
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
      const existing = (await runs(signal)).find((run) => ACTIVE.has(run.status));
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
    } catch {
      // Never return upstream payloads or configuration/secrets to the browser.
      return json({ error: 'Job refresh is temporarily unavailable. Please try again.' }, 503);
    }
  };
}
