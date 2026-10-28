-- Access requests never grant paid entitlement. Notifications use existing SMTP
-- through a dedicated workflow; one durable request per user per rolling day.
create table public.private_job_access_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_id uuid not null unique default gen_random_uuid(),
  email text not null check (length(email) between 3 and 254 and email !~ '[[:cntrl:]]'),
  name text not null check (length(name) between 1 and 80 and name !~ '[[:cntrl:]]'),
  message text not null default '' check (length(message) <= 1000),
  requested_at timestamptz not null default clock_timestamp() check (isfinite(requested_at)),
  notification_status text not null default 'pending' check (notification_status in ('pending', 'queued', 'sending', 'sent', 'failed')),
  notified_at timestamptz check (isfinite(notified_at))
);

alter table public.private_job_access_requests enable row level security;
revoke all on public.private_job_access_requests from public, anon, authenticated, service_role;
grant select on public.private_job_access_requests to authenticated, service_role;
create policy private_job_access_request_own_read on public.private_job_access_requests
  for select to authenticated using (
    user_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'), 'false') <> 'true'
  );

create function public.claim_private_job_access_request(p_user_id uuid, p_email text, p_name text, p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_request public.private_job_access_requests%rowtype;
begin
  if not exists (select 1 from auth.users u where u.id = p_user_id and not coalesce(u.is_anonymous, false)) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if exists (select 1 from public.private_job_entitlements e
    where e.user_id = p_user_id and e.active and e.expires_at > v_now) then
    return jsonb_build_object('status', 'already_allowed');
  end if;
  if p_email is null or length(p_email) not between 3 and 254 or p_email ~ '[[:cntrl:]]'
    or p_name is null or length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]'
    or p_message is null or length(p_message) > 1000 then
    raise exception 'Invalid access request';
  end if;
  -- The unique owner conflict serializes simultaneous clicks without an app lock.
  insert into public.private_job_access_requests(user_id, email, name, message, requested_at)
    values (p_user_id, p_email, p_name, p_message, v_now)
    on conflict (user_id) do update set request_id = excluded.request_id,
      email = excluded.email, name = excluded.name, message = excluded.message,
      requested_at = excluded.requested_at, notification_status = 'pending', notified_at = null
    where private_job_access_requests.requested_at <= v_now - interval '24 hours'
    returning * into v_request;
  if found then
    return jsonb_build_object('status', 'claimed', 'request_id', v_request.request_id,
      'next_allowed_at', v_request.requested_at + interval '24 hours');
  end if;
  select * into v_request from public.private_job_access_requests where user_id = p_user_id;
  return jsonb_build_object('status', 'cooldown', 'next_allowed_at', v_request.requested_at + interval '24 hours');
end;
$$;

create function public.claim_private_job_access_notification(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_request public.private_job_access_requests%rowtype;
begin
  -- Claim before SMTP. A workflow rerun cannot resend a message whose delivery
  -- or final database acknowledgement is uncertain.
  update public.private_job_access_requests set notification_status = 'sending'
    where request_id = p_request_id and notification_status in ('pending', 'queued')
    returning * into v_request;
  if not found then return jsonb_build_object('status', 'skipped'); end if;
  return jsonb_build_object('status', 'claimed', 'request_id', v_request.request_id,
    'user_id', v_request.user_id, 'email', v_request.email, 'name', v_request.name, 'message', v_request.message);
end;
$$;

create function public.set_private_job_access_notification(p_request_id uuid, p_status text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status is null or p_status not in ('queued', 'sent', 'failed') then
    raise exception 'Invalid notification status';
  end if;
  -- Late queue acknowledgements cannot overwrite a completed delivery. An old
  -- request ID cannot change a newer day's request or another user's record.
  update public.private_job_access_requests set notification_status = p_status,
    notified_at = case when p_status = 'sent' then clock_timestamp() else null end
    where request_id = p_request_id and (
      (p_status = 'queued' and notification_status = 'pending')
      or (p_status in ('sent', 'failed') and notification_status = 'sending')
    );
  return found;
end;
$$;

revoke all on function public.claim_private_job_access_request(uuid, text, text, text),
  public.claim_private_job_access_notification(uuid),
  public.set_private_job_access_notification(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_private_job_access_request(uuid, text, text, text),
  public.claim_private_job_access_notification(uuid),
  public.set_private_job_access_notification(uuid, text) to service_role;
