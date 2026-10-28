import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrivateAccessRequestHandler } from '../supabase/functions/request-private-access/handler.ts';

const config = { supabaseUrl: 'https://database.test', serviceKey: 'offline-service-key',
  githubToken: 'offline-github-key', owner: 'trippinganymess', repo: 'Xphire' };
const user = { id: '10000000-0000-0000-0000-000000000001', is_anonymous: false,
  email: 'candidate@example.test', email_confirmed_at: '2026-10-28T10:00:00Z' };
const requestId = '30000000-0000-0000-0000-000000000001';
const nextAllowedAt = '2026-10-30T10:00:00Z';
const form = { name: 'Candidate', message: 'Frontend roles, please.' };

function fixture(options = {}) {
  const calls = [];
  const http = async (url, init) => {
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    calls.push({ url, authorization: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/auth/v1/user')) return Response.json(options.user === undefined ? user : options.user,
      { status: options.authStatus ?? 200 });
    if (url.endsWith('/claim_private_job_access_request')) {
      return Response.json(Object.hasOwn(options, 'claim') ? options.claim : { status: 'claimed', request_id: requestId, next_allowed_at: nextAllowedAt },
        { status: options.claimStatus ?? 200 });
    }
    if (url.endsWith('/dispatches')) {
      if (options.stallDispatch) return new Promise(() => {});
      if (options.dispatchError) throw new Error(config.githubToken + ' private upstream error');
      return new Response(options.dispatchStatus && options.dispatchStatus !== 204 ? config.githubToken : null,
        { status: options.dispatchStatus ?? 204 });
    }
    if (url.endsWith('/set_private_job_access_notification')) {
      return Response.json(options.queueResult ?? true, { status: options.queueStatus ?? 200 });
    }
    assert.fail('Unexpected HTTP call: ' + url);
  };
  return { calls, handler: createPrivateAccessRequestHandler(options.config ?? config, http) };
}

function post(body = form, extra = {}) {
  return new Request('https://edge.test/request-private-access', { method: 'POST',
    headers: { Authorization: 'Bearer offline-user-token', 'Content-Type': 'application/json', ...extra.headers },
    body: JSON.stringify(body), ...extra });
}

test('verified requests save only the Auth owner/email and dispatch only a saved UUID', async () => {
  const { handler, calls } = fixture();
  const response = await handler(post({ name: '  Candidate  ', message: 'Frontend\r\nPlease.' }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: 'queued', requestId, nextAllowedAt });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[1].body, { p_user_id: user.id, p_email: user.email, p_name: 'Candidate', p_message: 'Frontend\nPlease.' });
  assert.equal(calls[1].authorization, 'Bearer offline-service-key');
  assert.equal(calls[2].url, 'https://api.github.com/repos/trippinganymess/Xphire/actions/workflows/request_private_access.yml/dispatches');
  assert.deepEqual(calls[2].body, { ref: 'main', inputs: { request_id: requestId } });
  assert.deepEqual(calls[3].body, { p_request_id: requestId, p_status: 'queued' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

for (const authorization of ['', 'Basic x', 'Bearer', 'Bearer one two', 'Bearer injected,token']) {
  test('malformed authorization cannot store or dispatch: ' + authorization, async () => {
    const { handler, calls } = fixture();
    assert.equal((await handler(post(form, { headers: { Authorization: authorization } }))).status, 401);
    assert.equal(calls.length, 0);
  });
}
for (const authStatus of [401, 403, 500]) {
  test('Auth failure ' + authStatus + ' stops before request storage', async () => {
    const { handler, calls } = fixture({ authStatus });
    assert.equal((await handler(post())).status, authStatus === 500 ? 503 : 401);
    assert.equal(calls.length, 1);
  });
}
for (const identity of [null, {}, { ...user, is_anonymous: true }, { ...user, id: 'not-a-uuid' }, { ...user, is_anonymous: undefined }]) {
  test('unverified identity cannot request access: ' + JSON.stringify(identity), async () => {
    const { handler, calls } = fixture({ user: identity });
    assert.equal((await handler(post())).status, 401);
    assert.equal(calls.length, 1);
  });
}
for (const identity of [{ ...user, email_confirmed_at: null }, { ...user, email_confirmed_at: 'invalid' },
  { ...user, email: 'candidate\nBcc: victim@example.test' }, { ...user, email: 'invalid' }]) {
  test('only a confirmed account email can request access: ' + JSON.stringify(identity), async () => {
    const { handler, calls } = fixture({ user: identity });
    assert.equal((await handler(post())).status, 403);
    assert.equal(calls.length, 1);
  });
}
for (const body of [{ ...form, user_id: user.id }, { ...form, email: 'spoof@example.test' },
  { ...form, recipient: 'other@example.test' }, { ...form, workflow: 'email_jobs.yml' },
  { ...form, active: true }, { name: '', message: '' }, { name: 'a'.repeat(81), message: '' },
  { name: 'Header\nInjection', message: '' }, { name: 'Candidate', message: '\0' },
  { name: 'Candidate', message: 'a'.repeat(1001) }, null, [], { name: 'Candidate' }]) {
  test('invalid or spoofed fields consume no request allowance: ' + JSON.stringify(body).slice(0, 100), async () => {
    const { handler, calls } = fixture();
    assert.equal((await handler(post(body))).status, 400);
    assert.equal(calls.length, 1);
  });
}
for (const claim of [
  { status: 'forbidden' },
  { status: 'already_allowed' },
  { status: 'cooldown', next_allowed_at: nextAllowedAt },
]) {
  test('claim ' + claim.status + ' never dispatches mail', async () => {
    const { handler, calls } = fixture({ claim });
    const response = await handler(post());
    assert.equal(response.status, claim.status === 'forbidden' ? 401 : claim.status === 'cooldown' ? 429 : 200);
    assert.equal(calls.length, 2);
    if (claim.status === 'already_allowed') assert.deepEqual(await response.json(), { status: 'already_allowed' });
    if (claim.status === 'cooldown') assert.deepEqual(await response.json(), { code: 'already_requested', nextAllowedAt });
  });
}
for (const claim of [null, [], { status: 'claimed', request_id: 'bad', next_allowed_at: nextAllowedAt },
  { status: 'claimed', request_id: requestId, next_allowed_at: 'bad' }, { status: 'unexpected' }]) {
  test('invalid storage response cannot dispatch: ' + JSON.stringify(claim), async () => {
    const { handler, calls } = fixture({ claim });
    const response = await handler(post());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: 'request_storage_unavailable' });
    assert.equal(calls.length, 2);
  });
}
test('storage failures stop before dispatch and never expose raw errors', async () => {
  const { handler, calls } = fixture({ claimStatus: 500 });
  const response = await handler(post());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'request_storage_unavailable' });
  assert.equal(calls.length, 2);
});
for (const options of [{ dispatchStatus: 403 }, { dispatchStatus: 500 }, { dispatchError: true }]) {
  test('unconfirmed queue submission retains the claim with no automatic retry: ' + JSON.stringify(options), async () => {
    const { handler, calls } = fixture(options);
    const response = await handler(post());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: 'notification_unavailable' });
    assert.equal(calls.length, 3);
  });
}
test('a stalled dispatch is bounded by the request abort signal', async () => {
  const { handler, calls } = fixture({ stallDispatch: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20);
  try {
    const response = await handler(post(form, { signal: controller.signal }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: 'notification_unavailable' });
    assert.equal(calls.length, 3);
  } finally { clearTimeout(timer); }
});
test('an already-aborted request observes transport rejection without an unhandled error', async () => {
  const handler = createPrivateAccessRequestHandler(config, async () => {
    throw new Error('Synthetic rejected transport');
  });
  const controller = new AbortController();
  controller.abort();
  const response = await handler(post(form, { signal: controller.signal }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'authentication_unavailable' });
  // Node's test runner fails on any orphaned rejection in this event-loop turn.
  await new Promise((resolve) => setImmediate(resolve));
});
for (const options of [{ queueStatus: 500 }, { queueResult: false }]) {
  test('a queue acknowledgement remains successful if its status update fails: ' + JSON.stringify(options), async () => {
    const { handler } = fixture(options);
    assert.equal((await handler(post())).status, 202);
  });
}
test('invalid configuration makes no HTTP requests or credential-bearing redirects', async () => {
  for (const invalid of [{ ...config, githubToken: '' }, { ...config, serviceKey: '\ninvalid' },
    { ...config, supabaseUrl: 'http://database.test' }, { ...config, owner: '../other' }]) {
    const { handler, calls } = fixture({ config: invalid });
    const response = await handler(post());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: 'service_not_configured' });
    assert.equal(calls.length, 0);
  }
});
test('preflight and non-POST requests never authenticate, store, or send mail', async () => {
  const { handler, calls } = fixture();
  const preflight = await handler(new Request('https://edge.test', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await handler(new Request('https://edge.test', { method }))).status, 405);
  }
  assert.equal(calls.length, 0);
});
