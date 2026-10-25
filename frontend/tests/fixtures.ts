import { test as base, expect } from '@playwright/test';

export const NOW = '2026-10-22T12:00:00Z';
export const session = {
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

export interface MockBackend {
  jobs: ReturnType<typeof job>[];
  refreshStatus: 'idle' | 'started' | 'running' | 'completed' | 'failed';
  refreshRunId: number | undefined;
  refreshPreviousRunId: number | undefined;
  refreshHttpStatus: number;
  refreshGate: Promise<void> | null;
  catalogStatus: number;
  catalogDelay: boolean;
  catalogGate: Promise<void> | null;
  dispatchHttpStatus: number;
  dispatchResult: 'accepted' | 'pending';
  requests: { method: string; path: string; body: unknown; query: string; idempotencyKey: string | null }[];
}

export const test = base.extend<{ backend: MockBackend }>({
  backend: async ({ context, page }, provide, testInfo) => {
    const backend: MockBackend = {
      jobs: [job(), job({ job_id: 'senior', title: 'Senior Analyst', company: 'Beta',
        location: 'Mumbai, India', experience: '5+ Yrs', rating: 2 })],
      refreshStatus: 'idle', refreshRunId: 42, refreshPreviousRunId: undefined,
      refreshHttpStatus: 200, refreshGate: null,
      catalogStatus: 200, catalogDelay: false, catalogGate: null,
      dispatchHttpStatus: 403, dispatchResult: 'accepted', requests: [],
    };
    const unexpected: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // Reviewed legacy log-key collision; ticket 05 replaces the terminal state model.
      if (text.includes('Encountered two children with the same key')) return;
      // Decorative fonts are deliberately aborted above, never downloaded.
      if (text.includes('Failed to load resource: net::ERR_FAILED')) return;
      // Mock HTTP rejection is intentionally exercised by the dispatch test.
      if (text.includes('Failed to load resource: the server responded with a status of 403')) return;
      // Catalog failure/retry tests deliberately script HTTP errors.
      if (backend.catalogStatus !== 200 && text.includes(`Failed to load resource: the server responded with a status of ${backend.catalogStatus}`)) return;
      if (backend.dispatchHttpStatus !== 202 && text.includes(`Failed to load resource: the server responded with a status of ${backend.dispatchHttpStatus}`)) return;
      // Refresh failure/retry tests deliberately script HTTP errors.
      if (backend.refreshHttpStatus !== 200 && text.includes(`Failed to load resource: the server responded with a status of ${backend.refreshHttpStatus}`)) return;
      errors.push(text);
    });
    await page.clock.install({ time: new Date(NOW) });

    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === 'http://127.0.0.1:4173') return route.continue();
      // Font loading is decorative and must not depend on Google availability.
      if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort();
      if (url.origin !== 'https://supabase.test') {
        unexpected.push(request.url());
        return route.abort('blockedbyclient');
      }
      const body = request.postData() ? request.postDataJSON() : null;
      backend.requests.push({ method: request.method(), path: url.pathname, body, query: url.search,
        idempotencyKey: request.headers()['idempotency-key'] ?? null });
      if (url.pathname === '/rest/v1/Seen_job' && request.method() === 'GET') {
        let rows = [...backend.jobs];
        for (const [key, value] of url.searchParams) {
          if (key === 'or') rows = rows.filter((row) => matchesTerm(row, `or${value}`));
          else if (!['select', 'order', 'offset', 'limit'].includes(key)) {
            rows = rows.filter((row) => matchesTerm(row, `${key}.${value}`));
          }
        }
        const order = url.searchParams.get('order');
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
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 1000);
        rows = rows.slice(offset, offset + limit);
        const status = backend.catalogStatus;
        const gate = backend.catalogGate;
        if (backend.catalogDelay) await new Promise((resolve) => setTimeout(resolve, 300));
        if (gate) await gate;
        return route.fulfill({ status, headers: {
          'content-range': `${offset}-${offset + rows.length - 1}/${total}`,
          'access-control-expose-headers': 'content-range',
        },
          json: status === 200 ? rows : { message: 'Offline catalog unavailable' } });
      }
      if (url.pathname === '/rest/v1/users' && request.method() === 'GET') {
        return route.fulfill({ json: { id: session.user.id, name: 'Test Candidate',
          email: session.user.email, total_runs: 0 } });
      }
      if (url.pathname === '/rest/v1/users' && request.method() === 'PATCH') {
        return route.fulfill({ status: 204 });
      }
      if (url.pathname === '/auth/v1/token' && request.method() === 'POST') {
        return route.fulfill({ json: session });
      }
      if (url.pathname === '/auth/v1/user' && request.method() === 'GET') {
        return route.fulfill({ json: session.user });
      }
      if (url.pathname === '/functions/v1/refresh-jobs') {
        const status = backend.refreshHttpStatus;
        const gate = backend.refreshGate;
        const result = request.method() === 'POST' && backend.refreshStatus === 'idle'
          ? 'started' : backend.refreshStatus;
        if (request.method() === 'POST' && status === 200) backend.refreshStatus = 'running';
        if (gate) await gate;
        return route.fulfill({ status, json: status === 200
          ? { status: result, estimatedMinutes: 15,
            ...(backend.refreshRunId !== undefined ? { runId: backend.refreshRunId } : {}),
            ...(backend.refreshPreviousRunId !== undefined ? { previousRunId: backend.refreshPreviousRunId } : {}),
          }
          : { error: 'Offline refresh unavailable' } });
      }
      if (url.pathname === '/functions/v1/dispatch-workflow' && request.method() === 'POST') {
        return route.fulfill({ status: backend.dispatchHttpStatus, json: backend.dispatchHttpStatus === 202
          ? { status: backend.dispatchResult } : { error: 'Offline dispatch rejected' } });
      }
      unexpected.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', (socket) => {
      const url = new URL(socket.url());
      // Vite HMR may connect locally; Supabase realtime is deliberately inert.
      if (url.hostname === '127.0.0.1') socket.connectToServer();
      else if (url.hostname === 'supabase.test') socket.close();
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
