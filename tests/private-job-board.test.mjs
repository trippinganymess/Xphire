import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PRIVATE_DISCOVERY_PRESETS, privateDiscoveryPreset } from '../shared/privateDiscoveryPresets.ts';
import { createPrivateJobBoardHandler } from '../supabase/functions/private-job-board/handler.ts';

const config = { supabaseUrl: 'https://supabase.test', serviceKey: 'offline-service-secret', theirStackKey: 'offline-provider-secret' };
const USER = '10000000-0000-0000-0000-000000000001';
const OTHER = '10000000-0000-0000-0000-000000000002';
const NEXT = '2026-10-29T12:00:00.000Z';
const job = { id: 19, company: 'Real company', job_title: 'Frontend Developer', location: 'India', seniority: 'junior',
  salary_min: 500000, salary_max: 800000, salary_currency: 'INR', date_posted: '2026-10-28',
  url: 'https://jobs.test/apply?id=19&utm_source=tracking#details', description: 'PRIVATE_DESCRIPTION' };

function setup(overrides = {}) {
  const state = { user: { id: USER, is_anonymous: false }, authStatus: 200, entitled: true,
    providerStatus: 200, payload: { data: [job] }, providerThrow: false, providerResponse: null,
    authResponse: null, rpcOverride: null, revokeAtProvider: false, finishThrow: false,
    requests: [], scans: new Map(), saved: new Map(), providerCalls: 0, ...overrides };
  const http = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(init.body) : null;
    state.requests.push({ url: String(input), path: url.pathname, method: init.method ?? 'GET', headers, body, signal: init.signal });
    assert.ok(init.signal, 'Every network call shares the total deadline');
    assert.equal(init.redirect, 'error', 'Never forward credentials on redirects');
    if (url.origin === config.supabaseUrl) {
      assert.equal(headers.get('apikey'), config.serviceKey);
      if (url.pathname === '/auth/v1/user') {
        assert.equal(headers.get('authorization'), 'Bearer verified-user-token');
        assert.equal(init.method ?? 'GET', 'GET');
        return state.authResponse?.() ?? Response.json(state.user, { status: state.authStatus });
      }
      assert.equal(headers.get('authorization'), `Bearer ${config.serviceKey}`);
      assert.equal(init.method, 'POST');
      assert.match(body.p_user_id, /^[0-9a-f-]{36}$/);
      assert.match(body.p_token, /^[0-9a-f-]{36}$/);
      if (state.rpcOverride) {
        const response = state.rpcOverride(url.pathname, body);
        if (response) return response;
      }
      const scan = state.scans.get(body.p_user_id);
      if (url.pathname.endsWith('/claim_private_job_scan')) {
        assert.deepEqual(Object.keys(body).sort(), ['p_query', 'p_token', 'p_user_id']);
        if (!state.entitled) return Response.json({ status: 'forbidden' });
        if (scan) return Response.json({ status: scan.status === 'running' ? 'running' : 'quota', next_allowed_at: NEXT });
        state.scans.set(body.p_user_id, { token: body.p_token, status: 'running', query: body.p_query });
        return Response.json({ status: 'claimed', next_allowed_at: NEXT });
      }
      if (url.pathname.endsWith('/finish_private_job_scan')) {
        assert.deepEqual(Object.keys(body).sort(), ['p_jobs', 'p_token', 'p_user_id']);
        if (state.finishThrow) throw new Error('PRIVATE_DB_ERROR ' + config.serviceKey);
        if (!state.entitled) return Response.json({ status: 'forbidden' });
        if (scan?.token !== body.p_token || scan.status !== 'running') return Response.json({ status: 'lost' });
        state.saved.set(body.p_user_id, body.p_jobs);
        scan.status = 'completed';
        return Response.json({ status: 'completed', jobs_saved: body.p_jobs.length, next_allowed_at: NEXT });
      }
      if (url.pathname.endsWith('/fail_private_job_scan')) {
        assert.deepEqual(Object.keys(body).sort(), ['p_token', 'p_user_id']);
        if (scan?.token === body.p_token && scan.status === 'running') scan.status = 'failed';
        return Response.json(null);
      }
    }
    if (url.origin === 'https://api.theirstack.com') {
      assert.equal(url.pathname, '/v1/jobs/search');
      assert.equal(url.search, '');
      assert.equal(init.method, 'POST');
      assert.equal(headers.get('authorization'), `Bearer ${config.theirStackKey}`);
      assert.deepEqual(body, { job_title_or: [...privateDiscoveryPreset(state.scans.get(state.user.id).query).titles], job_country_code_or: ['IN'],
        posted_at_max_age_days: 1, job_seniority_or: ['junior'], employment_statuses_or: ['full_time', 'internship'],
        workplace_types_or: ['remote', 'hybrid', 'on_site'], limit: 10, page: 0 });
      state.providerCalls++;
      if (state.revokeAtProvider) state.entitled = false;
      if (state.providerThrow) throw new Error('PRIVATE_NETWORK_ERROR ' + config.theirStackKey);
      return state.providerResponse?.(init.signal) ?? Response.json(state.payload, { status: state.providerStatus });
    }
    assert.fail(`Unexpected external request: ${input}`);
  };
  const handler = createPrivateJobBoardHandler(config, http);
  const request = (body = { query: ' frontend developer ' }, options = {}) => handler(new Request('https://edge.test/private-job-board', {
    method: 'POST', headers: { Authorization: 'Bearer verified-user-token', 'Content-Type': 'application/json', ...options.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body), ...Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'headers')),
  }));
  return { state, http, handler, request };
}

function assertSafe(value) {
  for (const secret of ['PRIVATE_', config.serviceKey, config.theirStackKey]) assert.equal(JSON.stringify(value).includes(secret), false);
}

test('authenticated paid POST claims first, makes exactly one fixed search, and saves only cards to its verified user', async () => {
  const { state, request } = setup();
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'completed', jobsSaved: 1, nextAllowedAt: NEXT });
  assert.deepEqual(state.requests.map((r) => r.path), ['/auth/v1/user', '/rest/v1/rpc/claim_private_job_scan',
    '/v1/jobs/search', '/rest/v1/rpc/finish_private_job_scan']);
  assert.equal(state.providerCalls, 1);
  assert.equal(new Set(state.requests.map((r) => r.signal)).size, 1);
  assert.deepEqual(state.saved.get(USER), [{ job_id: 'theirstack:19', company: 'Real company', title: 'Frontend Developer',
    location: 'India', experience: 'junior', salary: 'INR 500000–800000', posted_date: '2026-10-28', url: 'https://jobs.test/apply?id=19' }]);
  assertSafe(state.saved.get(USER));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

for (const token of ['', 'Basic abc', 'Bearer', 'Bearer one two', 'Bearer one,two']) {
  test(`missing/malformed authorization ${JSON.stringify(token)} rejects before HTTP`, async () => {
    const { state, request } = setup();
    assert.equal((await request(undefined, { headers: { Authorization: token } })).status, 401);
    assert.equal(state.requests.length, 0);
  });
}
for (const authStatus of [401, 403]) {
  test(`invalid/expired Auth token (${authStatus}) cannot claim or call provider`, async () => {
    const { state, request } = setup({ authStatus });
    assert.equal((await request()).status, 401);
    assert.equal(state.requests.length, 1);
  });
}
for (const user of [{ id: USER, is_anonymous: true }, { id: 'not-a-uuid', is_anonymous: false },
  { id: OTHER + "' OR true", is_anonymous: false }, { id: USER }, {}, null, []]) {
  test(`unverified/anonymous identity is rejected: ${JSON.stringify(user)}`, async () => {
    const { state, request } = setup({ user });
    assert.equal((await request()).status, 401);
    assert.equal(state.requests.length, 1);
  });
}

test('unpaid/expired entitlement stops at server-only claim', async () => {
  const { state, request } = setup({ entitled: false });
  assert.equal((await request()).status, 403);
  assert.equal(state.providerCalls, 0);
  assert.equal(state.saved.size, 0);
});

test('revocation after discovery is rechecked by finish and cannot save jobs', async () => {
  const { state, request } = setup({ revokeAtProvider: true });
  assert.equal((await request()).status, 403);
  assert.equal(state.providerCalls, 1);
  assert.equal(state.saved.size, 0);
  assert.equal(state.scans.get(USER).status, 'failed');
});

test('two concurrent clicks contend on one durable claim, with no duplicate provider request', async () => {
  const { state, request } = setup();
  const responses = await Promise.all([request(), request()]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await responses.find((r) => r.status === 409).json()).nextAllowedAt, NEXT);
  assert.equal(state.providerCalls, 1);
});

test('completed scan returns rolling quota 429; changing query does not evade quota', async () => {
  const { state, request } = setup();
  await request();
  const response = await request({ query: 'python developer' });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).nextAllowedAt, NEXT);
  assert.equal(state.providerCalls, 1);
});

test('different verified users have independent scans and private saves', async () => {
  const { state, request } = setup();
  await request();
  state.user = { id: OTHER, is_anonymous: false };
  await request();
  assert.equal(state.providerCalls, 2);
  assert.deepEqual(Array.from(state.saved.keys()), [USER, OTHER]);
});

for (const body of ['', '{broken', 'null', '[]', '{}', '{"query":null}', '{"query":123}', '{"query":" "}',
  JSON.stringify({ query: 'a'.repeat(121) }), JSON.stringify({ query: 'a\nb' }), JSON.stringify({ query: 'a\u0000b' }),
  JSON.stringify({ query: 'a\u2028b' }), JSON.stringify({ query: 'a\u200bb' }), JSON.stringify({ query: '\ud800' }),
  JSON.stringify({ query: 'dev', user_id: OTHER }), JSON.stringify({ query: 'dev', limit: 100 }),
  JSON.stringify({ query: 'dev', job_country_code_or: ['US'] }), ' '.repeat(2049)]) {
  test(`invalid request never consumes quota: ${body.slice(0, 55)}`, async () => {
    const { state, request } = setup();
    assert.equal((await request(body)).status, 400);
    assert.equal(state.requests.length, 1);
    assert.equal(state.scans.size, 0);
  });
}

test('unsupported printable queries are rejected before consuming the allowance', async () => {
  for (const query of ['🚀'.repeat(120), 'unknown job', 'Frontend Developer', 'constructor']) {
    const { state, request } = setup();
    const response = await request({ query });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'invalid_preset');
    assert.equal(state.scans.size, 0);
    assert.equal(state.providerCalls, 0);
  }
});

for (const preset of PRIVATE_DISCOVERY_PRESETS) {
  test(`preset ${preset.value} uses fixed title alternatives in exactly one provider request`, async () => {
    const { state, request } = setup();
    assert.equal((await request({ query: preset.value })).status, 200);
    assert.equal(state.providerCalls, 1);
    const provider = state.requests.find((r) => r.path === '/v1/jobs/search');
    assert.deepEqual(provider.body.job_title_or, [...preset.titles]);
    assert.equal(provider.body.limit, 10);
    assert.equal(provider.body.page, 0);
  });
}

test('wrong content type and dishonest/malformed content-length fail before claim', async () => {
  for (const headers of [{ 'Content-Type': 'text/plain' }, { 'Content-Length': '2049' }, { 'Content-Length': '-2' }]) {
    const { state, request } = setup();
    assert.equal((await request({ query: 'dev' }, { headers })).status, 400);
    assert.equal(state.scans.size, 0);
  }
});

test('streamed request exceeds byte budget despite small declared length', async () => {
  const { state, request } = setup();
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(' '.repeat(2049))); c.close(); } });
  assert.equal((await request(null, { body, duplex: 'half', headers: { 'Content-Length': '1' } })).status, 400);
  assert.equal(state.scans.size, 0);
});

for (const status of [201, 400, 401, 403, 429, 500, 503, 302]) {
  test(`provider HTTP ${status} is sanitized, not retried, and consumes budget`, async () => {
    const { state, request } = setup({ providerStatus: status, payload: { error: 'PRIVATE_BODY ' + config.theirStackKey } });
    const response = await request();
    assert.equal(response.status, 502);
    assertSafe(await response.json());
    assert.equal(state.scans.get(USER).status, 'failed');
    assert.equal((await request()).status, 429);
    assert.equal(state.providerCalls, 1);
    assert.equal(state.saved.size, 0);
  });
}

test('provider transport exception and failed DB completion have safe distinct errors and no retries', async () => {
  for (const [override, expected] of [[{ providerThrow: true }, 502], [{ finishThrow: true }, 503]]) {
    const { state, request } = setup(override);
    const response = await request();
    assert.equal(response.status, expected);
    assertSafe(await response.json());
    assert.equal(state.scans.get(USER).status, 'failed');
    assert.equal(state.providerCalls, 1);
    assert.equal(state.saved.size, 0);
  }
});

for (const payload of [null, [], {}, { data: {} }, { data: [null] }, { data: [{ id: 1 }] },
  { data: [job, { job_title: '' }] }, { data: Array(11).fill(job) }, { data: [{ ...job, job_title: config.theirStackKey }] }]) {
  test(`malformed/unsafe provider schema fails atomically: ${JSON.stringify(payload).slice(0, 55)}`, async () => {
    const { state, request } = setup({ payload });
    const response = await request();
    assert.equal(response.status, 502);
    assertSafe(await response.json());
    assert.equal(state.providerCalls, 1);
    assert.equal(state.saved.size, 0);
  });
}

test('empty valid search is a completed zero-card scan and still consumes quota', async () => {
  const { state, request } = setup({ payload: { data: [] } });
  assert.deepEqual(await (await request()).json(), { status: 'completed', jobsSaved: 0, nextAllowedAt: NEXT });
  assert.equal((await request()).status, 429);
  assert.equal(state.providerCalls, 1);
});

for (const providerResponse of [() => new Response('{broken'),
  () => new Response(new Uint8Array([0xff])),
  () => new Response('x', { headers: { 'Content-Length': '1048577' } }),
  () => new Response(' '.repeat(1024 * 1024 + 1), { headers: { 'Content-Length': '1' } }),
  () => new Response(new ReadableStream({ start(c) { c.error(new Error('PRIVATE_READ_ERROR')); } }))]) {
  test('malformed, oversized, invalid UTF8, and broken provider streams are bounded and safe', async () => {
    const { state, request } = setup({ providerResponse });
    const response = await request();
    assert.equal(response.status, 502);
    assertSafe(await response.json());
    assert.equal(state.saved.size, 0);
  });
}

test('aborting a stalled provider body or HTTP promise returns promptly without a retry or fresh budget', async () => {
  for (const providerResponse of [() => new Response(new ReadableStream({ start() {} })), () => new Promise(() => {})]) {
    const { state, request } = setup({ providerResponse });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30);
    const started = Date.now();
    const response = await request(undefined, { signal: controller.signal });
    clearTimeout(timer);
    assert.equal(response.status, 502);
    assert.ok(Date.now() - started < 1000);
    assert.equal(state.providerCalls, 1);
    assert.equal(state.saved.size, 0);
    assert.equal(state.scans.size, 1);
  }
});

for (const posted of ['2024-02-29', '2023-02-29', '2026-02-30', '2026-13-01', '0000-01-01',
  '2026-10-28T12:00:00Z', '2026-10-28T12:00:00+05:30', '2026-10-28T12:00:00', null, 10]) {
  test(`source date retains only actual date-only values, never invented UTC: ${posted}`, async () => {
    const { state, request } = setup({ payload: { data: [{ ...job, date_posted: posted }] } });
    assert.equal((await request()).status, 200);
    assert.equal(state.saved.get(USER)[0].posted_date, posted === '2024-02-29' ? posted : null);
    assert.equal('posted_at' in state.saved.get(USER)[0], false);
  });
}

for (const [final_url, url, expected] of [
  ['https://Example.test/final?UTM_SOURCE=x&gclid=z&id=1#fragment', job.url, 'https://example.test/final?id=1'],
  ['javascript:alert(1)', job.url, 'https://jobs.test/apply?id=19'],
  ['https://user:pass@evil.test/job', 'http://jobs.test/job?fbclid=x&source=ad&job=42', 'http://jobs.test/job?job=42'],
  ['https://jobs.test:invalid/job', 'data:text/plain,job', null],
  [null, '/relative/job', null], ['https://jobs.test/a\nb', null, null],
  [null, 'https://jobs.test/job?utm_custom=x&referrer=a&msclkid=z&job=1', 'https://jobs.test/job?job=1'],
]) {
  test(`URL preference, fallback, credentials and tracking: ${final_url}`, async () => {
    const { state, request } = setup({ payload: { data: [{ ...job, final_url, url }] } });
    await request();
    assert.equal(state.saved.get(USER)[0].url, expected);
  });
}

test('optional fields stay unknown; no fabricated salary, rating, experience or fresher claims', async () => {
  const { state, request } = setup({ payload: { data: [{ job_title: 'Engineer', company_object: { name: 'Actual' } }] } });
  await request();
  const card = state.saved.get(USER)[0];
  assert.match(card.job_id, /^theirstack:hash:[a-f0-9]{64}$/);
  assert.equal(card.company, 'Actual');
  for (const key of ['experience', 'salary', 'location', 'url', 'posted_date']) assert.equal(card[key], null);
  assert.equal('rating' in card, false);
  assert.equal('scraped_at' in card, false, 'DB supplies discovery time, not provider posting time');
});

test('provider duplicate IDs are deduplicated before the atomic upsert', async () => {
  const { state, request } = setup({ payload: { data: [job, { ...job, job_title: 'Updated title' }] } });
  assert.equal((await (await request()).json()).jobsSaved, 1);
  assert.equal(state.saved.get(USER)[0].title, 'Updated title');
});

for (const override of [
  { authStatus: 503 }, { authResponse: () => new Response('{broken') },
  { authResponse: () => new Response('x', { status: 302, headers: { Location: 'https://evil.test' } }) },
  { rpcOverride: () => new Response('PRIVATE_RPC_ERROR', { status: 503 }) },
  { rpcOverride: () => Response.json({ status: 'claimed', next_allowed_at: 'PRIVATE_INVALID_DATE' }) },
  { rpcOverride: () => Response.json({ status: 'unexpected' }) },
]) {
  test('unavailable Auth/claim, redirects and malformed DB responses fail closed', async () => {
    const { state, request } = setup(override);
    const response = await request();
    assert.equal(response.status, 503);
    assertSafe(await response.json());
    assert.equal(state.providerCalls, 0);
  });
}

test('failure cleanup outage never refunds quota or leaks error details', async () => {
  const { state, request } = setup({ providerThrow: true,
    rpcOverride: (path) => path.endsWith('/fail_private_job_scan') ? new Response('PRIVATE_FAILURE', { status: 500 }) : null });
  assert.equal((await request()).status, 502);
  assert.equal(state.scans.get(USER).status, 'running');
  assert.equal((await request()).status, 409);
  assert.equal(state.providerCalls, 1);
});

test('discovery failure codes identify setup and save failures without leaking upstream errors', async () => {
  const cases = [
    [{ providerThrow: true }, 'provider_unavailable'],
    [{ payload: { data: {} } }, 'provider_response_invalid'],
    [{ finishThrow: true }, 'private_save_unavailable'],
    [{ authStatus: 503 }, 'authentication_unavailable'],
    [{ rpcOverride: () => new Response('PRIVATE_ERROR', { status: 503 }) }, 'scan_claim_unavailable'],
  ];
  for (const [override, code] of cases) {
    const { request } = setup(override);
    const response = await request();
    const result = await response.json();
    assert.equal(result.code, code);
    assertSafe(result);
  }
});

test('invalid/missing server config fails without any HTTP, no public provider fallback', async () => {
  for (const invalid of [{ theirStackKey: '' }, { theirStackKey: 'bad\nkey' }, { serviceKey: '' },
    { supabaseUrl: 'http://supabase.test' }, { supabaseUrl: 'https://user:pass@supabase.test' }]) {
    const { state, http } = setup();
    const handler = createPrivateJobBoardHandler({ ...config, ...invalid }, http);
    const response = await handler(new Request('https://edge.test', { method: 'POST', headers: { Authorization: 'Bearer abc' } }));
    assert.equal(response.status, 503);
    assertSafe(await response.json());
    assert.equal(state.requests.length, 0);
  }
});

test('OPTIONS and all non-POST methods require no services and expose POST only', async () => {
  const { state, handler } = setup();
  const response = await handler(new Request('https://edge.test', { method: 'OPTIONS' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD']) assert.equal((await handler(new Request('https://edge.test', { method }))).status, 405);
  assert.equal(state.requests.length, 0);
});

test('actual local HTTP endpoint runs the web-standard handler through a paid POST', async (t) => {
  const { handler, state } = setup();
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await handler(new Request('http://localhost/private-job-board', {
        method: req.method, headers: req.headers, body: Buffer.concat(chunks),
      }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch { res.writeHead(500); res.end('Endpoint failed'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/private-job-board`, {
    method: 'POST', headers: { Authorization: 'Bearer verified-user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'frontend developer' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'completed', jobsSaved: 1, nextAllowedAt: NEXT });
  assert.equal(state.providerCalls, 1);
});

test('Deno entrypoint uses canonical key first and trimmed legacy fallback, never client/payment flags', async () => {
  const oldDeno = globalThis.Deno;
  const oldFetch = globalThis.fetch;
  try {
    for (const [canonical, legacy, expected] of [[' canonical-key ', 'legacy-key', 'canonical-key'], ['   ', ' legacy-key ', 'legacy-key']]) {
      let served;
      globalThis.Deno = { env: { get: (key) => ({ SUPABASE_URL: config.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: config.serviceKey,
        THEIRSTACK_API_KEY: canonical, THEIR_STACK_API_KEY: legacy })[key] }, serve: (handler) => { served = handler; } };
      const { http } = setup();
      globalThis.fetch = async (input, init) => {
        const url = input instanceof URL ? input : new URL(String(input));
        if (url.protocol === 'https:' && url.hostname === 'api.theirstack.com') {
          assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${expected}`);
          return Response.json({ data: [] });
        }
        return http(input, init);
      };
      await import(`../supabase/functions/private-job-board/index.ts?key=${expected}`);
      assert.equal(typeof served, 'function');
      const response = await served(new Request('https://edge.test', { method: 'POST',
        headers: { Authorization: 'Bearer verified-user-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'frontend developer' }) }));
      assert.equal(response.status, 200);
    }
  } finally { globalThis.Deno = oldDeno; globalThis.fetch = oldFetch; }
});
