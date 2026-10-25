-- Disposable PostgreSQL only, after migrations 003 and 004.
begin;
do $$
declare
  owner_token uuid := '00000000-0000-4000-8000-000000000001';
  other_token uuid := '00000000-0000-4000-8000-000000000002';
  snapshot jsonb;
  run_list jsonb := '[{"id":40,"status":"completed","conclusion":"success"}]';
begin
  for i in 1..120 loop
    if not public.reserve_job_refresh_budget('request') then raise exception 'Request budget denied too early'; end if;
  end loop;
  if public.reserve_job_refresh_budget('request') then raise exception 'Request budget must be finite'; end if;
  for i in 1..12 loop
    if not public.reserve_job_refresh_budget('github') then raise exception 'GitHub budget denied too early'; end if;
  end loop;
  if public.reserve_job_refresh_budget('github') then raise exception 'GitHub budget must be finite'; end if;
  update public.job_refresh_budget set window_started_at = clock_timestamp() - interval '61 seconds';
  if not public.reserve_job_refresh_budget('request') or not public.reserve_job_refresh_budget('github') then
    raise exception 'Expired budgets must recover';
  end if;
  begin
    perform public.reserve_job_refresh_budget('attacker-chosen-budget');
    raise exception 'Unknown budgets must fail';
  exception when invalid_parameter_value then null;
  end;

  snapshot := public.claim_job_refresh_status(owner_token);
  if snapshot->>'kind' <> 'fetch' then raise exception 'Initial status must have one fetch owner'; end if;
  snapshot := public.claim_job_refresh_status(other_token);
  if snapshot->>'kind' <> 'busy' then raise exception 'Second instance must not spend GitHub quota'; end if;
  begin
    perform public.finish_job_refresh_status(other_token, run_list);
    raise exception 'Wrong fetch owner must not write status';
  exception when object_not_in_prerequisite_state then null;
  end;
  if public.finish_job_refresh_status(owner_token, run_list) then raise exception 'Lease must start idle'; end if;
  snapshot := public.claim_job_refresh_status(other_token);
  if snapshot->>'kind' <> 'cached' or snapshot->'workflow_runs' <> run_list then
    raise exception 'Fresh public snapshot must be reused';
  end if;
  perform public.acquire_job_refresh_lease(owner_token);
  snapshot := public.claim_job_refresh_status(other_token);
  if not (snapshot->>'pending')::boolean then raise exception 'Cache must not hide a newly acquired dispatch lease'; end if;
  perform public.release_job_refresh_lease(owner_token);

  update public.job_refresh_status_cache set updated_at = clock_timestamp() - interval '11 seconds';
  snapshot := public.claim_job_refresh_status(owner_token);
  if snapshot->>'kind' <> 'fetch' then raise exception 'Expired freshness must start revalidation'; end if;
  snapshot := public.claim_job_refresh_status(other_token);
  if snapshot->>'kind' <> 'cached' then raise exception 'Bounded stale status can be served while another instance fetches'; end if;
  update public.job_refresh_status_cache set updated_at = clock_timestamp() - interval '61 seconds';
  snapshot := public.claim_job_refresh_status(other_token);
  if snapshot->>'kind' <> 'busy' then raise exception 'Old snapshots must not be served indefinitely'; end if;
  update public.job_refresh_status_cache set fetch_expires_at = clock_timestamp() - interval '1 second';
  snapshot := public.claim_job_refresh_status(other_token);
  if snapshot->>'kind' <> 'fetch' then raise exception 'Abandoned fetch lease must expire'; end if;
  begin
    perform public.finish_job_refresh_status(owner_token, run_list);
    raise exception 'Expired previous owner must not overwrite new status';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform public.finish_job_refresh_status(other_token, run_list);

  if has_function_privilege('anon', 'public.reserve_job_refresh_budget(text)', 'execute')
    or has_function_privilege('authenticated', 'public.claim_job_refresh_status(uuid)', 'execute')
    or has_function_privilege('anon', 'public.finish_job_refresh_status(uuid,jsonb)', 'execute')
    or has_table_privilege('anon', 'public.job_refresh_status_cache', 'select')
    or has_table_privilege('authenticated', 'public.job_refresh_budget', 'update') then
    raise exception 'Browser roles must not access refresh guard internals';
  end if;
  if not has_function_privilege('service_role', 'public.reserve_job_refresh_budget(text)', 'execute')
    or not has_function_privilege('service_role', 'public.claim_job_refresh_status(uuid)', 'execute')
    or not has_function_privilege('service_role', 'public.finish_job_refresh_status(uuid,jsonb)', 'execute') then
    raise exception 'Service role must use guarded RPCs';
  end if;
end;
$$;
set local role service_role;
select public.reserve_job_refresh_budget('request');
select public.claim_job_refresh_status('00000000-0000-4000-8000-000000000003');
rollback;
