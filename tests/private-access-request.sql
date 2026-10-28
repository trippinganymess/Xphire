-- Disposable PostgreSQL only, after bootstrap and migrations 004/005.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Assertion failed: %', message; end if;
end;
$$;
insert into auth.users(id, is_anonymous) values
  ('50000000-0000-0000-0000-000000000001', false),
  ('50000000-0000-0000-0000-000000000002', false),
  ('50000000-0000-0000-0000-000000000003', true),
  ('50000000-0000-0000-0000-000000000004', false);
insert into public.private_job_entitlements(user_id, active, expires_at)
  values ('50000000-0000-0000-0000-000000000004', true, clock_timestamp() + interval '1 day');

do $$
declare r text; signature text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    perform pg_temp.assert_true(not has_table_privilege(r, 'public.private_job_access_requests',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), r || ' cannot write requests');
    foreach signature in array array['claim_private_job_access_request(uuid,text,text,text)',
      'claim_private_job_access_notification(uuid)', 'set_private_job_access_notification(uuid,text)'] loop
      perform pg_temp.assert_true(not has_function_privilege(r, 'public.' || signature, 'EXECUTE'), r || ' cannot call service RPC');
      perform pg_temp.assert_true(has_function_privilege('service_role', 'public.' || signature, 'EXECUTE'), 'service may call RPC');
    end loop;
  end loop;
  perform pg_temp.assert_true(not has_table_privilege('anon', 'public.private_job_access_requests', 'SELECT'),
    'guests cannot read requests');
end;
$$;

set local role service_role;
select pg_temp.assert_true(public.claim_private_job_access_request(
  '50000000-0000-0000-0000-000000000001', 'first@example.test', 'First', 'Original message')->>'status' = 'claimed',
  'unpaid user can request access');
select request_id as first_request from public.private_job_access_requests
  where user_id = '50000000-0000-0000-0000-000000000001' \gset
select pg_temp.assert_true(public.claim_private_job_access_request(
  '50000000-0000-0000-0000-000000000001', 'changed@example.test', 'Changed', 'Changed message')->>'status' = 'cooldown',
  'repeat request cannot dispatch another email');
select pg_temp.assert_true((select email = 'first@example.test' and message = 'Original message'
  from public.private_job_access_requests where request_id = :'first_request'), 'cooldown preserves original data');
select pg_temp.assert_true(public.claim_private_job_access_request(
  '50000000-0000-0000-0000-000000000002', 'second@example.test', 'Second', '')->>'status' = 'claimed',
  'different user has an independent allowance');
select request_id as second_request from public.private_job_access_requests
  where user_id = '50000000-0000-0000-0000-000000000002' \gset
select pg_temp.assert_true(public.claim_private_job_access_request(
  '50000000-0000-0000-0000-000000000003', 'anonymous@example.test', 'Anonymous', '')->>'status' = 'forbidden',
  'anonymous accounts cannot request');
select pg_temp.assert_true(public.claim_private_job_access_request(
  '50000000-0000-0000-0000-000000000004', 'paid@example.test', 'Paid', '')->>'status' = 'already_allowed',
  'paid users do not trigger an unnecessary notification');
reset role;
select pg_temp.assert_true((select count(*) from public.private_job_entitlements) = 1, 'requests do not grant entitlement');
select pg_temp.assert_true((select count(*) from public.private_job_scan_state) = 0, 'requests do not consume discovery quota');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000001","is_anonymous":false}', true);
select pg_temp.assert_true((select count(*) from public.private_job_access_requests) = 1, 'requester sees only own record');
select pg_temp.assert_true((select email from public.private_job_access_requests) = 'first@example.test', 'other applicant email stays private');
select pg_temp.assert_true((public.private_job_board_access()->>'allowed')::boolean = false, 'request leaves private jobs locked');
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000001","is_anonymous":true}', true);
select pg_temp.assert_true((select count(*) from public.private_job_access_requests) = 0, 'anonymous JWT cannot enumerate requests');
select set_config('request.jwt.claims', '{}', true);
select pg_temp.assert_true((select count(*) from public.private_job_access_requests) = 0, 'missing identity cannot enumerate requests');
reset role;

set local role service_role;
select pg_temp.assert_true(public.set_private_job_access_notification(:'first_request', 'queued'), 'queue acknowledges a pending record');
select pg_temp.assert_true(public.claim_private_job_access_notification(:'first_request')->>'status' = 'claimed', 'mailer claims before sending');
select pg_temp.assert_true(public.claim_private_job_access_notification(:'first_request')->>'status' = 'skipped', 'concurrent mailer cannot resend');
select pg_temp.assert_true(not public.set_private_job_access_notification(:'first_request', 'queued'), 'late queue ack cannot overwrite sending');
select pg_temp.assert_true(public.set_private_job_access_notification(:'first_request', 'sent'), 'confirmed send is recorded');
select pg_temp.assert_true((select notified_at is not null from public.private_job_access_requests
  where request_id = :'first_request'), 'sent timestamp is recorded');
select pg_temp.assert_true(public.claim_private_job_access_notification(:'first_request')->>'status' = 'skipped', 'workflow rerun skips sent email');
select pg_temp.assert_true(not public.set_private_job_access_notification(:'first_request', 'failed'), 'failure cannot overwrite confirmed delivery');
select pg_temp.assert_true(public.claim_private_job_access_notification(:'second_request')->>'status' = 'claimed', 'pending record can send without queue ack');
select pg_temp.assert_true(public.set_private_job_access_notification(:'second_request', 'failed'), 'failed SMTP is recorded');
select pg_temp.assert_true(public.claim_private_job_access_notification(:'second_request')->>'status' = 'skipped', 'uncertain SMTP is not retried');
reset role;

-- A later permitted request gets a new identity; old workers cannot modify it.
update public.private_job_access_requests set requested_at = clock_timestamp() - interval '25 hours'
  where user_id = '50000000-0000-0000-0000-000000000001';
set local role service_role;
select pg_temp.assert_true(public.claim_private_job_access_request(
  '50000000-0000-0000-0000-000000000001', 'first@example.test', 'First', 'New day')->>'status' = 'claimed',
  'rolling cooldown expires');
select pg_temp.assert_true((select request_id <> :'first_request'::uuid and notification_status = 'pending'
  and notified_at is null from public.private_job_access_requests
  where user_id = '50000000-0000-0000-0000-000000000001'), 'new day resets only notification state');
select pg_temp.assert_true(public.claim_private_job_access_notification(:'first_request')->>'status' = 'skipped', 'old request cannot send');
select pg_temp.assert_true(not public.set_private_job_access_notification(:'first_request', 'sent'), 'old request cannot finish newer request');
reset role;
delete from auth.users where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.assert_true(not exists(select 1 from public.private_job_access_requests
  where user_id = '50000000-0000-0000-0000-000000000001'), 'account deletion cascades applicant data');
rollback;
