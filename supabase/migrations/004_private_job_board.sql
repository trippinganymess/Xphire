-- On-request paid discovery, isolated from the public jobs/scraper/email pipeline.
-- Entitlements are provisioned/revoked by an administrator using service_role.
create table public.private_job_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default false,
  expires_at timestamptz not null check (isfinite(expires_at))
);

create table public.private_jobs (
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id text not null check (length(job_id) between 1 and 256),
  company text,
  title text not null check (length(title) between 1 and 300),
  location text,
  experience text,
  salary text,
  source text not null default 'TheirStack' check (source = 'TheirStack'),
  rating numeric default null check (rating is null),
  scraped_at timestamptz not null default clock_timestamp(),
  posted_date date,
  url text,
  primary key (user_id, job_id)
);

create index private_jobs_owner_newest_idx on public.private_jobs (user_id, scraped_at desc, job_id desc);

create table public.private_job_scan_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  claim_token uuid,
  claim_expires_at timestamptz,
  last_attempt_at timestamptz,
  next_allowed_at timestamptz,
  last_status text check (last_status in ('running', 'completed', 'failed')),
  last_query text
);

alter table public.private_job_entitlements enable row level security;
alter table public.private_jobs enable row level security;
alter table public.private_job_scan_state enable row level security;
revoke all on public.private_job_entitlements, public.private_jobs, public.private_job_scan_state
  from public, anon, authenticated, service_role;
grant select on public.private_job_entitlements to authenticated;
grant select, insert, update, delete on public.private_job_entitlements to service_role;
grant select on public.private_jobs to authenticated, service_role;
-- Even paid clients must not see or supply claim tokens.
grant select (user_id, last_attempt_at, next_allowed_at, last_status, last_query)
  on public.private_job_scan_state to authenticated;

create policy private_entitlement_own_read on public.private_job_entitlements
  for select to authenticated using (
    user_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'), 'false') <> 'true'
  );
create policy private_jobs_paid_read on public.private_jobs
  for select to authenticated using (
    user_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'), 'false') <> 'true'
    and exists (select 1 from public.private_job_entitlements e
      where e.user_id = (select auth.uid()) and e.active and e.expires_at > clock_timestamp())
  );
create policy private_scan_paid_read on public.private_job_scan_state
  for select to authenticated using (
    user_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'), 'false') <> 'true'
    and exists (select 1 from public.private_job_entitlements e
      where e.user_id = (select auth.uid()) and e.active and e.expires_at > clock_timestamp())
  );

-- allowed means currently entitled; next_allowed_at independently describes quota.
-- No caller-supplied identity and no information about unpaid/other accounts.
create function public.private_job_board_access()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_state public.private_job_scan_state%rowtype;
begin
  if v_user is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true'
    or not exists (select 1 from public.private_job_entitlements e join auth.users u on u.id = e.user_id
      where e.user_id = v_user and e.active and e.expires_at > clock_timestamp()
        and not coalesce(u.is_anonymous, false)) then
    return jsonb_build_object('allowed', false, 'next_allowed_at', null, 'last_status', null, 'last_query', null);
  end if;
  select * into v_state from public.private_job_scan_state where user_id = v_user;
  return jsonb_build_object('allowed', true, 'next_allowed_at', v_state.next_allowed_at,
    'last_status', case when v_state.last_status = 'running' and v_state.claim_expires_at <= clock_timestamp()
      then 'failed' else v_state.last_status end, 'last_query', v_state.last_query);
end;
$$;

-- Lock entitlement BEFORE state in every mutating RPC. Revocation/expiry changes
-- serialize with claim and finish; a claim consumes quota before any provider call.
create function public.claim_private_job_scan(p_user_id uuid, p_token uuid, p_query text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ent public.private_job_entitlements%rowtype;
  v_state public.private_job_scan_state%rowtype;
  v_now timestamptz;
begin
  if p_token is null or p_query is null or length(btrim(p_query)) not between 1 and 120
    or p_query <> btrim(p_query) or p_query ~ '[[:cntrl:]]' then
    raise exception 'Invalid private scan claim';
  end if;
  select e.* into v_ent from public.private_job_entitlements e join auth.users u on u.id = e.user_id
    where e.user_id = p_user_id and not coalesce(u.is_anonymous, false) for update of e;
  v_now := clock_timestamp();
  if not found or not v_ent.active or v_ent.expires_at <= v_now then
    return jsonb_build_object('status', 'forbidden');
  end if;
  insert into public.private_job_scan_state(user_id) values (p_user_id) on conflict do nothing;
  select * into v_state from public.private_job_scan_state where user_id = p_user_id for update;
  v_now := clock_timestamp();
  if v_state.next_allowed_at > v_now then
    return jsonb_build_object('status', case when v_state.last_status = 'running'
      and v_state.claim_expires_at > v_now then 'running' else 'quota' end,
      'next_allowed_at', v_state.next_allowed_at);
  end if;
  update public.private_job_scan_state set claim_token = p_token,
    claim_expires_at = v_now + interval '90 seconds', last_attempt_at = v_now,
    next_allowed_at = v_now + interval '24 hours', last_status = 'running', last_query = p_query
    where user_id = p_user_id;
  return jsonb_build_object('status', 'claimed', 'next_allowed_at', v_now + interval '24 hours');
end;
$$;

-- All cards and completion state commit together. Identity, source, rating and
-- discovery timestamp are set here, never trusted from the browser/provider.
create function public.finish_private_job_scan(p_user_id uuid, p_token uuid, p_jobs jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ent public.private_job_entitlements%rowtype;
  v_state public.private_job_scan_state%rowtype;
  v_saved integer;
  v_now timestamptz;
begin
  select e.* into v_ent from public.private_job_entitlements e join auth.users u on u.id = e.user_id
    where e.user_id = p_user_id and not coalesce(u.is_anonymous, false) for update of e;
  v_now := clock_timestamp();
  if not found or not v_ent.active or v_ent.expires_at <= v_now then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select * into v_state from public.private_job_scan_state where user_id = p_user_id for update;
  if not found or p_token is null or v_state.claim_token is distinct from p_token
    or v_state.last_status <> 'running' or v_state.claim_expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'lost');
  end if;
  if p_jobs is null or jsonb_typeof(p_jobs) <> 'array' or jsonb_array_length(p_jobs) > 10 then
    raise exception 'Invalid private job cards';
  end if;
  insert into public.private_jobs(user_id, job_id, company, title, location, experience, salary,
    source, rating, scraped_at, posted_date, url)
    select p_user_id, j.job_id, j.company, j.title, j.location, j.experience, j.salary,
      'TheirStack', null, clock_timestamp(), j.posted_date, j.url
    from jsonb_to_recordset(p_jobs) as j(job_id text, company text, title text, location text,
      experience text, salary text, posted_date date, url text)
    on conflict (user_id, job_id) do update set company = excluded.company, title = excluded.title,
      location = excluded.location, experience = excluded.experience, salary = excluded.salary,
      source = excluded.source, rating = null, scraped_at = excluded.scraped_at,
      posted_date = excluded.posted_date, url = excluded.url;
  get diagnostics v_saved = row_count;
  update public.private_job_scan_state set last_status = 'completed', claim_token = null,
    claim_expires_at = null where user_id = p_user_id;
  return jsonb_build_object('status', 'completed', 'jobs_saved', v_saved, 'next_allowed_at', v_state.next_allowed_at);
end;
$$;

-- Failure never refunds quota. Safe even after expiry/revocation and cannot
-- overwrite a different/new claim or replay a successfully finished token.
create function public.fail_private_job_scan(p_user_id uuid, p_token uuid)
returns void language sql security definer set search_path = '' as $$
  update public.private_job_scan_state set last_status = 'failed', claim_token = null, claim_expires_at = null
    where user_id = p_user_id and claim_token = p_token and last_status = 'running';
$$;

revoke all on function public.private_job_board_access() from public, anon, authenticated;
grant execute on function public.private_job_board_access() to authenticated;
revoke all on function public.claim_private_job_scan(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_private_job_scan(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_private_job_scan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_private_job_scan(uuid, uuid, text) to service_role;
grant execute on function public.finish_private_job_scan(uuid, uuid, jsonb) to service_role;
grant execute on function public.fail_private_job_scan(uuid, uuid) to service_role;
