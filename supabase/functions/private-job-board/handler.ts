import { privateDiscoveryPreset } from '../../../shared/privateDiscoveryPresets.ts';
import { bounded, discard, readJson, record } from '../_shared/http.ts';

interface Config {
  supabaseUrl: string;
  serviceKey: string;
  theirStackKey: string;
}

interface Card {
  job_id: string;
  company: string | null;
  title: string;
  location: string | null;
  experience: string | null;
  salary: string | null;
  posted_date: string | null;
  url: string | null;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKING = new Set(['source', 'medium', 'campaign', 'referrer', 'gclid', 'fbclid', 'msclkid']);
const DEADLINE_MS = 20_000;
const REQUEST_BYTES = 2048;
const PROVIDER_BYTES = 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function text(value: unknown, limit = 300): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return clean ? Array.from(clean).slice(0, limit).join('') : null;
}

function cleanUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\p{C}\s]/u.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase().startsWith('utm_') || TRACKING.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function sourceDate(value: unknown): string | null {
  // TheirStack's source calendar date is not a reliable UTC posting instant.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function salary(job: Record<string, unknown>): string | null {
  const amount = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  const min = amount(job.salary_min), max = amount(job.salary_max);
  if (min === null && max === null) return null;
  const range = min !== null && max !== null ? `${min}–${max}` : `${min ?? max}`;
  return [text(job.salary_currency, 16), range].filter(Boolean).join(' ');
}

async function cards(payload: unknown, secrets: string[]): Promise<Card[]> {
  if (!record(payload) || !Array.isArray(payload.data) || payload.data.length > 10) throw new Error('Invalid jobs');
  const result = new Map<string, Card>();
  for (const job of payload.data) {
    if (!record(job)) throw new Error('Invalid job');
    const title = text(job.job_title);
    if (!title) throw new Error('Invalid title');
    const company = text(job.company) ?? (record(job.company_object) ? text(job.company_object.name) : null);
    const url = cleanUrl(job.final_url) ?? cleanUrl(job.url);
    let id = typeof job.id === 'string' ? text(job.id, 200)
      : typeof job.id === 'number' && Number.isSafeInteger(job.id) && job.id >= 0 ? String(job.id) : null;
    if (!id) {
      const canonical = JSON.stringify([title.toLowerCase(), company?.toLowerCase() ?? '', url ?? '']);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
      id = `hash:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    }
    const card: Card = { job_id: `theirstack:${id}`, company, title, location: text(job.location),
      experience: text(job.seniority, 120), salary: salary(job), posted_date: sourceDate(job.date_posted), url };
    // Do not persist credentials echoed by an upstream in otherwise allowed fields.
    if (secrets.some((secret) => Object.values(card).some((v) => typeof v === 'string' && v.includes(secret)))) {
      throw new Error('Unsafe job');
    }
    result.set(card.job_id, card);
  }
  return Array.from(result.values());
}

function nextAllowed(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error('Invalid quota');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid quota');
  return date.toISOString();
}

// Web-standard injectable boundary, separate from Deno startup; no SDK or globals.
export function createPrivateJobBoardHandler(config: Config, http: typeof fetch = fetch) {
  const base = config.supabaseUrl.replace(/\/+$/, '');
  const serviceHeaders = {
    apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, 'Content-Type': 'application/json',
  };
  async function request(url: string, init: RequestInit, signal: AbortSignal) {
    const response = await bounded(http(url, { ...init, signal, redirect: 'error' }), signal);
    // Also fail closed with scripted HTTP clients which don't enforce redirect:error.
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      discard(response);
      throw new Error('Redirect rejected');
    }
    return response;
  }
  async function rpc(name: string, body: object, signal: AbortSignal) {
    const response = await request(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: serviceHeaders, body: JSON.stringify(body),
    }, signal);
    if (!response.ok) { discard(response); throw new Error('Private board unavailable'); }
    if (response.status === 204) return null;
    return readJson(response, 64 * 1024, signal);
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const authorization = req.headers.get('Authorization');
    if (!authorization?.match(/^Bearer\s+[^\s,]+$/i)) return json({ error: 'Sign in to use the Private Job Board' }, 401);
    const signal = AbortSignal.any([AbortSignal.timeout(DEADLINE_MS), req.signal]);
    let claim: { user: string; token: string; next: string | null } | null = null;
    let failureStatus = 503;
    let failureCode = 'service_not_configured';
    try {
      const parsedBase = new URL(base);
      if (parsedBase.protocol !== 'https:' || parsedBase.username || parsedBase.password || parsedBase.search
        || parsedBase.hash || ![config.serviceKey, config.theirStackKey].every((key) => /^[\x21-\x7e]+$/.test(key))) {
        throw new Error('Service not configured');
      }
      failureCode = 'authentication_unavailable';
      const authResponse = await request(`${base}/auth/v1/user`, {
        headers: { apikey: config.serviceKey, Authorization: authorization },
      }, signal);
      if (authResponse.status === 401 || authResponse.status === 403) {
        discard(authResponse);
        return json({ error: 'Sign in to use the Private Job Board' }, 401);
      }
      if (!authResponse.ok) { discard(authResponse); throw new Error('Authentication unavailable'); }
      const user = await readJson(authResponse, 64 * 1024, signal);
      if (!record(user) || typeof user.id !== 'string' || !UUID.test(user.id) || user.is_anonymous !== false) {
        return json({ error: 'Sign in to use the Private Job Board' }, 401);
      }
      let query: string;
      try {
        if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers.get('Content-Type') ?? '')) throw new Error('Expected JSON');
        const body = await readJson(req, REQUEST_BYTES, signal);
        if (!record(body) || Object.keys(body).length !== 1 || typeof body.query !== 'string') throw new Error('Invalid query');
        query = body.query.trim();
        if (!query || Array.from(query).length > 120 || /[\p{C}\p{Zl}\p{Zp}]/u.test(query)) throw new Error('Invalid query');
      } catch {
        return json({ error: 'Provide only a query of 1–120 printable characters' }, 400);
      }
      const preset = privateDiscoveryPreset(query);
      if (!preset) return json({ error: 'Choose a supported discovery preset', code: 'invalid_preset' }, 400);
      failureCode = 'scan_claim_unavailable';
      const token = crypto.randomUUID();
      const acquired = await rpc('claim_private_job_scan', { p_user_id: user.id, p_token: token, p_query: query }, signal);
      if (!record(acquired)) throw new Error('Invalid claim');
      if (acquired.status === 'forbidden') return json({ error: 'An active paid entitlement is required' }, 403);
      // Set ownership before parsing metadata: even malformed claim responses may have consumed quota.
      if (acquired.status === 'claimed') claim = { user: user.id, token, next: null };
      const next = nextAllowed(acquired.next_allowed_at);
      if (acquired.status === 'running') return json({ error: 'A private scan is already running', nextAllowedAt: next }, 409);
      if (acquired.status === 'quota') return json({ error: 'Private discovery is available once per 24 hours', nextAllowedAt: next }, 429);
      if (!claim) throw new Error('Invalid claim');
      claim.next = next;
      failureStatus = 502;
      failureCode = 'provider_unavailable';
      // Exactly one request; no retries, pagination, JSearch, or public job writes.
      const provider = await request('https://api.theirstack.com/v1/jobs/search', {
        method: 'POST', headers: { Authorization: `Bearer ${config.theirStackKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ job_title_or: [...preset.titles], job_country_code_or: ['IN'], posted_at_max_age_days: 1,
          job_seniority_or: ['junior'], employment_statuses_or: ['full_time', 'internship'],
          workplace_types_or: ['remote', 'hybrid', 'on_site'], limit: 10, page: 0 }),
      }, signal);
      if (provider.status !== 200) { discard(provider); throw new Error('Discovery unavailable'); }
      failureCode = 'provider_response_invalid';
      const jobs = await cards(await readJson(provider, PROVIDER_BYTES, signal), [config.serviceKey, config.theirStackKey]);
      failureStatus = 503;
      failureCode = 'private_save_unavailable';
      const finished = await rpc('finish_private_job_scan', { p_user_id: user.id, p_token: token, p_jobs: jobs }, signal);
      if (!record(finished)) throw new Error('Invalid completion');
      if (finished.status === 'forbidden') {
        await rpc('fail_private_job_scan', { p_user_id: user.id, p_token: token }, signal);
        return json({ error: 'An active paid entitlement is required' }, 403);
      }
      if (finished.status !== 'completed' || !Number.isInteger(finished.jobs_saved)
        || (finished.jobs_saved as number) < 0 || (finished.jobs_saved as number) > jobs.length) throw new Error('Invalid completion');
      return json({ status: 'completed', jobsSaved: finished.jobs_saved, nextAllowedAt: nextAllowed(finished.next_allowed_at) });
    } catch {
      if (claim && !signal.aborted) {
        try { await rpc('fail_private_job_scan', { p_user_id: claim.user, p_token: claim.token }, signal); } catch { /* Quota remains consumed. */ }
      }
      // Never log/return provider bodies, descriptions, headers, exceptions or credentials.
      return json({ error: 'Private job discovery is temporarily unavailable. Please try again later.', code: failureCode,
        ...(claim?.next ? { nextAllowedAt: claim.next } : {}) }, failureStatus);
    }
  };
}
