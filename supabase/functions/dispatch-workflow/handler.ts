const MAX_BODY_BYTES = 4 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

interface DispatchConfig {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  githubToken: string;
  owner: string;
  repo: string;
}

interface DispatchPayload {
  jobTitle: string;
  recipientEmail: string;
  freshersOnly: boolean;
  minStars: number;
}

function response(status: number, body: Record<string, unknown>, headers: Record<string, string> = corsHeaders): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function withinDeadline<T>(operation: Promise<T>, deadline: AbortSignal): Promise<T> {
  if (deadline.aborted) return Promise.reject(new Error('deadline exceeded'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('deadline exceeded'));
    deadline.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => deadline.removeEventListener('abort', onAbort));
  });
}

async function readBoundedBody(request: Request, deadline: AbortSignal): Promise<string | null> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await withinDeadline(reader.read(), deadline);
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function validatePayload(value: unknown): DispatchPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.jobTitle !== 'string' || body.jobTitle.trim().length === 0 || body.jobTitle.trim().length > 100) return null;
  if (typeof body.recipientEmail !== 'string' || body.recipientEmail.length > 255) return null;
  if (typeof body.freshersOnly !== 'boolean') return null;
  if (typeof body.minStars !== 'number' || !Number.isInteger(body.minStars) || body.minStars < 1 || body.minStars > 5) return null;
  return {
    jobTitle: body.jobTitle.trim(),
    recipientEmail: body.recipientEmail.trim(),
    freshersOnly: body.freshersOnly,
    minStars: body.minStars,
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function rpcValue(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) value = value[0];
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function createDispatchHandler(config: DispatchConfig, fetcher: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
    if (request.method !== 'POST') return response(405, { error: 'Method not allowed' }, { ...corsHeaders, Allow: 'POST, OPTIONS' });

    const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey || !UUID_PATTERN.test(idempotencyKey)) return response(400, { error: 'A valid Idempotency-Key UUID is required' });

    let bodyText: string | null;
    try {
      bodyText = await readBoundedBody(request, deadline);
    } catch {
      return deadline.aborted
        ? response(503, { error: 'Request deadline exceeded' })
        : response(400, { error: 'Invalid request body' });
    }
    if (bodyText === null) return response(413, { error: 'Request body exceeds 4 KB' });

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return response(400, { error: 'Invalid JSON body' });
    }
    const payload = validatePayload(body);
    if (!payload) return response(400, { error: 'Invalid workflow parameters' });

    const authorization = request.headers.get('Authorization');
    const tokenMatch = authorization?.match(/^Bearer\s+(\S+)$/i);
    if (!tokenMatch) return response(401, { error: 'Authentication required' });

    const supabaseHeaders = { apikey: config.anonKey, Authorization: `Bearer ${tokenMatch[1]}` };
    let authResponse: Response;
    try {
      authResponse = await fetcher(`${config.supabaseUrl}/auth/v1/user`, {
        method: 'GET', headers: supabaseHeaders, signal: deadline,
      });
    } catch {
      return response(503, { error: 'Authentication service unavailable' });
    }
    if (authResponse.status === 401 || authResponse.status === 403) return response(401, { error: 'Invalid or expired authentication' });
    if (!authResponse.ok) return response(503, { error: 'Authentication service unavailable' });

    let user: Record<string, unknown>;
    try {
      user = await authResponse.json() as Record<string, unknown>;
    } catch {
      return response(503, { error: 'Authentication service unavailable' });
    }
    if (!user.id || typeof user.email !== 'string' || !user.email_confirmed_at || user.is_anonymous === true) {
      return response(403, { error: 'A verified, non-anonymous account is required' });
    }
    const accountEmail = user.email.trim();
    if (!accountEmail || payload.recipientEmail.toLowerCase() !== accountEmail.toLowerCase()) {
      return response(403, { error: 'Recipient must match the verified account email' });
    }

    const normalizedPayload = {
      jobTitle: payload.jobTitle,
      recipientEmail: accountEmail,
      freshersOnly: payload.freshersOnly,
      minStars: payload.minStars,
    };
    const payloadHash = await sha256(JSON.stringify(normalizedPayload));
    const serviceHeaders = {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
    };
    let reservationResponse: Response;
    try {
      reservationResponse = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/acquire_email_dispatch`, {
        method: 'POST', headers: serviceHeaders, signal: deadline,
        body: JSON.stringify({ p_user_id: user.id, p_idempotency_key: idempotencyKey, p_payload_hash: payloadHash }),
      });
    } catch {
      return response(503, { error: 'Dispatch reservation unavailable' });
    }
    if (!reservationResponse.ok) return response(503, { error: 'Dispatch reservation unavailable' });
    let reservation: Record<string, unknown> | null;
    try {
      reservation = rpcValue(await reservationResponse.json());
    } catch {
      return response(503, { error: 'Dispatch reservation unavailable' });
    }
    switch (reservation?.status) {
      case 'conflict': return response(409, { error: 'Idempotency key was already used with different parameters' });
      case 'quota': return response(429, { error: 'Dispatch limit reached; try again later' });
      case 'accepted': return response(202, { status: 'accepted', message: 'GitHub accepted the workflow dispatch; email delivery is not yet confirmed' });
      case 'reserved': return response(202, { status: 'pending', message: 'Dispatch outcome is pending; retry with the same idempotency key' });
      case 'acquired': break;
      default: return response(503, { error: 'Dispatch reservation unavailable' });
    }

    let githubResponse: Response;
    try {
      githubResponse = await fetcher(`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/workflows/email_jobs.yml/dispatches`, {
        method: 'POST', signal: deadline,
        headers: {
          Accept: 'application/vnd.github+json', Authorization: `Bearer ${config.githubToken}`,
          'User-Agent': 'Xphire-Job-Scout', 'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            job_title: normalizedPayload.jobTitle,
            recipient_email: normalizedPayload.recipientEmail,
            freshers_only: String(normalizedPayload.freshersOnly),
            min_stars: String(normalizedPayload.minStars),
          },
        }),
      });
    } catch {
      // The provider may have accepted the request before the connection failed. Keep reservation.
      return response(503, { error: 'Dispatch outcome is unknown; retry with the same idempotency key' });
    }

    if (githubResponse.status >= 200 && githubResponse.status < 300) {
      try {
        await fetcher(`${config.supabaseUrl}/rest/v1/rpc/complete_email_dispatch`, {
          method: 'POST', headers: serviceHeaders, signal: deadline,
          body: JSON.stringify({ p_user_id: user.id, p_idempotency_key: idempotencyKey, p_status: 'accepted' }),
        });
      } catch {
        // Keep the reservation on persistence failure; it still prevents a duplicate dispatch.
      }
      return response(202, { status: 'accepted', message: 'GitHub accepted the workflow dispatch; email delivery is not yet confirmed' });
    }

    if (githubResponse.status >= 400 && githubResponse.status < 500) {
      try {
        const completion = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/complete_email_dispatch`, {
          method: 'POST', headers: serviceHeaders, signal: deadline,
          body: JSON.stringify({ p_user_id: user.id, p_idempotency_key: idempotencyKey, p_status: 'rejected' }),
        });
        if (!completion.ok) throw new Error('reservation update failed');
      } catch {
        return response(503, { error: 'Dispatch was rejected but retry safety could not be recorded' });
      }
      return response(502, { error: 'Workflow provider rejected the dispatch; retry with the same idempotency key' });
    }

    // Provider 5xx responses are ambiguous: retain reservation, preventing an unsafe retry.
    return response(503, { error: 'Dispatch outcome is unknown; retry with the same idempotency key' });
  };
}
