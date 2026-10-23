-- A short, global lease bridges concurrent clicks and GitHub's dispatch visibility delay.
-- Only the Edge Function service role can read or acquire it.
create table public.job_refresh_lease (
  id boolean primary key default true check (id),
  token uuid,
  expires_at timestamptz not null default '-infinity'
);
insert into public.job_refresh_lease (id) values (true);
alter table public.job_refresh_lease enable row level security;
revoke all on public.job_refresh_lease from public, anon, authenticated;

create function public.job_refresh_pending()
returns boolean language sql security definer set search_path = '' as $$
  select exists(select 1 from public.job_refresh_lease where expires_at > clock_timestamp());
$$;

create function public.acquire_job_refresh_lease(p_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.job_refresh_lease
    set token = p_token, expires_at = clock_timestamp() + interval '90 seconds'
    where id = true and expires_at <= clock_timestamp();
  return found;
end;
$$;

create function public.release_job_refresh_lease(p_token uuid)
returns void language sql security definer set search_path = '' as $$
  update public.job_refresh_lease set expires_at = '-infinity', token = null
    where id = true and token = p_token;
$$;

revoke all on function public.job_refresh_pending() from public, anon, authenticated;
revoke all on function public.acquire_job_refresh_lease(uuid) from public, anon, authenticated;
revoke all on function public.release_job_refresh_lease(uuid) from public, anon, authenticated;
grant execute on function public.job_refresh_pending() to service_role;
grant execute on function public.acquire_job_refresh_lease(uuid) to service_role;
grant execute on function public.release_job_refresh_lease(uuid) to service_role;
