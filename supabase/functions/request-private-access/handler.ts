import { bounded, discard, readJson, record } from '../_shared/http.ts';

interface Config {
  supabaseUrl: string;
  serviceKey: string;
  githubToken: string;
  owner: string;
  repo: string;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>\p{C}]+@[^\s@<>\p{C}]+\.[^\s@<>\p{C}]+$/u;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export function createPrivateAccessRequestHandler(config: Config, http: typeof fetch = fetch) {
  const base = config.supabaseUrl.replace(/\/+$/, '');
  const request = (url: string, init: RequestInit, signal: AbortSignal) =>
    bounded(http(url, { ...init, redirect: 'error', signal }), signal);
  async function rpc(name: string, body: unknown, signal: AbortSignal) {
    const response = await request(base + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, signal);
    if (!response.ok) { discard(response); throw new Error('Request storage unavailable'); }
    return readJson(response, 16_384, signal);
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ code: 'method_not_allowed' }, 405);
    const authorization = req.headers.get('authorization') ?? '';
    if (!/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(authorization)) return json({ code: 'sign_in_required' }, 401);
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(15_000)]);
    let code = 'service_not_configured';
    try {
      const url = new URL(base);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || ![config.serviceKey, config.githubToken].every((key) => /^[\x21-\x7e]+$/.test(key))
        || !/^[A-Za-z0-9-]+$/.test(config.owner) || !/^[A-Za-z0-9_.-]+$/.test(config.repo)) {
        throw new Error('Service not configured');
      }
      code = 'authentication_unavailable';
      const auth = await request(base + '/auth/v1/user', {
        headers: { apikey: config.serviceKey, Authorization: authorization },
      }, signal);
      if (auth.status === 401 || auth.status === 403) { discard(auth); return json({ code: 'sign_in_required' }, 401); }
      if (!auth.ok) { discard(auth); throw new Error('Authentication unavailable'); }
      const user = await readJson(auth, 65_536, signal);
      if (!record(user) || typeof user.id !== 'string' || !UUID.test(user.id) || user.is_anonymous !== false) {
        return json({ code: 'sign_in_required' }, 401);
      }
      if (typeof user.email !== 'string' || user.email.length > 254 || !EMAIL.test(user.email)
        || typeof user.email_confirmed_at !== 'string' || !Number.isFinite(Date.parse(user.email_confirmed_at))) {
        return json({ code: 'verified_email_required' }, 403);
      }
      let form: { name: string; message: string };
      try {
        const body = await readJson(req, 6_144, signal);
        if (!record(body) || Object.keys(body).length !== 2 || typeof body.name !== 'string' || typeof body.message !== 'string') {
          throw new Error('Invalid form');
        }
        const name = body.name.trim();
        const message = body.message.replace(/\r\n?/g, '\n').trim();
        if (!name || name.length > 80 || /[\p{C}\p{Zl}\p{Zp}]/u.test(name)
          || message.length > 1000 || /[\p{C}\p{Zl}\p{Zp}]/u.test(message.replace(/[\n\t]/g, ''))) {
          throw new Error('Invalid form');
        }
        form = { name, message };
      } catch { return json({ code: 'invalid_request' }, 400); }

      code = 'request_storage_unavailable';
      // Only the verified Auth identity/email are persisted. Clients cannot choose
      // a recipient, account ID, workflow, branch, or an entitlement.
      const claim = await rpc('claim_private_job_access_request', {
        p_user_id: user.id, p_email: user.email, p_name: form.name, p_message: form.message,
      }, signal);
      if (!record(claim)) throw new Error('Invalid request claim');
      if (claim.status === 'forbidden') return json({ code: 'sign_in_required' }, 401);
      if (claim.status === 'already_allowed') return json({ status: 'already_allowed' });
      if (claim.status === 'cooldown') return json({ code: 'already_requested', nextAllowedAt: claim.next_allowed_at }, 429);
      if (claim.status !== 'claimed' || typeof claim.request_id !== 'string' || !UUID.test(claim.request_id)
        || typeof claim.next_allowed_at !== 'string' || !Number.isFinite(Date.parse(claim.next_allowed_at))) {
        throw new Error('Invalid request claim');
      }

      code = 'notification_unavailable';
      const dispatch = await request('https://api.github.com/repos/' + config.owner + '/' + config.repo
        + '/actions/workflows/request_private_access.yml/dispatches', {
        method: 'POST',
        headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + config.githubToken,
          'Content-Type': 'application/json', 'User-Agent': 'Xphire-Access-Requests' },
        body: JSON.stringify({ ref: 'main', inputs: { request_id: claim.request_id } }),
      }, signal);
      discard(dispatch);
      if (dispatch.status !== 204) throw new Error('Notification dispatch unavailable');
      // A fast mail worker may already have marked it sent. A failed status update
      // must not turn an acknowledged queue submission into a false delivery error.
      try {
        await rpc('set_private_job_access_notification', { p_request_id: claim.request_id, p_status: 'queued' }, signal);
      } catch { /* The durable pending record is also eligible for delivery. */ }
      return json({ status: 'queued', requestId: claim.request_id, nextAllowedAt: claim.next_allowed_at }, 202);
    } catch {
      // Keep the durable cooldown after an ambiguous dispatch failure; never
      // retry automatically or expose provider errors, form data, or credentials.
      return json({ code }, 503);
    }
  };
}
