-- =============================================================================
-- KiloWhat: sudden-spike alerts
-- Run ONCE in the Supabase SQL Editor, after kilowhat_supabase_setup.sql.
-- Safe to run again (everything is "if not exists" / "or replace").
--
-- What this adds
--   kw_alerts        one row per spike/overload sent by a KiloWhat box
--   kw_alert_reads   which user has already seen which alert (for the unread badge)
--   kw_ingest(...)   a second version of your existing kw_ingest that accepts
--                    p_is_anomaly + p_anomalies. Firmware 1.1.0 uses it only when an
--                    alert is pending; normal uploads still use your original function.
-- =============================================================================

-- 1) Who belongs to which unit --------------------------------------------------
-- Uses your EXISTING kw_unit_members table (unit_id + user_id) and kw_units (the box's
-- UNIT_CODE maps to kw_units.code -> kw_units.id). Nothing in those tables is changed.
-- If your column names differ, this is the only place to edit.
create or replace function public.kw_user_in_unit(p_unit text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.kw_unit_members m
    join public.kw_units u on u.id = m.unit_id
    where u.code = p_unit
      and m.user_id   = auth.uid()
  );
$$;

revoke all on function public.kw_user_in_unit(text) from public, anon;
grant execute on function public.kw_user_in_unit(text) to authenticated;

-- 2) Alerts ---------------------------------------------------------------------
create table if not exists public.kw_alerts (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),   -- when the database received it
  event_at    timestamptz not null,                 -- when the box measured it
  unit_code   text        not null,                 -- the unit the box belongs to
  box_number  smallint    not null,                 -- the box inside that unit
  outlet      smallint    not null check (outlet between 1 and 3),
  alert_type  text        not null check (alert_type in ('power_spike', 'overload')),
  power_w     real,
  prev_power_w real,
  current_a   real,
  voltage_v   real,
  message     text        not null,
  fw          text
);

-- Allowed alert types (re-created so this script also upgrades a table made by an earlier run).
alter table public.kw_alerts drop constraint if exists kw_alerts_alert_type_check;
alter table public.kw_alerts add constraint kw_alerts_alert_type_check
  check (alert_type in ('power_spike', 'overload', 'voltage_sag', 'overvoltage'));

-- A retried upload can never create the same alert twice.
create unique index if not exists kw_alerts_no_duplicates
  on public.kw_alerts (unit_code, box_number, outlet, alert_type, event_at);
create index if not exists kw_alerts_unit_newest
  on public.kw_alerts (unit_code, created_at desc);

alter table public.kw_alerts enable row level security;

-- Only users of the box's unit can read its alerts. Nobody can write directly:
-- rows are created only by kw_ingest() below, after the box's device key is checked.
drop policy if exists "unit members read alerts" on public.kw_alerts;
create policy "unit members read alerts" on public.kw_alerts
  for select to authenticated using (public.kw_user_in_unit(unit_code));

revoke all on public.kw_alerts from anon, authenticated;
grant select on public.kw_alerts to authenticated;

-- 3) Read receipts --------------------------------------------------------------
create table if not exists public.kw_alert_reads (
  alert_id bigint      not null references public.kw_alerts(id) on delete cascade,
  user_id  uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  read_at  timestamptz not null default now(),
  primary key (alert_id, user_id)
);

alter table public.kw_alert_reads enable row level security;

drop policy if exists "read own receipts" on public.kw_alert_reads;
create policy "read own receipts" on public.kw_alert_reads
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "mark own alerts read" on public.kw_alert_reads;
create policy "mark own alerts read" on public.kw_alert_reads
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.kw_alerts a where a.id = alert_id)   -- kw_alerts RLS applies: unit members only
  );

revoke all on public.kw_alert_reads from anon, authenticated;
grant select, insert on public.kw_alert_reads to authenticated;

-- 4) Live push to the app -------------------------------------------------------
-- Supabase Realtime applies the RLS policy above, so a user's app only receives
-- alerts of its own unit.
do $$
begin
  alter publication supabase_realtime add table public.kw_alerts;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- 5) The ingest function the box calls when an alert is pending ------------------
-- Same name as your existing kw_ingest, but with two extra required parameters, so
-- PostgREST picks this one only when the box sends p_is_anomaly / p_anomalies.
-- Step 1 runs your ORIGINAL kw_ingest unchanged. It checks the unit, box number and
-- device key (a wrong key raises an error and nothing below runs).
-- Step 2 stores the alerts, using the unit and box of that same checked request, so a
-- box can only raise alerts for its own unit.
create or replace function public.kw_ingest(
  p_unit       text,
  p_box        integer,
  p_key        text,
  p_rssi       integer,
  p_faults     integer,
  p_fw         text,
  p_outlets    jsonb,
  p_samples    jsonb,
  p_is_anomaly boolean,
  p_anomalies  jsonb
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  ev       jsonb;
  v_outlet integer;
  v_type   text;
  v_t      bigint;
  v_when   timestamptz;
  v_msg    text;
begin
  -- 1) normal upload through the original 8-argument function (literals are passed as
  --    text so this works whatever integer/jsonb types the original uses)
  execute format(
    'select public.kw_ingest(p_unit => %L, p_box => %L, p_key => %L, p_rssi => %L, '
    'p_faults => %L, p_fw => %L, p_outlets => %L, p_samples => %L)',
    p_unit, p_box, p_key, p_rssi, p_faults, p_fw, p_outlets::text, p_samples::text);

  -- 2) store the alerts
  if coalesce(p_is_anomaly, false) and jsonb_typeof(p_anomalies) = 'array' then
    for ev in select value from jsonb_array_elements(p_anomalies) limit 6 loop
      v_outlet := (ev ->> 'o')::integer;
      continue when v_outlet is null or v_outlet not between 1 and 3;

      v_type := case ev ->> 'k'
                  when 'overload'    then 'overload'
                  when 'sag'         then 'voltage_sag'
                  when 'overvoltage' then 'overvoltage'
                  else 'power_spike' end;

      -- use the box clock when it looks right, otherwise the database clock
      v_t    := coalesce((ev ->> 't')::bigint, 0);
      v_when := case when v_t > 1704067200 and v_t < extract(epoch from now()) + 300
                     then to_timestamp(v_t) else now() end;

      if v_type = 'overload' then
        v_msg := format('Overload on Box %s, Outlet %s: %s W.',
                        p_box, v_outlet, coalesce(round((ev ->> 'p')::numeric)::text, '?'));
      elsif v_type = 'voltage_sag' then
        v_msg := format('Low voltage (brownout) on Box %s: %s V. Appliances may not run properly.',
                        p_box, coalesce(round((ev ->> 'v')::numeric)::text, '?'));
      elsif v_type = 'overvoltage' then
        v_msg := format('High voltage on Box %s: %s V. Consider unplugging sensitive appliances.',
                        p_box, coalesce(round((ev ->> 'v')::numeric)::text, '?'));
      else
        v_msg := format('Sudden power spike on Box %s, Outlet %s: %s W (was %s W).',
                        p_box, v_outlet,
                        coalesce(round((ev ->> 'p')::numeric)::text, '?'),
                        coalesce(round((ev ->> 'pp')::numeric)::text, '?'));
      end if;

      insert into public.kw_alerts
        (event_at, unit_code, box_number, outlet, alert_type,
         power_w, prev_power_w, current_a, voltage_v, message, fw)
      values
        (v_when, p_unit, p_box, v_outlet, v_type,
         (ev ->> 'p')::real, (ev ->> 'pp')::real, (ev ->> 'i')::real, (ev ->> 'v')::real,
         v_msg, p_fw)
      on conflict do nothing;
    end loop;
  end if;
end;
$$;

revoke all on function public.kw_ingest(text, integer, text, integer, integer, text, jsonb, jsonb, boolean, jsonb) from public;
grant execute on function public.kw_ingest(text, integer, text, integer, integer, text, jsonb, jsonb, boolean, jsonb) to anon, authenticated;

-- 7) Quick checks ---------------------------------------------------------------
-- select * from public.kw_alerts order by created_at desc limit 20;
-- The app, signed in as a tenant, should see only its own unit's rows:
--   select * from kw_alerts order by created_at desc;
