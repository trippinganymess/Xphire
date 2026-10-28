import { test as base, expect } from '@playwright/test';
import type { Session } from '@supabase/auth-js';

export const NOW = '2026-10-22T12:00:00Z';
export const session: Session = {
  access_token: 'offline-access-token', refresh_token: 'offline-refresh-token',
  token_type: 'bearer', expires_in: 3600, expires_at: Date.parse(NOW) / 1000 + 3600,
  user: {
    id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated',
    email: 'candidate@example.test', user_metadata: { name: 'Test Candidate' },
    app_metadata: {}, created_at: NOW,
  },
};

export function job(overrides: Record<string, unknown> = {}) {
  return {
    job_id: 'entry', company: 'Acme', title: 'Junior Engineer',
    location: 'Bengaluru, India', experience: 'Fresher / 0-1 Yrs',
    salary: 'Not Disclosed', source: 'Greenhouse', rating: 4,
    scraped_at: '2026-10-22T11:00:00Z', url: 'https://jobs.example.test/entry',
    ...overrides,
  };
}

function splitTerms(value: string): string[] {
  const terms: string[] = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      terms.push(value.slice(start, i));
      start = i + 1;
    }
  }
  terms.push(value.slice(start));
  return terms;
}

function matchesPattern(value: unknown, pattern: string): boolean {
  let expression = '^';
  let escaped = false;
  for (const char of pattern) {
    if (!escaped && char === '\\') { escaped = true; continue; }
    if (!escaped && (char === '%' || char === '*')) expression += '.*';
    else if (!escaped && char === '_') expression += '.';
    else expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    escaped = false;
  }
  return new RegExp(`${expression}$`, 'i').test(String(value ?? ''));
}

function matchesTerm(row: ReturnType<typeof job>, term: string): boolean {
  if (term.startsWith('and(') || term.startsWith('or(')) {
    const terms = splitTerms(term.slice(term.indexOf('(') + 1, -1));
    return term.startsWith('and(') ? terms.every((item) => matchesTerm(row, item))
      : terms.some((item) => matchesTerm(row, item));
  }
  const match = /^([a-z_]+)\.(ilike|imatch|gte|lte|eq)\.(.*)$/.exec(term);
  if (!match) throw new Error(`Unsupported mock predicate: ${term}`);
  const [, field, operator, encoded] = match;
  const value = encoded.startsWith('"') ? JSON.parse(encoded) as string : encoded;
  const actual = (row as Record<string, unknown>)[field];
  if (operator === 'ilike') return matchesPattern(actual, value);
  if (operator === 'imatch') return actual != null && new RegExp(value, 'i').test(String(actual));
  if (actual == null) return false;
  if (operator === 'gte') return field === 'rating' ? Number(actual) >= Number(value) : String(actual) >= value;
  if (operator === 'lte') return String(actual) <= value;
  return String(actual) === value;
}

// Use the same PostgREST filtering/count/paging model for both catalogs.
function catalogPage(rows: ReturnType<typeof job>[], search: URLSearchParams) {
  rows = [...rows];
  for (const [key, value] of search) {
    if (key === 'or') rows = rows.filter((row) => matchesTerm(row, `or${value}`));
    else if (!['select', 'order', 'offset', 'limit'].includes(key)) {
      rows = rows.filter((row) => matchesTerm(row, `${key}.${value}`));
    }
  }
  const order = search.get('order');
  if (order) {
    const fields = order.split(',');
    rows.sort((a, b) => {
      for (const field of fields) {
        const [name, direction] = field.split('.');
        const left = String((a as Record<string, unknown>)[name] ?? '');
        const right = String((b as Record<string, unknown>)[name] ?? '');
        const comparison = left < right ? -1 : left > right ? 1 : 0;
        if (comparison) return direction === 'desc' ? -comparison : comparison;
      }
      return 0;
    });
  }
  const total = rows.length;
  const offset = Number(search.get('offset') ?? 0);
  const limit = Number(search.get('limit') ?? 1000);
  return { rows: rows.slice(offset, offset + limit), total, offset };
}

export function privateJob(overrides: Record<string, unknown> = {}) {
  return { ...job({ source: 'TheirStack', rating: null,
    experience: 'Junior', posted_date: '2026-10-20', ...overrides }),
    user_id: typeof overrides.user_id === 'string' ? overrides.user_id : session.user.id };
}

export interface MockBackend {
  authSession: typeof session;
  userProfile: Record<string, unknown> | null;
  authTokenStatus: number;
  jobs: ReturnType<typeof job>[];
  refreshStatus: 'idle' | 'started' | 'running' | 'completed' | 'failed';
  refreshRunId: number | undefined;
  refreshPreviousRunId: number | undefined;
  refreshHttpStatus: number;
  refreshGate: Promise<void> | null;
  catalogStatus: number;
  catalogDelay: boolean;
  catalogGate: Promise<void> | null;
  privateAccess: { allowed: boolean; next_allowed_at: string | null; last_status: string | null; last_query: string | null };
  privateAccessHttpStatus: number;
  privateAccessGate: Promise<void> | null;
  privateJobs: ReturnType<typeof privateJob>[];
  privateCatalogStatus: number;
  privateCatalogGate: Promise<void> | null;
  privateDiscoveryHttpStatus: number;
  privateDiscoveryGate: Promise<void> | null;
  privateDiscoveryJobs: ReturnType<typeof privateJob>[];
  privateNextAllowedAt: string;
  requests: { method: string; path: string; body: unknown; query: string; authorization: string | null }[];
}

export const test = base.extend<{ backend: MockBackend }>({
  backend: async ({ context, page }, provide, testInfo) => {
    const backend: MockBackend = {
      authSession: structuredClone(session),
      userProfile: { id: session.user.id, name: 'Test Candidate', email: session.user.email, total_runs: 0 },
      authTokenStatus: 200,
      jobs: [job(), job({ job_id: 'senior', title: 'Senior Analyst', company: 'Beta',
        location: 'Mumbai, India', experience: '5+ Yrs', rating: 2 })],
      refreshStatus: 'idle', refreshRunId: 42, refreshPreviousRunId: undefined,
      refreshHttpStatus: 200, refreshGate: null,
      catalogStatus: 200, catalogDelay: false, catalogGate: null,
      privateAccess: { allowed: false, next_allowed_at: null, last_status: null, last_query: null },
      privateAccessHttpStatus: 200, privateAccessGate: null,
      privateJobs: [privateJob({ title: 'Private Junior Engineer' })],
      privateCatalogStatus: 200, privateCatalogGate: null,
      privateDiscoveryHttpStatus: 200, privateDiscoveryGate: null,
      privateDiscoveryJobs: [privateJob({ job_id: 'discovered', title: 'Discovered Frontend Engineer' })],
      privateNextAllowedAt: '2026-10-23T12:00:00Z', requests: [],
    };
    const unexpected: string[] = [];
    const errors: string[] = [];
    // Only HTTP failures actually returned by deliberately scripted mocks are
    // allowed. Unexpected endpoints still abort and fail fixture teardown.
    const scriptedHttpErrors = new Set<number>();
    const noteHttpStatus = (status: number) => { if (status >= 400) scriptedHttpErrors.add(status); };
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // Reviewed legacy log-key collision; ticket 05 replaces the terminal state model.
      if (text.includes('Encountered two children with the same key')) return;
      // Decorative fonts are deliberately aborted above, never downloaded.
      if (text.includes('Failed to load resource: net::ERR_FAILED')) return;
      const httpError = /Failed to load resource: the server responded with a status of (\d+)/.exec(text);
      if (httpError && scriptedHttpErrors.has(Number(httpError[1]))) return;
      errors.push(text);
    });
    await page.clock.install({ time: new Date(NOW) });

    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === 'http://127.0.0.1:4173') return route.continue();
      // Font loading is decorative and must not depend on Google availability.
      if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort();
      if (url.origin !== 'https://placeholder.supabase.co') {
        unexpected.push(request.url());
        return route.abort('blockedbyclient');
      }
      const body = request.postData() ? request.postDataJSON() : null;
      backend.requests.push({ method: request.method(), path: url.pathname, body, query: url.search,
        authorization: request.headers().authorization ?? null });
      if (url.pathname === '/rest/v1/Seen_job' && request.method() === 'GET') {
        const { rows, total, offset } = catalogPage(backend.jobs, url.searchParams);
        const status = backend.catalogStatus;
        const gate = backend.catalogGate;
        if (backend.catalogDelay) await new Promise((resolve) => setTimeout(resolve, 300));
        if (gate) await gate;
        noteHttpStatus(status);
        return route.fulfill({ status, headers: {
          'content-range': `${offset}-${offset + rows.length - 1}/${total}`,
          'access-control-expose-headers': 'content-range',
        },
          json: status === 200 ? rows : { message: 'Offline catalog unavailable' } });
      }
      if (url.pathname === '/rest/v1/rpc/private_job_board_access' && request.method() === 'POST') {
        const status = backend.privateAccessHttpStatus;
        const access = structuredClone(backend.privateAccess);
        const gate = backend.privateAccessGate;
        if (gate) await gate;
        noteHttpStatus(status);
        return route.fulfill({ status, json: status === 200 ? access : { message: 'Offline private access unavailable' } });
      }
      if (url.pathname === '/rest/v1/private_jobs' && request.method() === 'GET') {
        if (!url.searchParams.get('user_id')?.startsWith('eq.')) {
          unexpected.push('Private catalog request without an owner filter');
          return route.abort('blockedbyclient');
        }
        const { rows, total, offset } = catalogPage(backend.privateJobs, url.searchParams);
        const status = backend.privateCatalogStatus;
        const gate = backend.privateCatalogGate;
        if (gate) await gate;
        noteHttpStatus(status);
        return route.fulfill({ status, headers: {
          'content-range': `${offset}-${offset + rows.length - 1}/${total}`,
          'access-control-expose-headers': 'content-range',
        }, json: status === 200 ? rows : { message: 'Offline private catalog unavailable' } });
      }
      if (url.pathname === '/functions/v1/private-job-board' && request.method() === 'POST') {
        const status = backend.privateDiscoveryHttpStatus;
        const gate = backend.privateDiscoveryGate;
        const owner = backend.authSession.user.id;
        const saved = structuredClone(backend.privateDiscoveryJobs).map((row) => ({ ...row, user_id: owner }));
        const nextAllowedAt = backend.privateNextAllowedAt;
        if (gate) await gate;
        noteHttpStatus(status);
        if (status === 200) {
          // A mock of persisted discoveries, not a live provider call or an RLS/security test.
          backend.privateJobs = backend.privateJobs.filter((row) =>
            !saved.some((newRow) => newRow.user_id === row.user_id && newRow.job_id === row.job_id)).concat(saved);
        }
        if (status === 200 || status === 429) backend.privateAccess = {
          ...backend.privateAccess, next_allowed_at: nextAllowedAt,
          last_status: status === 200 ? 'completed' : 'quota_exceeded',
          last_query: typeof body?.query === 'string' ? body.query : null,
        };
        return route.fulfill({ status, json: status === 200
          ? { status: 'completed', jobsSaved: saved.length, nextAllowedAt }
          : { error: 'Offline private discovery rejected', nextAllowedAt } });
      }
      if (url.pathname === '/rest/v1/users' && request.method() === 'GET') {
        return route.fulfill({ json: backend.userProfile });
      }
      if (url.pathname === '/auth/v1/token' && request.method() === 'POST') {
        noteHttpStatus(backend.authTokenStatus);
        return route.fulfill({ status: backend.authTokenStatus, json: backend.authTokenStatus === 200
          ? backend.authSession : { code: 'flow_state_expired', message: 'OAuth code has expired' } });
      }
      if (url.pathname === '/auth/v1/signup' && request.method() === 'POST') {
        return route.fulfill({ json: backend.authSession });
      }
      if (url.pathname === '/auth/v1/user' && request.method() === 'GET') {
        return route.fulfill({ json: backend.authSession.user });
      }
      if (url.pathname === '/auth/v1/logout' && request.method() === 'POST') {
        return route.fulfill({ status: 204 });
      }
      if (url.pathname === '/functions/v1/refresh-jobs') {
        const status = backend.refreshHttpStatus;
        const gate = backend.refreshGate;
        const result = request.method() === 'POST' && backend.refreshStatus === 'idle'
          ? 'started' : backend.refreshStatus;
        if (request.method() === 'POST' && status === 200) backend.refreshStatus = 'running';
        if (gate) await gate;
        noteHttpStatus(status);
        return route.fulfill({ status, json: status === 200
          ? { status: result, estimatedMinutes: 15,
            ...(backend.refreshRunId !== undefined ? { runId: backend.refreshRunId } : {}),
            ...(backend.refreshPreviousRunId !== undefined ? { previousRunId: backend.refreshPreviousRunId } : {}),
          }
          : { error: 'Offline refresh unavailable' } });
      }
      if (url.pathname === '/functions/v1/dispatch-workflow' && request.method() === 'POST') {
        noteHttpStatus(403);
        return route.fulfill({ status: 403, json: { error: 'Offline dispatch rejected' } });
      }
      unexpected.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', (socket) => {
      const url = new URL(socket.url());
      // Vite HMR may connect locally; Supabase realtime is deliberately inert.
      if (url.hostname === '127.0.0.1') socket.connectToServer();
      else if (url.hostname === 'placeholder.supabase.co') socket.close();
      else { unexpected.push(socket.url()); socket.close(); }
    });
    await provide(backend);
    // Safety failures must never be swallowed by an expected product defect.
    if (unexpected.length || errors.length) testInfo.expectedStatus = 'passed';
    expect(unexpected, 'Unmocked traffic must fail even in expected-failure tests').toEqual([]);
    expect(errors, 'Browser runtime errors are regressions').toEqual([]);
  },
});
export { expect };
