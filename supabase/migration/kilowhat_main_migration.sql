-- =============================================================================
-- KiloWhat Main: database changes for an EXISTING database
-- (run once in Supabase SQL Editor, after kilowhat_supabase_setup.sql was already run.
--  A fresh install does not need this file: kilowhat_supabase_setup.sql already includes it.)
--
-- What changes
--   * kw_boxes gets a "kind": 'box' (3 outlets) or 'main' (2 contactor channels)
--   * creating a 'main' creates 2 channels instead of 3 outlets
--   * kw_live shows box_kind so the app can tell a Main from a Box
-- Nothing is deleted. Existing boxes become kind 'box'.
-- =============================================================================

alter table public.kw_boxes
  add column if not exists kind text not null default 'box' check (kind in ('box', 'main'));

create or replace function public.kw_on_box_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into kw_box_secrets (box_id) values (new.id);
  if new.kind = 'main' then
    insert into kw_outlets (box_id, outlet_number, label)
      select new.id, n, 'Channel ' || n from generate_series(1, 2) as n;
  else
    insert into kw_outlets (box_id, outlet_number, label)
      select new.id, n, 'Outlet ' || n from generate_series(1, 3) as n;
  end if;
  insert into kw_outlet_latest (outlet_id)
    select id from kw_outlets where box_id = new.id;
  return new;
end;
$$;

drop view if exists public.kw_live;
create view public.kw_live with (security_invoker = true) as
select u.code                                as unit_code,
       u.name                                as unit_name,
       u.app_unit_id,
       b.id                                  as box_id,
       b.box_number,
       b.name                                as box_name,
       b.kind                                as box_kind,
       o.outlet_number,
       o.id                                  as outlet_id,
       coalesce(o.label, 'Outlet ' || o.outlet_number) as outlet_label,
       l.voltage_v, l.current_a, l.power_w, l.energy_kwh, l.frequency_hz, l.power_factor,
       l.recorded_at,
       l.relay_on, l.pzem_fault, l.relay_fault,
       b.last_seen,
       (b.last_seen > now() - interval '90 seconds') as box_online,
       b.fault_mask
  from kw_outlets o
  join kw_boxes b on b.id = o.box_id
  join kw_units u on u.id = b.unit_id
  left join kw_outlet_latest l on l.outlet_id = o.id;

-- =============================================================================
-- Register the Main of a unit (edit the unit code, number and name, then run this part)
-- =============================================================================
insert into public.kw_boxes (unit_id, box_number, name, kind)
select id, 99, 'KiloWhat Main', 'main'
from public.kw_units
where code = 'UNIT-1'
on conflict (unit_id, box_number) do nothing;

-- Run this as a SEPARATE query afterwards: the three values for the Main's firmware.
-- select u.code as unit_code, b.box_number, s.device_key
--   from public.kw_boxes b
--   join public.kw_units u       on u.id = b.unit_id
--   join public.kw_box_secrets s on s.box_id = b.id
--  where u.code = 'UNIT-1' and b.box_number = 99;
