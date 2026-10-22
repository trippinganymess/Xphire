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

export interface MockBackend {
  jobs: ReturnType<typeof job>[];
  catalogStatus: number;
  catalogDelay: boolean;
  requests: { method: string; path: string; body: unknown; query: string }[];
}

export const test = base.extend<{ backend: MockBackend }>({
  backend: async ({ context, page }, provide, testInfo) => {
    const backend: MockBackend = {
      jobs: [job(), job({ job_id: 'senior', title: 'Senior Analyst', company: 'Beta',
        location: 'Mumbai, India', experience: '5+ Yrs', rating: 2 })],
      catalogStatus: 200, catalogDelay: false, requests: [],
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
      backend.requests.push({ method: request.method(), path: url.pathname, body, query: url.search });
      if (url.pathname === '/rest/v1/Seen_job' && request.method() === 'GET') {
        if (backend.catalogDelay) await new Promise((resolve) => setTimeout(resolve, 300));
        return route.fulfill({ status: backend.catalogStatus, json: backend.catalogStatus === 200
          ? backend.jobs : { message: 'Offline catalog unavailable' } });
      }
      if (url.pathname === '/rest/v1/users' && request.method() === 'GET') {
        return route.fulfill({ json: { id: session.user.id, name: 'Test Candidate',
          email: session.user.email, total_runs: 0 } });
      }
      if (url.pathname === '/auth/v1/token' && request.method() === 'POST') {
        return route.fulfill({ json: session });
      }
      if (url.pathname === '/auth/v1/user' && request.method() === 'GET') {
        return route.fulfill({ json: session.user });
      }
      if (url.pathname === '/functions/v1/dispatch-workflow' && request.method() === 'POST') {
        return route.fulfill({ status: 403, json: { error: 'Offline dispatch rejected' } });
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
