-- =============================================================================
-- KiloWhat: push notifications for anomaly alerts + box offline   (v3)
-- PROPOSAL - review first, then run ONCE in the Supabase SQL Editor (after
-- kilowhat_anomaly_alerts.sql). Safe to run again.
--
-- Flow
--   box -> kw_ingest -> kw_alerts row
--     spike, fresh  : status 'pending'  -> webhook -> push "what happened?" (answer window 60 s)
--     spike, late   : box was offline when it happened (event older than 2 min) ->
--                     no question, saved straight as 'anomaly' (auto_flagged) -> push "flagged"
--     other types   : overload / voltage -> push as a plain warning
--   tenant answers in the app -> kw_resolve_alert():
--     'anomaly'    -> status 'anomaly' + a row in kw_anomalies
--     'new_device' -> status 'tagging': the user gets 1 more minute for EACH tap
--                     (tagging_until = now() + 60 s). Tagging itself is not built yet.
--   no answer for 60 s      -> kw_expire_alerts() (every 15 s) flags it as an anomaly
--                              (auto_flagged) -> webhook (UPDATE) -> push "flagged automatically"
--   tagging not finished    -> status 'untagged' (NOT an anomaly: the user said it is a
--                              new device) -> push "Finish tagging your new device"
--   box silent > offline_after_min (admin setting) -> kw_box_events 'offline' -> push;
--     box reporting again -> 'online' -> push
-- =============================================================================

-- 1) Phone tokens (written only through the two RPCs below) ---------------------
create table if not exists public.kw_device_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  platform   text not null default 'android',
  updated_at timestamptz not null default now()
);
create index if not exists kw_device_tokens_user on public.kw_device_tokens (user_id);
alter table public.kw_device_tokens enable row level security;
revoke all on public.kw_device_tokens from anon, authenticated;

create or replace function public.kw_register_device_token(p_token text, p_platform text default 'android')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_token is null or length(p_token) < 20 then raise exception 'Bad token'; end if;
  -- a phone that logs into another account moves to that account
  insert into public.kw_device_tokens (token, user_id, platform)
  values (p_token, auth.uid(), left(coalesce(p_platform, 'android'), 20))
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;

create or replace function public.kw_unregister_device_token(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from public.kw_device_tokens where token = p_token and user_id = auth.uid();
$$;

revoke all on function public.kw_register_device_token(text, text) from public, anon;
revoke all on function public.kw_unregister_device_token(text)     from public, anon;
grant execute on function public.kw_register_device_token(text, text) to authenticated;
grant execute on function public.kw_unregister_device_token(text)     to authenticated;

-- 2) Alert status: a spike is a question until the tenant answers ---------------
alter table public.kw_alerts add column if not exists status       text not null default 'pending';
alter table public.kw_alerts add column if not exists auto_flagged boolean not null default false;
alter table public.kw_alerts add column if not exists resolved_by  uuid;
alter table public.kw_alerts add column if not exists resolved_at  timestamptz;
alter table public.kw_alerts add column if not exists notified_at  timestamptz;
alter table public.kw_alerts add column if not exists tagging_until timestamptz;   -- end of the current tagging minute
alter table public.kw_alerts drop constraint if exists kw_alerts_status_check;
alter table public.kw_alerts add constraint kw_alerts_status_check
  check (status in ('pending', 'anomaly', 'tagging', 'untagged', 'tagged'));  -- 'tagged' is for when tagging is built

-- 3) The anomaly table: ONLY alerts that were flagged (by the tenant or by timeout)
create table if not exists public.kw_anomalies (
  id           bigint generated always as identity primary key,
  alert_id     bigint not null unique references public.kw_alerts(id) on delete cascade,
  unit_code    text not null,
  box_number   smallint not null,
  outlet       smallint not null,
  alert_type   text not null,
  power_w      real,
  prev_power_w real,
  event_at     timestamptz not null,
  flagged_by   uuid references auth.users(id) on delete set null,   -- null when auto-flagged
  auto_flagged boolean not null default false,
  flagged_at   timestamptz not null default now(),
  review       text not null default 'open' check (review in ('open', 'reviewed', 'dismissed'))
);
alter table public.kw_anomalies add column if not exists auto_flagged boolean not null default false;
create index if not exists kw_anomalies_newest on public.kw_anomalies (flagged_at desc);
alter table public.kw_anomalies enable row level security;
revoke all on public.kw_anomalies from anon, authenticated;
grant select on public.kw_anomalies to authenticated;

-- Outlet-level data: the unit's tenant/individual user and admins only. A landlord
-- account never reads it, even if it is a row in kw_unit_members.
drop policy if exists "members and admin read anomalies" on public.kw_anomalies;
create policy "members and admin read anomalies" on public.kw_anomalies
  for select to authenticated using (
    public.is_admin()
    or (
      public.kw_user_in_unit(unit_code)
      and not exists (select 1 from public.user_roles r
                      where r.user_id = auth.uid() and r.role::text = 'landlord')
    )
  );

-- 4) The tenant's answer ----------------------------------------------------------
create or replace function public.kw_resolve_alert(p_alert_id bigint, p_choice text)
returns text language plpgsql security definer set search_path = public as $$
declare a public.kw_alerts%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_choice not in ('anomaly', 'new_device') then raise exception 'Bad choice'; end if;

  select * into a from public.kw_alerts where id = p_alert_id for update;
  if not found or not public.kw_user_in_unit(a.unit_code) then
    raise exception 'Alert not found';
  end if;

  -- final states: change nothing, tell the app what it is
  if a.status in ('anomaly', 'tagged') then return a.status; end if;

  if p_choice = 'new_device' then
    -- every tap (also later taps inside the tagging screen) gives another 60 s
    update public.kw_alerts
       set status = 'tagging', tagging_until = now() + interval '60 seconds',
           resolved_by = auth.uid()
     where id = a.id;
    return 'tagging';
  end if;

  -- 'anomaly' (allowed from pending / tagging / untagged)
  update public.kw_alerts
     set status = 'anomaly', tagging_until = null, resolved_by = auth.uid(), resolved_at = now()
   where id = a.id;
  insert into public.kw_anomalies
    (alert_id, unit_code, box_number, outlet, alert_type, power_w, prev_power_w, event_at, flagged_by)
  values
    (a.id, a.unit_code, a.box_number, a.outlet, a.alert_type, a.power_w, a.prev_power_w, a.event_at, auth.uid())
  on conflict (alert_id) do nothing;
  return 'anomaly';
end $$;

revoke all on function public.kw_resolve_alert(bigint, text) from public, anon;
grant execute on function public.kw_resolve_alert(bigint, text) to authenticated;

-- 5) Timers (run every 15 s, see step 8) -----------------------------------------
--    a) no answer within 60 s            -> flagged as anomaly (auto)
--    b) tagging minute ran out unfinished -> 'untagged' (a reminder push, not an anomaly)
create or replace function public.kw_expire_alerts()
returns integer language plpgsql security definer set search_path = public as $$
declare n1 integer; n2 integer;
begin
  with due as (
    update public.kw_alerts
       set status = 'anomaly', auto_flagged = true, resolved_at = now()
     where status = 'pending'
       and alert_type = 'power_spike'          -- only spikes ask a question
       and created_at < now() - interval '60 seconds'
    returning *
  )
  insert into public.kw_anomalies
    (alert_id, unit_code, box_number, outlet, alert_type, power_w, prev_power_w, event_at, auto_flagged)
  select id, unit_code, box_number, outlet, alert_type, power_w, prev_power_w, event_at, true
    from due
  on conflict (alert_id) do nothing;
  get diagnostics n1 = row_count;

  update public.kw_alerts
     set status = 'untagged', tagging_until = null
   where status = 'tagging' and tagging_until < now();
  get diagnostics n2 = row_count;

  return n1 + n2;
end $$;
revoke all on function public.kw_expire_alerts() from public, anon, authenticated;

-- 6) Late spikes: the box was offline, the event is old, asking "what just
--    happened?" makes no sense -> save it already flagged (no question) -----------
create or replace function public.kw_alert_late_guard()
returns trigger language plpgsql as $$
begin
  if new.alert_type = 'power_spike' and new.status = 'pending'
     and new.created_at - new.event_at > interval '120 seconds' then
    new.status := 'anomaly';
    new.auto_flagged := true;
    new.resolved_at := now();
  end if;
  return new;
end $$;

create or replace function public.kw_alert_late_to_anomaly()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.kw_anomalies
    (alert_id, unit_code, box_number, outlet, alert_type, power_w, prev_power_w, event_at, auto_flagged)
  values
    (new.id, new.unit_code, new.box_number, new.outlet, new.alert_type, new.power_w, new.prev_power_w, new.event_at, true)
  on conflict (alert_id) do nothing;
  return new;
end $$;

drop trigger if exists kw_alerts_late_guard on public.kw_alerts;
create trigger kw_alerts_late_guard before insert on public.kw_alerts
  for each row execute function public.kw_alert_late_guard();

drop trigger if exists kw_alerts_late_to_anomaly on public.kw_alerts;
create trigger kw_alerts_late_to_anomaly after insert on public.kw_alerts
  for each row when (new.status = 'anomaly') execute function public.kw_alert_late_to_anomaly();

-- 7) Box offline / back online ------------------------------------------------------
-- last_seen is refreshed by every upload and every relay poll (about every 5 s), so
-- silence longer than the admin's offline_after_min means: power cut, Wi-Fi or internet
-- down. The server cannot tell which of the three, so the push says "may be".
alter table public.kw_boxes add column if not exists offline_since timestamptz;  -- null = online

create table if not exists public.kw_box_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  box_id     uuid not null references public.kw_boxes(id) on delete cascade,
  unit_code  text not null,
  box_number smallint not null,
  kind       text not null check (kind in ('offline', 'online')),
  last_seen  timestamptz
);
create index if not exists kw_box_events_box on public.kw_box_events (box_id, created_at desc);
alter table public.kw_box_events enable row level security;
revoke all on public.kw_box_events from anon, authenticated;
grant select on public.kw_box_events to authenticated;
drop policy if exists "admin reads box events" on public.kw_box_events;
create policy "admin reads box events" on public.kw_box_events
  for select to authenticated using (public.is_admin());

create or replace function public.kw_check_boxes()
returns integer language plpgsql security definer set search_path = public as $$
declare v_min integer; n1 integer; n2 integer;
begin
  select offline_after_min into v_min from public.kw_anomaly_settings where id = 1;
  v_min := coalesce(v_min, 2);

  -- went silent (one event per outage)
  with gone as (
    update public.kw_boxes b set offline_since = b.last_seen
     where b.last_seen is not null and b.offline_since is null
       and b.last_seen < now() - make_interval(mins => v_min)
    returning b.id, b.unit_id, b.box_number, b.last_seen
  )
  insert into public.kw_box_events (box_id, unit_code, box_number, kind, last_seen)
  select g.id, u.code, g.box_number, 'offline', g.last_seen
    from gone g join public.kw_units u on u.id = g.unit_id;
  get diagnostics n1 = row_count;

  -- reporting again
  with back as (
    update public.kw_boxes b set offline_since = null
     where b.offline_since is not null and b.last_seen > b.offline_since
    returning b.id, b.unit_id, b.box_number, b.last_seen
  )
  insert into public.kw_box_events (box_id, unit_code, box_number, kind, last_seen)
  select g.id, u.code, g.box_number, 'online', g.last_seen
    from back g join public.kw_units u on u.id = g.unit_id;
  get diagnostics n2 = row_count;

  return n1 + n2;
end $$;
revoke all on function public.kw_check_boxes() from public, anon, authenticated;

-- 8) Timers. Enable pg_cron first (Dashboard > Integrations > Cron). --------------------
do $$
begin
  perform cron.schedule('kw-expire-alerts', '15 seconds', 'select public.kw_expire_alerts()');
  perform cron.schedule('kw-check-boxes',   '30 seconds', 'select public.kw_check_boxes()');
exception when others then
  raise notice 'pg_cron not ready (%). Enable it, then schedule kw_expire_alerts() every 15 s and kw_check_boxes() every 30 s.', sqlerrm;
end $$;

-- 9) Checks -----------------------------------------------------------------------
-- select status, auto_flagged, count(*) from kw_alerts group by 1, 2;
-- select * from kw_anomalies order by flagged_at desc;
-- select user_id, platform, updated_at from kw_device_tokens;
-- select * from kw_box_events order by created_at desc;
-- select * from cron.job_run_details order by start_time desc limit 5;
