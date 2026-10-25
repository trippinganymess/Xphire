import assert from 'node:assert/strict';
import test from 'node:test';
import { createDispatchHandler } from '../supabase/functions/dispatch-workflow/handler.ts';

const config = {
  supabaseUrl: 'https://supabase.test', anonKey: 'offline-anon-key', serviceKey: 'offline-service-key',
  githubToken: 'offline-github-token', owner: 'owner', repo: 'repo',
};
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'verified@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false };
const key = '00000000-0000-4000-8000-000000000010';
const payload = { jobTitle: 'Software Engineer', recipientEmail: user.email, freshersOnly: false, minStars: 3 };

function setup() {
  const state = {
    authStatus: 200, authUser: user, authError: false, rpcError: false, quota: false,
    githubStatus: 204, githubTimeout: false, delayDispatch: false, cooldownElapsed: false,
    requests: [], dispatches: 0, reservations: new Map(),
  };
  let serialization = Promise.resolve();
  const http = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const method = init.method ?? 'GET';
    state.requests.push({ url, method, headers, body: init.body });
    assert.ok(init.signal, 'all outbound work shares a bounded deadline');
    if (url.origin === config.supabaseUrl && url.pathname === '/auth/v1/user') {
      assert.equal(headers.get('apikey'), config.anonKey);
      if (headers.get('Authorization') !== 'Bearer valid-user-token') {
        return Response.json({ message: 'invalid' }, { status: 401 });
      }
      return Response.json(state.authUser ?? { message: 'invalid' }, { status: state.authStatus });
    }
    if (url.origin === config.supabaseUrl && url.pathname.endsWith('/rpc/acquire_email_dispatch')) {
      assert.equal(headers.get('apikey'), config.serviceKey);
      assert.equal(headers.get('Authorization'), `Bearer ${config.serviceKey}`);
      if (state.rpcError) return Response.json({ message: 'secret database detail' }, { status: 500 });
      const args = JSON.parse(init.body);
      const identity = `${args.p_user_id}:${args.p_idempotency_key}`;
      const previous = state.reservations.get(identity);
      const acquire = () => {
        if (previous) {
          if (previous.hash !== args.p_payload_hash) return { status: 'conflict' };
          if (previous.status === 'rejected') {
            if (!state.cooldownElapsed) return { status: 'quota' };
            previous.status = 'reserved';
            return { status: 'acquired' };
          }
          return { status: previous.status };
        }
        if (state.quota) return { status: 'quota' };
        state.reservations.set(identity, { hash: args.p_payload_hash, status: 'reserved' });
        return { status: 'acquired' };
      };
      const result = serialization.then(acquire);
      serialization = result.then(() => undefined);
      return Response.json(await result);
    }
    if (url.origin === config.supabaseUrl && url.pathname.endsWith('/rpc/complete_email_dispatch')) {
      const args = JSON.parse(init.body);
      const record = state.reservations.get(`${args.p_user_id}:${args.p_idempotency_key}`);
      if (record) record.status = args.p_status;
      return Response.json(null);
    }
    if (url.origin === 'https://api.github.com') {
      assert.equal(headers.get('Authorization'), `Bearer ${config.githubToken}`);
      assert.equal(method, 'POST');
      assert.equal(url.pathname, '/repos/owner/repo/actions/workflows/email_jobs.yml/dispatches');
      const body = JSON.parse(init.body);
      assert.equal(body.inputs.recipient_email, user.email);
      assert.equal(body.ref, 'main');
      state.dispatches++;
      if (state.delayDispatch) await new Promise((resolve) => setTimeout(resolve, 30));
      if (state.githubTimeout) throw new Error('secret network detail');
      return new Response(null, { status: state.githubStatus });
    }
    assert.fail(`Unexpected outbound request: ${method} ${url}`);
  };
  const handler = createDispatchHandler(config, http);
  const request = (body = payload, options = {}) => handler(new Request('https://edge.test/dispatch-workflow', {
    method: options.method ?? 'POST',
    headers: {
      ...(options.token === false ? {} : { Authorization: `Bearer ${options.token ?? 'valid-user-token'}` }),
      ...(options.key === false ? {} : { 'Idempotency-Key': options.key ?? key }),
      ...(options.contentLength ? { 'Content-Length': options.contentLength } : {}),
      ...(body === null ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  }));
  return { state, request };
}

test('preflight is supported and other methods are rejected without outbound requests', async () => {
  const { state, request } = setup();
  assert.equal((await request(null, { method: 'OPTIONS' })).status, 200);
  assert.equal((await request(null, { method: 'DELETE' })).status, 405);
  assert.equal(state.requests.length, 0);
});

test('missing, invalid, and expired bearer tokens cannot dispatch', async () => {
  for (const options of [{ token: false }, { token: 'bad-token' }]) {
    const { state, request } = setup();
    if (options.token) state.authStatus = 401;
    assert.equal((await request(payload, options)).status, 401);
    assert.equal(state.dispatches, 0);
  }
  const expired = setup();
  expired.state.authStatus = 401;
  assert.equal((await expired.request()).status, 401);
  assert.equal(expired.state.dispatches, 0);
});

test('anonymous and unconfirmed email accounts cannot dispatch', async () => {
  for (const authUser of [{ ...user, is_anonymous: true }, { ...user, email_confirmed_at: null }]) {
    const { state, request } = setup();
    state.authUser = authUser;
    assert.equal((await request()).status, 403);
    assert.equal(state.dispatches, 0);
  }
});

test('recipient is derived from verified account identity, not request input', async () => {
  const { state, request } = setup();
  assert.equal((await request({ ...payload, recipientEmail: 'other@example.com' })).status, 403);
  assert.equal(state.dispatches, 0);
  assert.equal(state.requests.some(({ url }) => url.hostname === 'api.github.com'), false);
});

test('invalid field types, ranges, and non-integer numeric values are rejected', async (t) => {
  const cases = [
    { ...payload, jobTitle: '' }, { ...payload, jobTitle: 'x'.repeat(101) },
    { ...payload, freshersOnly: 'false' }, { ...payload, minStars: 2.5 },
    { ...payload, minStars: 0 }, { ...payload, minStars: 6 },
  ];
  for (const body of cases) await t.test(JSON.stringify(body).slice(0, 45), async () => {
    const { state, request } = setup();
    assert.equal((await request(body)).status, 400);
    assert.equal(state.dispatches, 0);
  });
});

test('body over 4KB and missing or malformed idempotency keys are rejected', async () => {
  const large = setup();
  assert.equal((await large.request(`{"jobTitle":"${'x'.repeat(4100)}"}`)).status, 413);
  assert.equal(large.state.requests.length, 0);
  for (const badKey of [false, 'not-a-uuid']) {
    const attempt = setup();
    assert.equal((await attempt.request(payload, { key: badKey })).status, 400);
    assert.equal(attempt.state.dispatches, 0);
  }
});

test('same key concurrent requests and accepted replay dispatch at most once', async () => {
  const { state, request } = setup();
  state.delayDispatch = true;
  const responses = await Promise.all([request(), request()]);
  assert.ok(responses.every((response) => response.status === 202));
  assert.equal(state.dispatches, 1);
  assert.equal((await request()).status, 202);
  assert.equal(state.dispatches, 1);
});

test('same key with a changed payload conflicts', async () => {
  const { state, request } = setup();
  assert.equal((await request()).status, 202);
  assert.equal((await request({ ...payload, jobTitle: 'Changed' })).status, 409);
  assert.equal(state.dispatches, 1);
});

test('durable quota denial happens before GitHub dispatch', async () => {
  const { state, request } = setup();
  state.quota = true;
  assert.equal((await request()).status, 429);
  assert.equal(state.dispatches, 0);
});

test('definite upstream rejection is sanitized and permits same-key safe retry', async () => {
  const { state, request } = setup();
  state.githubStatus = 422;
  const rejected = await request();
  assert.equal(rejected.status, 502);
  const rejectedText = await rejected.text();
  assert.equal(rejectedText.includes('offline-github-token'), false);
  assert.equal(rejectedText.includes('sensitive'), false);
  state.githubStatus = 204;
  assert.equal((await request()).status, 429);
  assert.equal(state.dispatches, 1);
  state.cooldownElapsed = true;
  assert.equal((await request()).status, 202);
  assert.equal(state.dispatches, 2);
});

test('ambiguous upstream timeout fails closed and retains idempotency reservation', async () => {
  const { state, request } = setup();
  state.githubTimeout = true;
  const response = await request();
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('secret network detail'), false);
  state.githubTimeout = false;
  assert.equal((await request()).status, 202);
  assert.equal(state.dispatches, 1);
});

test('upstream and database errors never reveal secrets', async () => {
  const { state, request } = setup();
  state.rpcError = true;
  const response = await request();
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.equal(text.includes('secret database detail'), false);
  assert.equal(text.includes(config.serviceKey), false);
});
