-- Run only against a disposable PostgreSQL database after 003_job_refresh_lease.sql.
-- The test database needs the anon, authenticated and service_role roles.
begin;

do $$
declare
  first_token uuid := '00000000-0000-0000-0000-000000000001';
  second_token uuid := '00000000-0000-0000-0000-000000000002';
begin
  if public.job_refresh_pending() then raise exception 'Lease must start idle'; end if;
  if not public.acquire_job_refresh_lease(first_token) then raise exception 'First acquisition must succeed'; end if;
  if not public.job_refresh_pending() then raise exception 'Acquired lease must be pending'; end if;
  if public.acquire_job_refresh_lease(second_token) then raise exception 'Second acquisition must fail'; end if;
  perform public.release_job_refresh_lease(second_token);
  if not public.job_refresh_pending() then raise exception 'Wrong owner must not release lease'; end if;
  perform public.release_job_refresh_lease(first_token);
  if public.job_refresh_pending() then raise exception 'Matching owner must release lease'; end if;
  perform public.acquire_job_refresh_lease(first_token);
  update public.job_refresh_lease set expires_at = clock_timestamp() - interval '1 second';
  if not public.acquire_job_refresh_lease(second_token) then raise exception 'Expired lease must be reclaimable'; end if;

  if has_function_privilege('anon', 'public.acquire_job_refresh_lease(uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.acquire_job_refresh_lease(uuid)', 'execute')
    or has_function_privilege('anon', 'public.job_refresh_pending()', 'execute')
    or has_function_privilege('authenticated', 'public.release_job_refresh_lease(uuid)', 'execute')
    or has_table_privilege('anon', 'public.job_refresh_lease', 'select')
    or has_table_privilege('authenticated', 'public.job_refresh_lease', 'update') then
    raise exception 'Browser roles must not access the lease';
  end if;
  if not has_function_privilege('service_role', 'public.acquire_job_refresh_lease(uuid)', 'execute') then
    raise exception 'Service role must acquire the lease';
  end if;
end;
$$;

-- The service role uses SECURITY DEFINER RPCs, not direct table access.
set local role service_role;
select public.job_refresh_pending();
rollback;
