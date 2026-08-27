interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
}

interface JobFilters {
  keyword?: unknown;
  rating?: unknown;
  experience?: unknown;
  location?: unknown;
  salary?: unknown;
}

const JOB_TABLE = 'Seen_job';
const MAX_JOBS = 30;

function corsHeaders(): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
}

function textFilter(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function escapeIlike(value: string): string {
  // PostgREST's ilike value uses `*` as a wildcard. Escape user wildcards and
  // delimiters before surrounding the value with our own wildcard characters.
  return value.replace(/[\\,*()]/g, (character) => `\\${character}`);
}

function buildSupabaseUrl(baseUrl: string, filters: JobFilters): string {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/rest/v1/${JOB_TABLE}`);
  url.searchParams.set('select', '*');
  url.searchParams.set('created_at', `gte.${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`);
  url.searchParams.set('order', 'rating.desc,created_at.desc');
  url.searchParams.set('limit', String(MAX_JOBS));

  const andConditions: string[] = [];
  const keyword = escapeIlike(textFilter(filters.keyword));
  if (keyword) {
    andConditions.push(`or(company.ilike.*${keyword}*,title.ilike.*${keyword}*,location.ilike.*${keyword}*)`);
  }

  const rating = Number(filters.rating);
  if (Number.isFinite(rating) && rating > 0) url.searchParams.set('rating', `gte.${Math.min(5, Math.max(1, rating))}`);

  const experience = textFilter(filters.experience);
  if (experience) {
    const values = experience.split(',').map((item) => item.trim()).filter(Boolean);
    if (values.length > 1) {
      andConditions.push(`or(${values.map((value) => `experience.ilike.*${escapeIlike(value)}*`).join(',')})`);
    } else {
      andConditions.push(`experience.ilike.*${escapeIlike(experience)}*`);
    }
  }

  const location = textFilter(filters.location);
  if (location) andConditions.push(`location.ilike.*${escapeIlike(location)}*`);
  const salary = textFilter(filters.salary);
  if (salary) andConditions.push(`salary.ilike.*${escapeIlike(salary)}*`);
  if (andConditions.length) url.searchParams.set('and', `(${andConditions.join(',')})`);
  return url.toString();
}

function jsonResponse(body: unknown, status: number, headers?: HeadersInit): Response {
  const merged = new Headers(corsHeaders());
  merged.set('Content-Type', 'application/json; charset=utf-8');
  if (headers) new Headers(headers).forEach((value, key) => merged.set(key, value));
  return new Response(JSON.stringify(body), { status, headers: merged });
}

async function streamJobs(request: Request, env: Env): Promise<Response> {
  let filters: JobFilters = {};
  try {
    const payload = await request.json();
    if (payload && typeof payload === 'object') filters = payload as JobFilters;
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400);
  }

  const supabaseKey = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY;
  if (!env.SUPABASE_URL || !supabaseKey) {
    return jsonResponse({ error: 'Supabase Worker configuration is missing.' }, 500);
  }

  const upstream = await fetch(buildSupabaseUrl(env.SUPABASE_URL, filters), {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Accept: 'application/json',
    },
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    return jsonResponse({ error: 'Supabase query failed.', detail }, 502);
  }

  let jobs: unknown;
  try {
    jobs = await upstream.json();
  } catch {
    return jsonResponse({ error: 'Supabase returned invalid JSON.' }, 502);
  }
  if (!Array.isArray(jobs)) return jsonResponse({ error: 'Supabase returned an unexpected payload.' }, 502);

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const pump = (async () => {
    try {
      for (const job of jobs as unknown[]) {
        await writer.write(encoder.encode(`${JSON.stringify(job)}\n`));
      }
    } finally {
      await writer.close();
    }
  })();
  // Keep the stream-producing promise attached to the request lifecycle.
  void pump.catch(() => writer.abort());

  const headers = corsHeaders();
  headers.set('Content-Type', 'application/x-ndjson; charset=utf-8');
  headers.set('Cache-Control', 'no-cache, no-transform');
  return new Response(readable, { status: 200, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(request.url);
    if (url.pathname === '/api/jobs/stream') {
      if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, { Allow: 'POST, OPTIONS' });
      return streamJobs(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
