-- Run against a disposable Supabase PostgreSQL database after 005_email_dispatch_guard.sql.
-- All fixtures are rolled back. The singleton FOR UPDATE serializes concurrent acquisitions;
-- the composite primary key is the final same-user/same-key race guard.
begin;

insert into auth.users (id, aud, role, email, encrypted_password)
values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'dispatch-test-one@example.invalid', 'offline'),
  ('00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'dispatch-test-two@example.invalid', 'offline');

set local role service_role;
do $$
declare
  first_user uuid := '00000000-0000-4000-8000-000000000001';
  second_user uuid := '00000000-0000-4000-8000-000000000002';
  first_key uuid := '00000000-0000-4000-8000-000000000011';
  second_key uuid := '00000000-0000-4000-8000-000000000012';
  hash_a text := repeat('a', 64);
  hash_b text := repeat('b', 64);
  outcome jsonb;
begin
  outcome := public.acquire_email_dispatch(first_user, first_key, hash_a);
  if outcome <> '{"status":"acquired"}'::jsonb then raise exception 'Initial reservation failed: %', outcome; end if;
  outcome := public.acquire_email_dispatch(first_user, first_key, hash_a);
  if outcome <> '{"status":"reserved"}'::jsonb then raise exception 'Replay must not dispatch twice: %', outcome; end if;
  outcome := public.acquire_email_dispatch(first_user, first_key, hash_b);
  if outcome <> '{"status":"conflict"}'::jsonb then raise exception 'Payload change must conflict: %', outcome; end if;

  if not public.complete_email_dispatch(first_user, first_key, 'accepted') then raise exception 'Completion must update existing reservation'; end if;
  outcome := public.acquire_email_dispatch(first_user, first_key, hash_a);
  if outcome <> '{"status":"accepted"}'::jsonb then raise exception 'Accepted replay must remain accepted: %', outcome; end if;

  -- The quota is per user: a distinct key is denied in the cooldown window,
  -- while a different user can reserve independently.
  outcome := public.acquire_email_dispatch(first_user, second_key, hash_a);
  if outcome <> '{"status":"quota"}'::jsonb then raise exception 'One-minute cooldown must apply: %', outcome; end if;
  outcome := public.acquire_email_dispatch(second_user, first_key, hash_a);
  if outcome <> '{"status":"acquired"}'::jsonb then raise exception 'Per-user isolation failed: %', outcome; end if;
  if not public.complete_email_dispatch(second_user, first_key, 'rejected') then raise exception 'Definite rejection must be recorded'; end if;
  outcome := public.acquire_email_dispatch(second_user, first_key, hash_a);
  if outcome <> '{"status":"quota"}'::jsonb then raise exception 'Rejected retries must still obey cooldown: %', outcome; end if;
end;
$$;

-- Simulate cooldown expiry as the database owner, never granting service_role table writes.
reset role;
update public.email_dispatch_attempts set created_at = pg_catalog.now() - interval '2 minutes'
 where user_id = '00000000-0000-4000-8000-000000000002'
   and idempotency_key = '00000000-0000-4000-8000-000000000011'
   and attempt_number = 1;
set local role service_role;
do $$
declare
  second_user uuid := '00000000-0000-4000-8000-000000000002';
  first_key uuid := '00000000-0000-4000-8000-000000000011';
  hash_a text := repeat('a', 64);
  outcome jsonb;
begin
  outcome := public.acquire_email_dispatch(second_user, first_key, hash_a);
  if outcome <> '{"status":"acquired"}'::jsonb then raise exception 'Same-key retry after cooldown should be permitted: %', outcome; end if;
end;
$$;

reset role;
do $$
begin
  if (select count(*) from public.email_dispatch_attempts
       where user_id = '00000000-0000-4000-8000-000000000002'
         and idempotency_key = '00000000-0000-4000-8000-000000000011') <> 2 then
    raise exception 'Each actual dispatch retry must consume a durable quota attempt';
  end if;
end;
$$;

set local role service_role;
do $$
begin
  if has_function_privilege('anon', 'public.acquire_email_dispatch(uuid,uuid,text)', 'execute')
    or has_function_privilege('authenticated', 'public.acquire_email_dispatch(uuid,uuid,text)', 'execute')
    or has_function_privilege('anon', 'public.complete_email_dispatch(uuid,uuid,text)', 'execute')
    or has_function_privilege('authenticated', 'public.complete_email_dispatch(uuid,uuid,text)', 'execute')
    or has_table_privilege('anon', 'public.email_dispatch_reservations', 'select')
    or has_table_privilege('authenticated', 'public.email_dispatch_reservations', 'update')
    or has_table_privilege('anon', 'public.email_dispatch_attempts', 'select')
    or has_table_privilege('authenticated', 'public.email_dispatch_attempts', 'insert') then
    raise exception 'Browser roles must not access dispatch guard tables or RPCs';
  end if;
  if exists (
    select 1 from pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid in ('public.acquire_email_dispatch(uuid,uuid,text)'::regprocedure,
                    'public.complete_email_dispatch(uuid,uuid,text)'::regprocedure)
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) or exists (
    select 1 from pg_class c
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    where c.oid in ('public.email_dispatch_guard'::regclass, 'public.email_dispatch_reservations'::regclass,
                    'public.email_dispatch_attempts'::regclass)
      and a.grantee = 0
  ) then
    raise exception 'PUBLIC retains a dispatch guard privilege';
  end if;
  if not has_function_privilege('service_role', 'public.acquire_email_dispatch(uuid,uuid,text)', 'execute')
    or not has_function_privilege('service_role', 'public.complete_email_dispatch(uuid,uuid,text)', 'execute') then
    raise exception 'service_role must execute dispatch RPCs';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.email_dispatch_reservations'::regclass and contype = 'p'
       and pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, idempotency_key)'
  ) then
    raise exception 'Composite unique key required to close concurrent replay races';
  end if;
end;
$$;
rollback;
