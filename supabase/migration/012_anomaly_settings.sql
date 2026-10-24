-- 012  Admin anomaly-detection settings (Admin Web > Settings > Anomaly detection)
--      One row only. The website reads/saves it through two admin-only functions; each box asks for its
--      limits through kw_limits() using its device key. No existing table, policy or function is changed.
--      "Threshold limit (kWh/day)" is intentionally NOT stored: consumption limits are the user's own budget.

create table if not exists public.kw_anomaly_settings (
  id                   smallint primary key default 1 check (id = 1),   -- single row

  -- detection (used by the box and by the server-side checks)
  surge_pct            integer not null default 50  check (surge_pct between 10 and 500),      -- % above the previous reading
  surge_min_watts      integer not null default 30  check (surge_min_watts between 1 and 5000), -- ignore small jumps (5 W -> 8 W)
  sag_floor_v          integer not null default 200 check (sag_floor_v between 120 and 229),   -- brownout: below this
  overvoltage_v        integer not null default 250 check (overvoltage_v between 231 and 300), -- above this
  offline_after_min    integer not null default 2   check (offline_after_min between 1 and 60),-- box silent this long = offline / possible blackout
  flag_zero_usage      boolean not null default true,
  zero_usage_hours     integer not null default 48  check (zero_usage_hours between 1 and 720),
  flag_reverse_energy  boolean not null default false,   -- off until the PZEM is confirmed to report direction

  -- severity / queue behaviour (admin page rows)
  critical_rule        text not null default 'Overload, Cutoff'
                       check (critical_rule in ('Overload, Cutoff', 'Overload only')),
  warning_rule         text not null default 'Voltage sag, Surge'
                       check (warning_rule in ('Voltage sag, Surge', 'Surge only')),
  resolve_rule         text not null default 'Auto after 7 days normal'
                       check (resolve_rule in ('Auto after 7 days normal', 'Manual only')),
  notify_landlord      boolean not null default true,
  group_repeat_flags   boolean not null default true,
  escalate_after_hours integer not null default 24 check (escalate_after_hours between 1 and 720),

  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  constraint kw_anomaly_sag_below_over check (sag_floor_v < overvoltage_v)
);

insert into public.kw_anomaly_settings (id) values (1) on conflict (id) do nothing;

-- No direct table access from the app or the website: everything goes through the functions below.
alter table public.kw_anomaly_settings enable row level security;
revoke all on public.kw_anomaly_settings from anon, authenticated;


-- Website: read the settings
create or replace function public.admin_get_anomaly_settings()
returns public.kw_anomaly_settings
language plpgsql stable security definer set search_path = '' as $$
declare r public.kw_anomaly_settings;
begin
  if not (select public.is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into r from public.kw_anomaly_settings where id = 1;
  return r;
end $$;
revoke all on function public.admin_get_anomaly_settings() from public, anon;
grant execute on function public.admin_get_anomaly_settings() to authenticated;


-- Website: save the settings. Send only the keys that changed, e.g. {"surge_pct": 60}.
create or replace function public.admin_set_anomaly_settings(p jsonb)
returns public.kw_anomaly_settings
language plpgsql security definer set search_path = '' as $$
declare r public.kw_anomaly_settings;
begin
  if not (select public.is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.kw_anomaly_settings s set
    surge_pct            = coalesce((p->>'surge_pct')::integer,            s.surge_pct),
    surge_min_watts      = coalesce((p->>'surge_min_watts')::integer,      s.surge_min_watts),
    sag_floor_v          = coalesce((p->>'sag_floor_v')::integer,          s.sag_floor_v),
    overvoltage_v        = coalesce((p->>'overvoltage_v')::integer,        s.overvoltage_v),
    offline_after_min    = coalesce((p->>'offline_after_min')::integer,    s.offline_after_min),
    flag_zero_usage      = coalesce((p->>'flag_zero_usage')::boolean,      s.flag_zero_usage),
    zero_usage_hours     = coalesce((p->>'zero_usage_hours')::integer,     s.zero_usage_hours),
    flag_reverse_energy  = coalesce((p->>'flag_reverse_energy')::boolean,  s.flag_reverse_energy),
    critical_rule        = coalesce(p->>'critical_rule',                   s.critical_rule),
    warning_rule         = coalesce(p->>'warning_rule',                    s.warning_rule),
    resolve_rule         = coalesce(p->>'resolve_rule',                    s.resolve_rule),
    notify_landlord      = coalesce((p->>'notify_landlord')::boolean,      s.notify_landlord),
    group_repeat_flags   = coalesce((p->>'group_repeat_flags')::boolean,   s.group_repeat_flags),
    escalate_after_hours = coalesce((p->>'escalate_after_hours')::integer, s.escalate_after_hours),
    updated_at = now(),
    updated_by = auth.uid()
  where s.id = 1
  returning s.* into r;

  insert into public.admin_audit_log (actor_id, actor_email, action, target, metadata)
  values (auth.uid(), (select u.email from auth.users u where u.id = auth.uid()),
          'anomaly_settings_update', 'kw_anomaly_settings', p);

  return r;
exception
  when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_setting' using errcode = '22023';
end $$;
revoke all on function public.admin_set_anomaly_settings(jsonb) from public, anon;
grant execute on function public.admin_set_anomaly_settings(jsonb) to authenticated;


-- Box (ESP32): "surge_pct,surge_min_watts,sag_floor_v,overvoltage_v", e.g. "50,30,200,250".
-- Separate from kw_poll on purpose, so the working relay-command format is not touched.
create or replace function public.kw_limits(p_unit text, p_box smallint, p_key text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_box_id uuid;
  s        public.kw_anomaly_settings;
begin
  v_box_id := kw_auth_box(p_unit, p_box, p_key);
  if v_box_id is null then
    raise exception 'invalid unit, box or device key' using errcode = '28000';
  end if;
  select * into s from public.kw_anomaly_settings where id = 1;
  return s.surge_pct || ',' || s.surge_min_watts || ',' || s.sag_floor_v || ',' || s.overvoltage_v;
end $$;
revoke all on function public.kw_limits(text, smallint, text) from public, anon, authenticated;
grant execute on function public.kw_limits(text, smallint, text) to anon;
