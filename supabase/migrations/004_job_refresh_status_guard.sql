-- Shared bounds for public status and privileged GitHub reads across Edge instances.
-- This is not a network-edge DDoS shield; rejected traffic still reaches Supabase.
create table public.job_refresh_budget (
  kind text primary key check (kind in ('request', 'github')),
  window_started_at timestamptz not null default '-infinity',
  used integer not null default 0 check (used >= 0)
);
insert into public.job_refresh_budget (kind) values ('request'), ('github');
alter table public.job_refresh_budget enable row level security;
revoke all on public.job_refresh_budget from public, anon, authenticated;

create function public.reserve_job_refresh_budget(p_kind text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  budget public.job_refresh_budget%rowtype;
  instant timestamptz;
  maximum integer;
begin
  if p_kind not in ('request', 'github') or p_kind is null then
    raise exception 'Invalid refresh budget' using errcode = '22023';
  end if;
  select * into strict budget from public.job_refresh_budget where kind = p_kind for update;
  instant := clock_timestamp();
  maximum := case p_kind when 'request' then 120 else 12 end;
  if budget.window_started_at + interval '60 seconds' <= instant then
    update public.job_refresh_budget set window_started_at = instant, used = 1 where kind = p_kind;
    return true;
  end if;
  if budget.used >= maximum then return false; end if;
  update public.job_refresh_budget set used = used + 1 where kind = p_kind;
  return true;
end;
$$;

create table public.job_refresh_status_cache (
  id boolean primary key default true check (id),
  workflow_runs jsonb check (workflow_runs is null or jsonb_typeof(workflow_runs) = 'array'),
  updated_at timestamptz not null default '-infinity',
  fetch_token uuid,
  fetch_expires_at timestamptz not null default '-infinity'
);
insert into public.job_refresh_status_cache (id) values (true);
alter table public.job_refresh_status_cache enable row level security;
revoke all on public.job_refresh_status_cache from public, anon, authenticated;

create function public.claim_job_refresh_status(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  snapshot public.job_refresh_status_cache%rowtype;
  instant timestamptz;
  pending boolean;
begin
  if p_token is null then raise exception 'Missing status token' using errcode = '22023'; end if;
  select * into strict snapshot from public.job_refresh_status_cache where id = true for update;
  instant := clock_timestamp();
  pending := public.job_refresh_pending();
  if snapshot.workflow_runs is not null and (
    snapshot.updated_at + interval '10 seconds' > instant or (
      snapshot.fetch_expires_at > instant and snapshot.updated_at + interval '60 seconds' > instant
    )
  ) then
    return jsonb_build_object('kind', 'cached', 'workflow_runs', snapshot.workflow_runs, 'pending', pending);
  end if;
  if snapshot.fetch_expires_at > instant then
    return jsonb_build_object('kind', 'busy', 'pending', pending);
  end if;
  update public.job_refresh_status_cache
    set fetch_token = p_token, fetch_expires_at = instant + interval '15 seconds' where id = true;
  return jsonb_build_object('kind', 'fetch', 'pending', pending);
end;
$$;

create function public.finish_job_refresh_status(p_token uuid, p_runs jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_runs is null or jsonb_typeof(p_runs) <> 'array' or jsonb_array_length(p_runs) > 100 then
    raise exception 'Invalid workflow status' using errcode = '22023';
  end if;
  update public.job_refresh_status_cache
    set workflow_runs = p_runs, updated_at = clock_timestamp(), fetch_token = null, fetch_expires_at = '-infinity'
    where id = true and fetch_token = p_token and fetch_expires_at > clock_timestamp();
  if not found then raise exception 'Status lease expired' using errcode = '55000'; end if;
  return public.job_refresh_pending();
end;
$$;

revoke all on function public.reserve_job_refresh_budget(text) from public, anon, authenticated;
revoke all on function public.claim_job_refresh_status(uuid) from public, anon, authenticated;
revoke all on function public.finish_job_refresh_status(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_job_refresh_budget(text) to service_role;
grant execute on function public.claim_job_refresh_status(uuid) to service_role;
grant execute on function public.finish_job_refresh_status(uuid, jsonb) to service_role;
