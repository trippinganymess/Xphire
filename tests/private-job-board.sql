-- Run only on a disposable PostgreSQL database after 004_private_job_board.sql.
-- Requires Supabase-compatible auth.users(id, is_anonymous), auth.uid(), auth.jwt(),
-- and anon/authenticated/service_role (BYPASSRLS) roles. No provider/network calls.
-- psql -v ON_ERROR_STOP=1 -f tests/private-job-board.sql "$DISPOSABLE_DATABASE_URL"
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Assertion failed: %', message; end if;
end;
$$;

insert into auth.users(id, is_anonymous) values
 ('10000000-0000-0000-0000-000000000001', false),
 ('10000000-0000-0000-0000-000000000002', false),
 ('10000000-0000-0000-0000-000000000003', false),
 ('10000000-0000-0000-0000-000000000004', true),
 ('10000000-0000-0000-0000-000000000005', false),
 ('10000000-0000-0000-0000-000000000006', false);

-- Actual service-role provisioning: paid status is not profile/JWT metadata.
set local role service_role;
insert into public.private_job_entitlements(user_id, active, expires_at) values
 ('10000000-0000-0000-0000-000000000001', true, clock_timestamp() + interval '2 days'),
 ('10000000-0000-0000-0000-000000000002', true, clock_timestamp() + interval '2 days'),
 ('10000000-0000-0000-0000-000000000004', true, clock_timestamp() + interval '2 days'),
 ('10000000-0000-0000-0000-000000000005', true, clock_timestamp() - interval '1 second'),
 ('10000000-0000-0000-0000-000000000006', true, clock_timestamp() + interval '2 days');
reset role;

-- Privileges: no client writes, no token access, no PUBLIC/anon service RPC grants.
do $$
declare r text; signature text; t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach signature in array array['claim_private_job_scan(uuid,uuid,text)',
      'finish_private_job_scan(uuid,uuid,jsonb)', 'fail_private_job_scan(uuid,uuid)'] loop
      perform pg_temp.assert_true(not has_function_privilege(r, 'public.' || signature, 'EXECUTE'), r || ' must not execute ' || signature);
      perform pg_temp.assert_true(has_function_privilege('service_role', 'public.' || signature, 'EXECUTE'), 'service may execute ' || signature);
    end loop;
    foreach t in array array['private_job_entitlements', 'private_jobs', 'private_job_scan_state'] loop
      perform pg_temp.assert_true(not has_table_privilege(r, 'public.' || t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), r || ' cannot write ' || t);
    end loop;
    perform pg_temp.assert_true(not has_column_privilege(r, 'public.private_job_scan_state', 'claim_token', 'SELECT'), r || ' must not read tokens');
  end loop;
  perform pg_temp.assert_true(not has_function_privilege('anon', 'public.private_job_board_access()', 'EXECUTE'), 'anon cannot call access RPC');
  perform pg_temp.assert_true(has_function_privilege('authenticated', 'public.private_job_board_access()', 'EXECUTE'), 'authenticated may call access RPC');
  perform pg_temp.assert_true(not has_table_privilege('anon', 'public.private_jobs', 'SELECT'), 'anon cannot read private jobs');
  perform pg_temp.assert_true(not exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'private_job_board_access' and p.pronargs <> 0), 'access cannot enumerate another identity');
end;
$$;

set local role anon;
do $$
begin
  begin
    perform public.private_job_board_access();
    raise exception 'anon access must fail';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.private_jobs;
    raise exception 'anon job read must fail';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

-- Authenticated nonpaid and anonymous tokens get no access or state enumeration.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","is_anonymous":false,"paid":true,"role":"authenticated"}', true);
select pg_temp.assert_true(public.private_job_board_access() = '{"allowed":false,"next_allowed_at":null,"last_status":null,"last_query":null}'::jsonb,
  'unpaid remains denied despite a paid JWT/profile flag');
select pg_temp.assert_true((select count(*) from public.private_jobs) = 0, 'unpaid has no jobs');
select pg_temp.assert_true((select count(user_id) from public.private_job_scan_state) = 0, 'unpaid has no scan state');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","is_anonymous":true}', true);
select pg_temp.assert_true((public.private_job_board_access()->>'allowed')::boolean = false, 'anonymous token excluded even with entitlement');
select pg_temp.assert_true((select count(*) from public.private_job_entitlements) = 0, 'anonymous token cannot read entitlement');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","is_anonymous":true}', true);
select pg_temp.assert_true((public.private_job_board_access()->>'allowed')::boolean = false, 'anonymous claim on otherwise paid identity excluded');
select set_config('request.jwt.claims', '{}', true);
select pg_temp.assert_true((public.private_job_board_access()->>'allowed')::boolean = false, 'missing auth.uid is denied');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","is_anonymous":false}', true);
select pg_temp.assert_true(public.private_job_board_access() = '{"allowed":true,"next_allowed_at":null,"last_status":null,"last_query":null}'::jsonb, 'new paid user is idle');
do $$
begin
  begin
    insert into public.private_job_entitlements(user_id,active,expires_at) values (auth.uid(),true,now() + interval '1 year');
    raise exception 'client entitlement escalation must fail';
  exception when insufficient_privilege then null; end;
  begin
    update public.private_job_entitlements set expires_at = now() + interval '1 year' where user_id = auth.uid();
    raise exception 'client entitlement extension must fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.claim_private_job_scan(auth.uid(), '20000000-0000-0000-0000-000000000001', 'dev');
    raise exception 'client claim must fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.finish_private_job_scan(auth.uid(), '20000000-0000-0000-0000-000000000001', '[]');
    raise exception 'client finish must fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.fail_private_job_scan(auth.uid(), '20000000-0000-0000-0000-000000000001');
    raise exception 'client fail must fail';
  exception when insufficient_privilege then null; end;
  begin
    perform claim_token from public.private_job_scan_state;
    raise exception 'client token read must fail';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

set local role service_role;
select pg_temp.assert_true(public.claim_private_job_scan('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'dev')->>'status' = 'forbidden', 'nonpaid claim rejected');
select pg_temp.assert_true(public.claim_private_job_scan('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 'dev')->>'status' = 'forbidden', 'anonymous auth.users account rejected');
select pg_temp.assert_true(public.claim_private_job_scan('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', 'dev')->>'status' = 'forbidden', 'expired entitlement rejected');
select pg_temp.assert_true(public.claim_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'frontend developer')->>'status' = 'claimed', 'first claim succeeds');
-- A distinct contender cannot acquire the same user's budget.
select pg_temp.assert_true(public.claim_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'python developer')->>'status' = 'running', 'claim contention is serialized');
select pg_temp.assert_true(public.claim_private_job_scan('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'python developer')->>'status' = 'claimed', 'second user has independent budget');
select pg_temp.assert_true(public.finish_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '[]')->>'status' = 'lost', 'wrong token cannot finish another user');
select public.fail_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002');
select pg_temp.assert_true(public.finish_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
 '[{"user_id":"10000000-0000-0000-0000-000000000002","job_id":"theirstack:1","title":"Frontend Developer","company":"Actual","source":"Other","rating":5,"scraped_at":"2000-01-01T00:00:00Z","posted_date":"2026-10-28","url":"https://jobs.test/1"}]')->>'status' = 'completed', 'matching token finishes after wrong-token fail');
select pg_temp.assert_true(public.finish_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '[]')->>'status' = 'lost', 'finished token replay rejected');
select public.fail_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
select pg_temp.assert_true(public.claim_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'changed query')->>'status' = 'quota', 'success consumes rolling quota');
select pg_temp.assert_true(public.finish_private_job_scan('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002',
 '[{"job_id":"theirstack:1","title":"Python Developer","posted_date":null}]')->>'status' = 'completed', 'same provider ID can belong privately to both users');
reset role;

select pg_temp.assert_true((select count(*) from public.private_jobs) = 2, 'both users have independent PK rows');
select pg_temp.assert_true((select source = 'TheirStack' and rating is null and scraped_at > now() - interval '1 minute'
  and posted_date = '2026-10-28'::date from public.private_jobs where user_id = '10000000-0000-0000-0000-000000000001'), 'source/rating/discovery cannot be spoofed');
select pg_temp.assert_true((select last_status = 'completed' and claim_token is null and next_allowed_at - last_attempt_at = interval '24 hours'
  from public.private_job_scan_state where user_id = '10000000-0000-0000-0000-000000000001'), 'completion is atomic and fail replay cannot overwrite it');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","is_anonymous":false}', true);
select pg_temp.assert_true((select count(*) from public.private_jobs) = 1, 'paid user sees only own job');
select pg_temp.assert_true((select title from public.private_jobs) = 'Frontend Developer', 'user one cannot see user two title');
select pg_temp.assert_true((select count(*) from public.private_job_entitlements) = 1, 'entitlements select only own');
select pg_temp.assert_true((select count(user_id) from public.private_job_scan_state) = 1, 'state select only own paid');
select pg_temp.assert_true(public.private_job_board_access()->>'last_status' = 'completed'
  and public.private_job_board_access()->>'last_query' = 'frontend developer'
  and public.private_job_board_access()->>'next_allowed_at' is not null, 'access contract contains only own state');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","is_anonymous":false}', true);
select pg_temp.assert_true((select title from public.private_jobs) = 'Python Developer', 'user two cannot see user one title');
reset role;

-- Expired claim does NOT refund the 24h budget or permit a delayed finish.
update public.private_job_scan_state set next_allowed_at = clock_timestamp() - interval '1 second'
  where user_id = '10000000-0000-0000-0000-000000000001';
set local role service_role;
select pg_temp.assert_true(public.claim_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'new day')->>'status' = 'claimed', 'elapsed rolling window allows new claim');
reset role;
update public.private_job_scan_state set claim_expires_at = clock_timestamp() - interval '1 second'
  where user_id = '10000000-0000-0000-0000-000000000001';
set local role service_role;
select pg_temp.assert_true(public.finish_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '[]')->>'status' = 'lost', 'expired claim cannot finish');
select pg_temp.assert_true(public.claim_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', 'retry')->>'status' = 'quota', 'expired claim still consumes quota');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","is_anonymous":false}', true);
select pg_temp.assert_true(public.private_job_board_access()->>'last_status' = 'failed', 'expired running state reports failed');
reset role;

-- Revocation hides already saved jobs immediately and blocks in-flight finish.
update public.private_job_scan_state set next_allowed_at = clock_timestamp() - interval '1 second'
  where user_id = '10000000-0000-0000-0000-000000000002';
set local role service_role;
select public.claim_private_job_scan('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000004', 'before revocation');
update public.private_job_entitlements set active = false where user_id = '10000000-0000-0000-0000-000000000002';
select pg_temp.assert_true(public.finish_private_job_scan('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000004',
 '[{"job_id":"theirstack:2","title":"Must not save"}]')->>'status' = 'forbidden', 'revoked finish rejected');
select public.fail_private_job_scan('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000004');
reset role;
select pg_temp.assert_true((select count(*) from public.private_jobs where job_id = 'theirstack:2') = 0, 'revoked finish inserted nothing');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","is_anonymous":false}', true);
select pg_temp.assert_true((select count(*) from public.private_jobs) = 0, 'revoked user cannot read retained jobs');
select pg_temp.assert_true((select count(user_id) from public.private_job_scan_state) = 0, 'revoked user cannot read state');
select pg_temp.assert_true((select count(*) from public.private_job_entitlements) = 1, 'revoked user may read own inactive entitlement');
select pg_temp.assert_true((public.private_job_board_access()->>'allowed')::boolean = false, 'revoked access false');
reset role;
set local role service_role;
update public.private_job_entitlements set active = true where user_id = '10000000-0000-0000-0000-000000000002';
select pg_temp.assert_true(public.claim_private_job_scan('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000005', 'after reactivation')->>'status' = 'quota', 'revocation/failure/reactivation does not refund quota');
-- Expiry after claim also rejects finish, not just inactive revocation.
update public.private_job_entitlements set expires_at = clock_timestamp() + interval '1 day' where user_id = '10000000-0000-0000-0000-000000000005';
select public.claim_private_job_scan('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', 'before expiry');
update public.private_job_entitlements set expires_at = clock_timestamp() - interval '1 second' where user_id = '10000000-0000-0000-0000-000000000005';
select pg_temp.assert_true(public.finish_private_job_scan('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', '[]')->>'status' = 'forbidden', 'expiry between claim and finish is rejected');
reset role;

-- One malformed card rolls back ALL inserts and leaves claim running for failure cleanup.
update public.private_job_scan_state set next_allowed_at = clock_timestamp() - interval '1 second'
  where user_id = '10000000-0000-0000-0000-000000000001';
set local role service_role;
select public.claim_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', 'atomic batch');
do $$
begin
  begin
    perform public.finish_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006',
      '[{"job_id":"atomic-good","title":"Valid"},{"job_id":"atomic-bad"}]');
    raise exception 'malformed batch must fail';
  exception when not_null_violation then null; end;
end;
$$;
reset role;
select pg_temp.assert_true((select count(*) from public.private_jobs where job_id like 'atomic-%') = 0, 'batch insertion rolled back atomically');
select pg_temp.assert_true((select last_status from public.private_job_scan_state where user_id = '10000000-0000-0000-0000-000000000001') = 'running', 'bad batch did not mark completed');
set local role service_role;
select public.fail_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006');
select pg_temp.assert_true(public.claim_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000007', 'failed retry')->>'status' = 'quota', 'failed batch consumes quota');
-- An upsert on the next permitted day updates just this user's existing card.
reset role;
update public.private_job_scan_state set next_allowed_at = clock_timestamp() - interval '1 second'
  where user_id = '10000000-0000-0000-0000-000000000001';
set local role service_role;
select public.claim_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000007', 'update');
select pg_temp.assert_true((public.finish_private_job_scan('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000007',
 '[{"job_id":"theirstack:1","title":"Updated"}]')->>'jobs_saved')::integer = 1, 'upsert counts one saved card');
-- Account deletion must cascade entitlements, cards and durable quota/claim.
select public.claim_private_job_scan('10000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000008', 'delete account');
select public.finish_private_job_scan('10000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000008', '[{"job_id":"delete-me","title":"Delete"}]');
reset role;
select pg_temp.assert_true((select count(*) from public.private_jobs where user_id = '10000000-0000-0000-0000-000000000001') = 1, 'upsert did not duplicate');
select pg_temp.assert_true((select title from public.private_jobs where user_id = '10000000-0000-0000-0000-000000000002') = 'Python Developer', 'upsert did not touch other user');
delete from auth.users where id = '10000000-0000-0000-0000-000000000006';
select pg_temp.assert_true(not exists(select 1 from public.private_jobs where user_id = '10000000-0000-0000-0000-000000000006')
 and not exists(select 1 from public.private_job_entitlements where user_id = '10000000-0000-0000-0000-000000000006')
 and not exists(select 1 from public.private_job_scan_state where user_id = '10000000-0000-0000-0000-000000000006'), 'account deletion cascades all private data');
set local role service_role;
select pg_temp.assert_true(public.finish_private_job_scan('10000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000008', '[]')->>'status' = 'forbidden', 'deleted account token cannot finish');
reset role;

rollback;
