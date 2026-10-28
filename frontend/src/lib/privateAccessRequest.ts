import { fetchWithSession, functionsUrl } from './supabase';

const request = fetchWithSession(true);
type AccessRequestResult = 'queued' | 'already_allowed';

export async function requestPrivateAccess(name: string, message: string, signal: AbortSignal): Promise<AccessRequestResult> {
  let response: Response;
  try {
    response = await request(functionsUrl + '/request-private-access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, message }), signal,
    });
  } catch {
    throw new Error('Unable to confirm your request. Check your connection and try later; your request may already have been saved.');
  }
  let body: unknown;
  try { body = await response.json(); } catch { /* Gateway failures can be non-JSON. */ }
  if (!response.ok) {
    const statuses: Record<number, string> = {
      400: 'Enter your name (up to 80 characters) and an optional message (up to 1,000 characters).',
      401: 'Please sign in again before requesting access.',
      403: 'Confirm your account email before requesting access.',
      404: 'Access requests are not available yet. Please try later.',
      429: 'You already requested access in the last 24 hours. Please wait before sending another request.',
    };
    const codes: Record<string, string> = {
      service_not_configured: 'Access requests are temporarily unavailable. Please try later.',
      authentication_unavailable: 'Unable to verify your account. Please try later.',
      request_storage_unavailable: 'Unable to save your access request. Please try later.',
      notification_unavailable: 'Your request was saved, but email delivery could not be confirmed. Please try later before sending another request.',
    };
    const code = body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' ? body.code : '';
    throw new Error(statuses[response.status] ?? (Object.hasOwn(codes, code) ? codes[code] : 'Unable to send your access request. Please try later.'));
  }
  if (body && typeof body === 'object' && 'status' in body) {
    if (body.status === 'already_allowed') return 'already_allowed';
    if (body.status === 'queued' && 'requestId' in body && typeof body.requestId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)
      && 'nextAllowedAt' in body && typeof body.nextAllowedAt === 'string'
      && Number.isFinite(Date.parse(body.nextAllowedAt))) return 'queued';
  }
  throw new Error('Unable to confirm your request. Please try later; a request may already have been saved.');
}
