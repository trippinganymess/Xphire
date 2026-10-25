import assert from 'node:assert/strict';
import test from 'node:test';
import { createRefreshHandler } from '../supabase/functions/refresh-jobs/handler.ts';

const config = { supabaseUrl: 'https://supabase.test', serviceKey: 'offline-service-key',
  githubToken: 'offline-github-token', owner: 'owner', repo: 'repo' };
const completed = { id: 40, status: 'completed', conclusion: 'success' };
const queued = { id: 42, status: 'queued', conclusion: null };

function setup() {
  const state = { runs: [completed], pending: false, authStatus: 200, anonymous: false,
    githubStatus: 200, dispatchStatus: 204, dispatchTimeout: false, leaseStatus: 200,
    afterAcquire: null, requests: [], dispatches: 0, requestRemaining: 120,
    githubRemaining: 12, cache: null, statusLease: false, statusToken: null };
  const http = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    state.requests.push({ method, path: url.pathname, headers, body: init.body });
    assert.ok(init.signal, 'Every external request has a deadline');
    if (url.origin === config.supabaseUrl) {
      assert.equal(headers.get('apikey'), config.serviceKey);
      if (url.pathname === '/auth/v1/user') {
        assert.equal(headers.get('Authorization'), 'Bearer verified-user-token');
        return Response.json(state.authStatus === 200
          ? { id: 'offline-user', is_anonymous: state.anonymous } : { error: 'rejected' }, { status: state.authStatus });
      }
      assert.equal(headers.get('Authorization'), `Bearer ${config.serviceKey}`);
      assert.equal(method, 'POST');
      if (state.leaseStatus !== 200) return Response.json({ error: 'lease rejected' }, { status: state.leaseStatus });
      if (url.pathname.endsWith('/reserve_job_refresh_budget')) {
        const kind = JSON.parse(init.body).p_kind;
        assert.ok(['request', 'github'].includes(kind));
        const key = kind === 'request' ? 'requestRemaining' : 'githubRemaining';
        return Response.json(state[key]-- > 0);
      }
      if (url.pathname.endsWith('/claim_job_refresh_status')) {
        if (state.cache) return Response.json({ kind: 'cached', workflow_runs: state.cache, pending: state.pending });
        if (state.statusLease) return Response.json({ kind: 'busy', pending: state.pending });
        state.statusLease = true;
        state.statusToken = JSON.parse(init.body).p_token;
        return Response.json({ kind: 'fetch', pending: state.pending });
      }
      if (url.pathname.endsWith('/finish_job_refresh_status')) {
        const body = JSON.parse(init.body);
        assert.equal(body.p_token, state.statusToken);
        state.cache = body.p_runs;
        state.statusLease = false;
        return Response.json(state.pending);
      }
      if (url.pathname.endsWith('/job_refresh_pending')) return Response.json(state.pending);
      if (url.pathname.endsWith('/acquire_job_refresh_lease')) {
        if (state.pending) return Response.json(false);
        assert.match(JSON.parse(init.body).p_token, /^[a-f0-9-]{36}$/);
        state.pending = true;
        if (state.afterAcquire) state.runs = state.afterAcquire;
        return Response.json(true);
      }
      if (url.pathname.endsWith('/release_job_refresh_lease')) {
        state.pending = false;
        return Response.json(null);
      }
    }
    if (url.origin === 'https://api.github.com') {
      assert.equal(headers.get('Authorization'), `Bearer ${config.githubToken}`);
      assert.equal(url.pathname.startsWith('/repos/owner/repo/actions/workflows/scrape_jobs.yml/'), true);
      if (url.pathname.endsWith('/runs')) {
        assert.equal(method, 'GET');
        assert.equal(url.searchParams.get('per_page'), '100');
        return Response.json({ workflow_runs: state.runs }, { status: state.githubStatus });
      }
      if (url.pathname.endsWith('/dispatches')) {
        assert.equal(method, 'POST');
        assert.deepEqual(JSON.parse(init.body), { ref: 'main' });
        state.dispatches++;
        if (state.dispatchTimeout) throw new Error('Offline network timeout');
        return state.dispatchStatus === 204 ? new Response(null, { status: 204 })
          : Response.json({ error: 'upstream sensitive detail' }, { status: state.dispatchStatus });
      }
    }
    assert.fail(`Unexpected outbound request: ${method} ${url}`);
  };
  const handler = createRefreshHandler(config, http);
  const request = (method = 'GET', authenticated = false) => handler(new Request('https://edge.test/refresh-jobs', {
    method, headers: authenticated ? { Authorization: 'Bearer verified-user-token' } : {},
  }));
  return { state, request };
}

test('public status reports the latest completed run without dispatch or auth', async () => {
  const { state, request } = setup();
  assert.deepEqual(await (await request()).json(), { status: 'completed', estimatedMinutes: 15, runId: 40 });
  assert.equal(state.dispatches, 0);
  assert.equal(state.requests.some((r) => r.path.includes('/auth/')), false);
});

test('empty workflow history is idle', async () => {
  const { state, request } = setup();
  state.runs = [];
  assert.equal((await (await request()).json()).status, 'idle');
});

for (const status of ['queued', 'in_progress', 'requested', 'waiting', 'pending']) {
  test(`${status} run prevents a new dispatch`, async () => {
    const { state, request } = setup();
    state.runs = [{ ...queued, status }];
    const response = await request('POST', true);
    assert.deepEqual(await response.json(), { status: 'running', estimatedMinutes: 15, runId: 42 });
    assert.equal(state.dispatches, 0);
  });
}

test('POST without a token is rejected before any external call', async () => {
  const { state, request } = setup();
  assert.equal((await request('POST')).status, 401);
  assert.equal(state.requests.length, 0);
});

for (const authStatus of [401, 403]) {
  test(`invalid or expired user token (${authStatus}) cannot dispatch`, async () => {
    const { state, request } = setup();
    state.authStatus = authStatus;
    assert.equal((await request('POST', true)).status, 401);
    assert.equal(state.dispatches, 0);
  });
}

test('anonymous Supabase Auth accounts cannot dispatch', async () => {
  const { state, request } = setup();
  state.anonymous = true;
  assert.equal((await request('POST', true)).status, 401);
  assert.equal(state.dispatches, 0);
});

test('authenticated idle request dispatches the scraper with no email inputs', async () => {
  const { state, request } = setup();
  const response = await request('POST', true);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: 'started', estimatedMinutes: 15, previousRunId: 40 });
  assert.equal(state.dispatches, 1);
  assert.equal(state.pending, true);
  const status = await (await request()).json();
  assert.deepEqual(status, { status: 'running', estimatedMinutes: 15, previousRunId: 40 });
});

test('concurrent users dispatch at most once while GitHub has not exposed the run', async () => {
  const { state, request } = setup();
  const responses = await Promise.all([request('POST', true), request('POST', true)]);
  const statuses = await Promise.all(responses.map(async (r) => (await r.json()).status));
  assert.deepEqual(statuses.sort(), ['running', 'started']);
  assert.equal(state.dispatches, 1);
});

test('scheduled run appearing after lease acquisition prevents dispatch', async () => {
  const { state, request } = setup();
  state.afterAcquire = [queued];
  assert.equal((await (await request('POST', true)).json()).status, 'running');
  assert.equal(state.dispatches, 0);
  assert.equal(state.pending, false);
});

for (const boundary of ['githubStatus', 'leaseStatus', 'authStatus']) {
  test(`${boundary} failure fails closed without dispatch`, async () => {
    const { state, request } = setup();
    state[boundary] = 503;
    assert.equal((await request('POST', true)).status, 503);
    assert.equal(state.dispatches, 0);
  });
}

test('GitHub rejects dispatch: release the lease and redact upstream errors', async () => {
  const { state, request } = setup();
  state.dispatchStatus = 403;
  const response = await request('POST', true);
  assert.equal(response.status, 503);
  assert.equal(state.pending, false);
  assert.equal((await response.text()).includes('sensitive detail'), false);
});

test('ambiguous dispatch timeout keeps the lease to prevent immediate duplication', async () => {
  const { state, request } = setup();
  state.dispatchTimeout = true;
  assert.equal((await request('POST', true)).status, 503);
  assert.equal(state.pending, true);
  assert.equal((await (await request('POST', true)).json()).status, 'running');
  assert.equal(state.dispatches, 1);
});

test('preflight and unsupported methods never call external services', async () => {
  const { state, request } = setup();
  const preflight = await request('OPTIONS');
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  assert.equal((await request('DELETE')).status, 405);
  assert.equal(state.requests.length, 0);
});

test('public status requests share a bounded snapshot instead of spending PAT quota per visitor', async () => {
  const { state, request } = setup();
  for (let i = 0; i < 20; i++) {
    const response = await request();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).runId, 40);
  }
  assert.equal(state.requests.filter((r) => r.path.endsWith('/runs')).length, 1);
});

test('public request budget returns a recoverable 429 without more privileged status work', async () => {
  const { state, request } = setup();
  state.requestRemaining = 1;
  assert.equal((await request()).status, 200);
  const before = state.requests.length;
  const rejected = await request();
  assert.equal(rejected.status, 429);
  assert.equal(rejected.headers.get('Retry-After'), '60');
  assert.equal(state.requests.length, before + 1);
});

test('authenticated callers cannot spend unlimited GitHub reads even with many active-run checks', async () => {
  const { state, request } = setup();
  state.runs = [queued];
  state.githubRemaining = 1;
  assert.equal((await request('POST', true)).status, 200);
  const rejected = await request('POST', true);
  assert.equal(rejected.status, 429);
  assert.equal(state.requests.filter((r) => r.path.endsWith('/runs')).length, 1);
  assert.equal(state.dispatches, 0);
});

test('a known read-budget rejection after acquiring a dispatch lease releases that lease', async () => {
  const { state, request } = setup();
  state.githubRemaining = 1;
  assert.equal((await request('POST', true)).status, 429);
  assert.equal(state.pending, false);
  assert.equal(state.dispatches, 0);
});

test('concurrent public cache misses coalesce into one upstream read', async () => {
  const { state, request } = setup();
  const responses = await Promise.all(Array.from({ length: 20 }, () => request()));
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(state.requests.filter((r) => r.path.endsWith('/runs')).length, 1);
});

test('an expired database snapshot is refreshed and only the public projection is stored', async () => {
  const { state, request } = setup();
  state.runs = [{ ...completed, private_actor: 'must-not-be-cached' }];
  await request();
  assert.deepEqual(state.cache, [completed]);
  state.cache = null; // The SQL boundary controls expiry, not an in-process clock.
  state.runs = [queued];
  assert.equal((await (await request()).json()).status, 'running');
  assert.equal(state.requests.filter((r) => r.path.endsWith('/runs')).length, 2);
});

test('a busy cross-instance cache lease fails closed rather than issuing another upstream read', async () => {
  const { state, request } = setup();
  state.statusLease = true;
  assert.equal((await request()).status, 503);
  assert.equal(state.requests.filter((r) => r.path.endsWith('/runs')).length, 0);
});
