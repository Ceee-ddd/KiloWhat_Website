-- =============================================================================
-- KiloWhat - COMPLETE Supabase setup (run this ONE file, once)
-- Supabase Dashboard > SQL Editor > New query > paste everything > Run
--
-- It is safe to run again: it will not duplicate or delete your data.
--
-- What it creates
--   Units    : an apartment unit (code written into each box's firmware, e.g. "UNIT-1")
--   Boxes    : several boxes per unit; box number is unique inside its unit
--   Outlets  : 3 per box.  PZEM1/2/3 = Outlet 1/2/3 of that box
--   Readings : history of voltage, current, power, energy, frequency, power factor
--   Latest   : one always-current row per outlet (live screen)
--   Commands : relay on/off requests from the app, picked up by the ESP32
--
-- How the ESP32 talks to the database (no direct table access):
--   kw_ingest(unit, box, key, ...)  uploads readings + status
--   kw_poll(unit, box, key, ...)    gets relay commands and confirms them
--
-- How the app talks to the database (logged-in users):
--   kw_live                         view: live values of every outlet (filter by unit_code)
--   kw_readings                     table: raw history
--   kw_usage(...)                   function: kWh per hour/day/week/month
--   kw_set_relay(outlet, on)        function: switch a relay
-- =============================================================================


-- REQUIRES: 001_auth_foundation.sql must already be applied (this file uses its
-- public.is_session_verified() so that an unverified login session sees nothing here either).
do $$
begin
  if to_regprocedure('public.is_session_verified()') is null then
    raise exception 'Run 001_auth_foundation.sql first (public.is_session_verified() not found).';
  end if;
end
$$;


-- =============================================================================
-- 1. TABLES
-- =============================================================================

create table if not exists public.kw_units (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (length(code) between 1 and 40),  -- goes into the firmware
  name        text,                                                         -- e.g. "Unit 101 - Tower A"
  app_unit_id uuid,        -- optional: id of this unit in your app's existing apartment/unit table
  created_at  timestamptz not null default now()
);

create table if not exists public.kw_boxes (
  id         uuid primary key default gen_random_uuid(),
  unit_id    uuid not null references public.kw_units(id),
  box_number smallint not null check (box_number > 0),
  name       text not null default 'KiloWhat Box',
  last_seen  timestamptz,                  -- updated on every upload and poll (heartbeat)
  wifi_rssi  smallint,
  fault_mask integer not null default 0,   -- bit0 Wi-Fi, bit1 internet, bits2-4 PZEM1-3, bits5-7 relay1-3
  firmware   text,
  created_at timestamptz not null default now(),
  constraint kw_boxes_unit_box_unique unique (unit_id, box_number)
);

-- Device keys are kept in their own table so the app can never read them.
create table if not exists public.kw_box_secrets (
  box_id     uuid primary key references public.kw_boxes(id) on delete cascade,
  device_key text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);

create table if not exists public.kw_outlets (
  id            uuid primary key default gen_random_uuid(),
  box_id        uuid not null references public.kw_boxes(id) on delete cascade,
  outlet_number smallint not null check (outlet_number between 1 and 3),
  label         text,                      -- e.g. "Aircon", "Refrigerator"
  unique (box_id, outlet_number)
);

create table if not exists public.kw_readings (
  id           bigint generated always as identity primary key,
  outlet_id    uuid not null references public.kw_outlets(id) on delete cascade,
  recorded_at  timestamptz not null,                 -- when the ESP32 took the reading (UTC)
  received_at  timestamptz not null default now(),   -- when the database got it
  voltage_v    real,
  current_a    real,
  power_w      real,
  energy_kwh   double precision,                     -- cumulative PZEM counter
  frequency_hz real,
  power_factor real,
  relay_on     boolean,
  unique (outlet_id, recorded_at)                    -- a retried upload can never create duplicates
);
create index if not exists kw_readings_time_idx on public.kw_readings (recorded_at desc);

create table if not exists public.kw_outlet_latest (
  outlet_id    uuid primary key references public.kw_outlets(id) on delete cascade,
  recorded_at  timestamptz,
  voltage_v    real,
  current_a    real,
  power_w      real,
  energy_kwh   double precision,
  frequency_hz real,
  power_factor real,
  relay_on     boolean,
  pzem_fault   boolean not null default false,
  relay_fault  boolean not null default false,
  status_at    timestamptz
);

create table if not exists public.kw_relay_commands (
  id           bigint generated always as identity primary key,
  outlet_id    uuid not null references public.kw_outlets(id) on delete cascade,
  desired_on   boolean not null,
  requested_by uuid default auth.uid(),              -- which logged-in user asked
  requested_at timestamptz not null default now(),
  status       text not null default 'pending'
               check (status in ('pending', 'done', 'failed', 'expired', 'superseded')),
  processed_at timestamptz,
  result       text
);
create index if not exists kw_relay_commands_outlet_idx
  on public.kw_relay_commands (outlet_id, requested_at desc);
create index if not exists kw_relay_commands_pending_idx
  on public.kw_relay_commands (outlet_id) where status = 'pending';


-- =============================================================================
-- 2. CREATING A BOX AUTOMATICALLY CREATES ITS KEY AND ITS 3 OUTLETS
-- =============================================================================

create or replace function public.kw_on_box_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into kw_box_secrets (box_id) values (new.id);
  insert into kw_outlets (box_id, outlet_number, label)
    select new.id, n, 'Outlet ' || n from generate_series(1, 3) as n;
  insert into kw_outlet_latest (outlet_id)
    select id from kw_outlets where box_id = new.id;
  return new;
end;
$$;

drop trigger if exists kw_box_created on public.kw_boxes;
create trigger kw_box_created
  after insert on public.kw_boxes
  for each row execute function public.kw_on_box_created();


-- =============================================================================
-- 3. ESP32 FUNCTIONS (the only way a box writes or reads anything)
-- =============================================================================

-- Shared check: does this unit code + box number + device key match a real box?
create or replace function public.kw_auth_box(p_unit text, p_box smallint, p_key text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.id
    from kw_boxes b
    join kw_units u       on u.id = b.unit_id
    join kw_box_secrets s on s.box_id = b.id
   where u.code = p_unit
     and b.box_number = p_box
     and s.device_key = p_key;
$$;

-- Upload readings and status.
create or replace function public.kw_ingest(
  p_unit    text,
  p_box     smallint,
  p_key     text,
  p_rssi    smallint default null,
  p_faults  integer  default 0,
  p_fw      text     default null,
  p_outlets jsonb    default '[]'::jsonb,   -- [{"o":1,"r":true,"pf":false,"rf":false}, ...]
  p_samples jsonb    default '[]'::jsonb    -- [{"o":1,"t":1767225600,"v":230.1,"i":0.1,"p":23,"e":1.2,"f":50,"pf":0.9,"r":true}, ...]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box_id   uuid;
  v_inserted integer := 0;
begin
  v_box_id := kw_auth_box(p_unit, p_box, p_key);
  if v_box_id is null then
    raise exception 'invalid unit, box or device key' using errcode = '28000';
  end if;

  -- heartbeat
  update kw_boxes
     set last_seen  = now(),
         wifi_rssi  = p_rssi,
         fault_mask = coalesce(p_faults, 0),
         firmware   = coalesce(p_fw, firmware)
   where id = v_box_id;

  -- live status of each outlet (relay state + fault flags)
  update kw_outlet_latest l
     set relay_on    = (x->>'r')::boolean,
         pzem_fault  = coalesce((x->>'pf')::boolean, false),
         relay_fault = coalesce((x->>'rf')::boolean, false),
         status_at   = now()
    from jsonb_array_elements(coalesce(p_outlets, '[]'::jsonb)) x,
         kw_outlets o
   where o.box_id = v_box_id
     and o.outlet_number = (x->>'o')::smallint
     and l.outlet_id = o.id;

  -- readings: insert history, ignore duplicates, refresh the "latest" row
  with s as (
    select o.id as outlet_id,
           case when (x->>'t')::bigint > 1704067200            -- after 1 Jan 2024 = a real clock
                then to_timestamp((x->>'t')::bigint)
                else now() end                  as ts,
           (x->>'v')::real                      as v,
           (x->>'i')::real                      as i,
           (x->>'p')::real                      as p,
           (x->>'e')::double precision          as e,
           (x->>'f')::real                      as f,
           (x->>'pf')::real                     as pf,
           (x->>'r')::boolean                   as r
      from jsonb_array_elements(coalesce(p_samples, '[]'::jsonb)) x
      join kw_outlets o
        on o.box_id = v_box_id
       and o.outlet_number = (x->>'o')::smallint
  ),
  ins as (
    insert into kw_readings
      (outlet_id, recorded_at, voltage_v, current_a, power_w, energy_kwh, frequency_hz, power_factor, relay_on)
    select outlet_id, ts, v, i, p, e, f, pf, r from s
    on conflict (outlet_id, recorded_at) do nothing
    returning 1
  ),
  upd as (
    update kw_outlet_latest l
       set recorded_at = n.ts, voltage_v = n.v, current_a = n.i, power_w = n.p,
           energy_kwh = n.e, frequency_hz = n.f, power_factor = n.pf
      from (select distinct on (outlet_id) * from s order by outlet_id, ts desc) n
     where l.outlet_id = n.outlet_id
       and (l.recorded_at is null or n.ts > l.recorded_at)
    returning 1
  )
  select (select count(*) from ins) into v_inserted;

  return jsonb_build_object('ok', true, 'inserted', v_inserted);
end;
$$;

-- Get relay commands and confirm finished ones.
-- Returns plain text "12,1,1;13,3,0" = command id, outlet number, 1 = ON / 0 = OFF. Empty text = nothing to do.
create or replace function public.kw_poll(
  p_unit text,
  p_box  smallint,
  p_key  text,
  p_acks jsonb default '[]'::jsonb      -- [{"id":12,"ok":true}, ...]
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box_id uuid;
  v_out    text;
begin
  v_box_id := kw_auth_box(p_unit, p_box, p_key);
  if v_box_id is null then
    raise exception 'invalid unit, box or device key' using errcode = '28000';
  end if;

  update kw_boxes set last_seen = now() where id = v_box_id;   -- polling also counts as a heartbeat

  -- record confirmations; a confirmed command updates the live relay state at once
  with a as (
    select (x->>'id')::bigint                   as id,
           coalesce((x->>'ok')::boolean, false) as ok
      from jsonb_array_elements(coalesce(p_acks, '[]'::jsonb)) x
  ),
  done as (
    update kw_relay_commands c
       set status       = case when a.ok then 'done' else 'failed' end,
           processed_at = now(),
           result       = case when a.ok then 'applied by device' else 'device could not apply it' end
      from a, kw_outlets o
     where c.id = a.id
       and c.outlet_id = o.id
       and o.box_id = v_box_id
       and c.status = 'pending'
    returning c.outlet_id, c.desired_on, c.status
  )
  update kw_outlet_latest l
     set relay_on = d.desired_on, status_at = now()
    from done d
   where l.outlet_id = d.outlet_id and d.status = 'done';

  -- commands that waited more than 60 s are dropped and never executed late
  update kw_relay_commands c
     set status = 'expired', processed_at = now(), result = 'not picked up in time'
    from kw_outlets o
   where c.outlet_id = o.id
     and o.box_id = v_box_id
     and c.status = 'pending'
     and c.requested_at < now() - interval '60 seconds';

  -- hand out what is still pending
  select coalesce(
           string_agg(c.id::text || ',' || o.outlet_number::text || ',' || (case when c.desired_on then '1' else '0' end),
                      ';' order by c.id),
           '')
    into v_out
    from kw_relay_commands c
    join kw_outlets o on o.id = c.outlet_id
   where o.box_id = v_box_id and c.status = 'pending';

  return v_out;
end;
$$;


-- =============================================================================
-- 4. APP FUNCTIONS AND VIEW
-- =============================================================================

-- Switch a relay. Supabase JS:
--   const { data: commandId, error } = await supabase.rpc('kw_set_relay', { p_outlet: outletId, p_on: true });
create or replace function public.kw_set_relay(p_outlet uuid, p_on boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if auth.uid() is null or not public.is_session_verified() then
    raise exception 'login and device verification required' using errcode = '28000';
  end if;

  if not exists (select 1 from kw_outlets where id = p_outlet) then
    raise exception 'unknown outlet' using errcode = '22023';
  end if;

  -- >>> PUT YOUR RULES HERE, for example:
  --   * the logged-in user must be the landlord/tenant of this outlet's unit (kw_units.app_unit_id)
  --   * switching ON is refused when the prepaid balance is zero
  -- (raise an exception to refuse the command)

  -- housekeeping: anything older than 60 s that was never picked up is dead
  update kw_relay_commands
     set status = 'expired', processed_at = now(), result = 'not picked up in time'
   where status = 'pending' and requested_at < now() - interval '60 seconds';

  -- a newer command replaces an older pending one for the same outlet
  update kw_relay_commands
     set status = 'superseded', processed_at = now()
   where outlet_id = p_outlet and status = 'pending';

  insert into kw_relay_commands (outlet_id, desired_on)
  values (p_outlet, p_on)
  returning id into v_id;

  return v_id;
end;
$$;

-- Live screen. All outlets of one unit, ordered:
--   supabase.from('kw_live').select('*').eq('unit_code', 'UNIT-1').order('box_number').order('outlet_number')
drop view if exists public.kw_live;
create view public.kw_live with (security_invoker = true) as
select u.code                                as unit_code,
       u.name                                as unit_name,
       u.app_unit_id,
       b.id                                  as box_id,
       b.box_number,
       b.name                                as box_name,
       o.outlet_number,
       o.id                                  as outlet_id,
       coalesce(o.label, 'Outlet ' || o.outlet_number) as outlet_label,
       l.voltage_v, l.current_a, l.power_w, l.energy_kwh, l.frequency_hz, l.power_factor,
       l.recorded_at,
       l.relay_on, l.pzem_fault, l.relay_fault,
       b.last_seen,
       (b.last_seen > now() - interval '90 seconds') as box_online,   -- 3 missed 30 s uploads = offline
       b.fault_mask
  from kw_outlets o
  join kw_boxes b on b.id = o.box_id
  join kw_units u on u.id = b.unit_id
  left join kw_outlet_latest l on l.outlet_id = o.id;

-- kWh per hour/day/week/month for charts. Adds up increases of the PZEM energy counter and handles resets.
--   supabase.rpc('kw_usage', { p_outlet: id, p_from: '2026-10-01', p_to: '2026-11-01', p_bucket: 'day' })
create or replace function public.kw_usage(
  p_outlet uuid,
  p_from   timestamptz,
  p_to     timestamptz,
  p_bucket text default 'hour',             -- 'hour' | 'day' | 'week' | 'month'
  p_tz     text default 'Asia/Manila'
)
returns table (bucket timestamptz, kwh double precision, avg_power_w real, max_power_w real)
language sql
stable
security invoker
set search_path = public
as $$
  with d as (
    select recorded_at, power_w, energy_kwh,
           case
             when lag(energy_kwh) over w is null            then 0
             when energy_kwh >= lag(energy_kwh) over w      then energy_kwh - lag(energy_kwh) over w
             else energy_kwh                                       -- counter was reset
           end as dk
      from kw_readings
     where outlet_id = p_outlet
       and recorded_at >= p_from
       and recorded_at <  p_to
    window w as (order by recorded_at)
  )
  select date_trunc(p_bucket, recorded_at, p_tz) as bucket,
         sum(dk)                                  as kwh,
         avg(power_w)::real                       as avg_power_w,
         max(power_w)::real                       as max_power_w
    from d
   group by 1
   order by 1;
$$;


-- =============================================================================
-- 5. SECURITY
-- =============================================================================

alter table public.kw_units          enable row level security;
alter table public.kw_boxes          enable row level security;
alter table public.kw_box_secrets    enable row level security;   -- no policies = nobody can read the keys
alter table public.kw_outlets        enable row level security;
alter table public.kw_readings       enable row level security;
alter table public.kw_outlet_latest  enable row level security;
alter table public.kw_relay_commands enable row level security;

-- The ESP32 (anon role) never touches tables directly.
revoke all on public.kw_units, public.kw_boxes, public.kw_box_secrets, public.kw_outlets,
              public.kw_readings, public.kw_outlet_latest, public.kw_relay_commands from anon;
revoke all on public.kw_box_secrets from authenticated;

-- Logged-in app users with a VERIFIED session can READ (same rule as your auth foundation).
-- This is a starting point: once units are linked to users (landlord/tenant ownership), add that check
-- next to the verified-session check in each policy.
drop policy if exists "kw app read units"    on public.kw_units;
drop policy if exists "kw app read boxes"    on public.kw_boxes;
drop policy if exists "kw app read outlets"  on public.kw_outlets;
drop policy if exists "kw app read readings" on public.kw_readings;
drop policy if exists "kw app read latest"   on public.kw_outlet_latest;
drop policy if exists "kw app read commands" on public.kw_relay_commands;
drop policy if exists "kw app tag outlets"   on public.kw_outlets;

create policy "kw app read units"    on public.kw_units          for select to authenticated using ((select public.is_session_verified()));
create policy "kw app read boxes"    on public.kw_boxes          for select to authenticated using ((select public.is_session_verified()));
create policy "kw app read outlets"  on public.kw_outlets        for select to authenticated using ((select public.is_session_verified()));
create policy "kw app read readings" on public.kw_readings       for select to authenticated using ((select public.is_session_verified()));
create policy "kw app read latest"   on public.kw_outlet_latest  for select to authenticated using ((select public.is_session_verified()));
create policy "kw app read commands" on public.kw_relay_commands for select to authenticated using ((select public.is_session_verified()));

-- The app may only rename an outlet (appliance tag), nothing else, and may not write other tables.
create policy "kw app tag outlets" on public.kw_outlets for update to authenticated
  using ((select public.is_session_verified())) with check ((select public.is_session_verified()));
revoke insert, update, delete on public.kw_units, public.kw_boxes, public.kw_outlets, public.kw_readings,
                                 public.kw_outlet_latest, public.kw_relay_commands from authenticated;
grant update (label) on public.kw_outlets to authenticated;

-- Function permissions
revoke all on function public.kw_auth_box(text, smallint, text) from public, anon, authenticated;

revoke all on function public.kw_ingest(text, smallint, text, smallint, integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.kw_ingest(text, smallint, text, smallint, integer, text, jsonb, jsonb) to anon;

revoke all on function public.kw_poll(text, smallint, text, jsonb) from public, anon, authenticated;
grant execute on function public.kw_poll(text, smallint, text, jsonb) to anon;

revoke all on function public.kw_set_relay(uuid, boolean) from public, anon;
grant execute on function public.kw_set_relay(uuid, boolean) to authenticated;


-- =============================================================================
-- 6. LIVE UPDATES IN THE APP (Supabase Realtime)
-- =============================================================================
do $$
begin
  begin alter publication supabase_realtime add table public.kw_outlet_latest;  exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.kw_relay_commands; exception when duplicate_object or undefined_object then null; end;
end
$$;


-- =============================================================================
-- 7. REGISTER YOUR FIRST UNIT AND BOX
-- =============================================================================
insert into public.kw_units (code, name)
values ('UNIT-1', 'Unit 1')
on conflict (code) do nothing;

insert into public.kw_boxes (unit_id, box_number, name)
select id, 1, 'KiloWhat Box 1' from public.kw_units where code = 'UNIT-1'
on conflict (unit_id, box_number) do nothing;

-- To add more later (run separately, any time):
--   insert into public.kw_units (code, name) values ('UNIT-2', 'Unit 2') on conflict (code) do nothing;
--   insert into public.kw_boxes (unit_id, box_number, name)
--     select id, 2, 'KiloWhat Box 2' from public.kw_units where code = 'UNIT-1'
--     on conflict (unit_id, box_number) do nothing;
--   (creating a box automatically creates its 3 outlets and its device key)

-- >>> RESULT: the three values to put in each box's firmware (UNIT_CODE, BOX_NUMBER, BOX_DEVICE_KEY).
-- Treat device_key like a password. Re-run this query any time you need it.
select u.code as unit_code, b.box_number, s.device_key
  from public.kw_boxes b
  join public.kw_units u       on u.id = b.unit_id
  join public.kw_box_secrets s on s.box_id = b.id
 order by u.code, b.box_number;

-- Optional clean-up so the readings table does not grow forever (needs the pg_cron extension):
-- select cron.schedule('kw-prune-readings', '0 3 * * *',
--   $$ delete from public.kw_readings where recorded_at < now() - interval '180 days' $$);
