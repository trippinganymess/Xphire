import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// This suite writes fixtures. It is NEVER part of ordinary credential-free tests.
if (process.env.XPHIRE_DISPOSABLE_DB !== '1' || !process.env.PGHOST || !process.env.PGDATABASE) {
  throw new Error('Use an explicitly marked disposable PostgreSQL database for concurrency tests');
}
const execute = promisify(execFile);
async function sql(statement) {
  const { stdout } = await execute('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { timeout: 10_000 });
  return stdout.trim().split('\n').filter(Boolean);
}
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const user = '33333333-3333-4333-8333-333333333333';

// Holding the winning transaction briefly makes independent psql sessions overlap.
function acquire(statement) {
  return sql(`begin; set local role service_role; ${statement}; select pg_sleep(0.2); commit;`);
}

test('two concurrent dispatch lease acquisitions have exactly one winner', async () => {
  await sql("update public.job_refresh_lease set expires_at = '-infinity', token = null");
  const outcomes = (await Promise.all([first, second].map((token) => acquire(
    `select public.acquire_job_refresh_lease('${token}')`,
  )))).flat().filter((value) => value === 't' || value === 'f');
  assert.deepEqual(outcomes.sort(), ['f', 't']);
  await sql("update public.job_refresh_lease set expires_at = '-infinity', token = null");
});

test('concurrent GitHub read admissions cannot exceed the remaining budget', async () => {
  await sql("update public.job_refresh_budget set window_started_at = clock_timestamp(), used = 11 where kind = 'github'");
  const outcomes = (await Promise.all([1, 2].map(() => acquire(
    "select public.reserve_job_refresh_budget('github')",
  )))).flat().filter((value) => value === 't' || value === 'f');
  assert.deepEqual(outcomes.sort(), ['f', 't']);
  await sql("update public.job_refresh_budget set window_started_at = '-infinity', used = 0 where kind = 'github'");
});

test('concurrent cache misses elect only one cross-instance status fetch owner', async () => {
  await sql("update public.job_refresh_status_cache set workflow_runs = null, updated_at = '-infinity', fetch_expires_at = '-infinity', fetch_token = null");
  const outcomes = (await Promise.all([first, second].map((token) => acquire(
    `select public.claim_job_refresh_status('${token}')->>'kind'`,
  )))).flat().filter((value) => value === 'fetch' || value === 'busy');
  assert.deepEqual(outcomes.sort(), ['busy', 'fetch']);
  await sql("update public.job_refresh_status_cache set fetch_expires_at = '-infinity', fetch_token = null");
});

test('different concurrent replay keys cannot bypass the same user cooldown', async () => {
  await sql(`insert into auth.users(id) values ('${user}');`);
  try {
    const outcomes = (await Promise.all([first, second].map((key) => acquire(
      `select public.acquire_email_dispatch('${user}', '${key}', repeat('a',64))->>'status'`,
    )))).flat().filter((value) => value === 'acquired' || value === 'quota');
    assert.deepEqual(outcomes.sort(), ['acquired', 'quota']);
  } finally {
    await sql(`delete from auth.users where id = '${user}'`);
  }
});
