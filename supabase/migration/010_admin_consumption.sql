-- 010  Admin website: unit-level consumption, device status and dashboard totals (read-only)
--      Adds 4 admin functions plus 1 internal helper. No table, policy or app-facing function is changed.
--      Admin functions refuse non-admins (is_admin() also requires a verified session).
--      Unit-level totals only: no outlet ids, outlet labels, appliance data, link_code or device keys are returned.
--      Energy = sum of increases of each outlet's cumulative PZEM counter (counter resets handled), same rule as kw_usage.
--      "Online" = a box heartbeat (last_seen) within the last 90 seconds.

-- internal helper: per-reading energy increase per outlet. NOT callable from the website. ------------
create or replace function public.kw_admin_deltas(p_from timestamptz, p_to timestamptz)
returns table (unit_id uuid, recorded_at timestamptz, power_w real, dk double precision)
language sql stable security definer set search_path = '' as $$
  with r as (
    select b.unit_id as uid, x.recorded_at as at, x.power_w as pw, x.energy_kwh as e,
           lag(x.energy_kwh) over (partition by x.outlet_id order by x.recorded_at) as pe
      from public.kw_readings x
      join public.kw_outlets o on o.id = x.outlet_id
      join public.kw_boxes   b on b.id = o.box_id
     where x.recorded_at >= p_from - interval '2 days'   -- look-back so the first reading in range has a previous value
       and x.recorded_at <  p_to
  )
  select r.uid, r.at, r.pw,
         case when r.pe is null then 0::double precision
              when r.e >= r.pe  then r.e - r.pe
              else coalesce(r.e, 0::double precision) end   -- counter reset
    from r
   where r.at >= p_from;
$$;
revoke all on function public.kw_admin_deltas(timestamptz, timestamptz) from public, anon, authenticated;

-- 1 -- Dashboard totals ----------------------------------------------------------------------------
create or replace function public.admin_dashboard_stats(p_default_rate numeric default 8.5)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz    constant text := 'Asia/Manila';
  v_start timestamptz := date_trunc('month', now(), 'Asia/Manila');
  v_prev  timestamptz;
  v_out   jsonb;
begin
  if not (select public.is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_default_rate is null or p_default_rate < 0 or p_default_rate > 1000 then
    raise exception 'invalid_rate' using errcode = '22023';
  end if;
  v_prev := date_trunc('month', v_start - interval '1 day', v_tz);

  with d as (select * from public.kw_admin_deltas(v_prev, now() + interval '1 hour')),
  per as (
    select d.unit_id,
           sum(d.dk) filter (where d.recorded_at >= v_start) as m,
           sum(d.dk) filter (where d.recorded_at <  v_start) as p
      from d group by d.unit_id
  ),
  tot as (
    select coalesce(sum(per.m), 0) as kwh_m,
           coalesce(sum(per.m * coalesce(k.rate_per_kwh, p_default_rate)), 0) as cost_m,
           coalesce(sum(per.p), 0) as kwh_p
      from per join public.kw_units k on k.id = per.unit_id
  )
  select jsonb_build_object(
           'units',           (select count(*) from public.kw_units),
           'boxes',           (select count(*) from public.kw_boxes),
           'boxes_online',    (select count(*) from public.kw_boxes where last_seen > now() - interval '90 seconds'),
           'kwh_month',       tot.kwh_m,
           'cost_month',      tot.cost_m,
           'kwh_prev_month',  tot.kwh_p,
           'last_reading_at', (select max(l.recorded_at) from public.kw_outlet_latest l))
    into v_out from tot;
  return v_out;
end $$;
revoke all on function public.admin_dashboard_stats(numeric) from public, anon;
grant execute on function public.admin_dashboard_stats(numeric) to authenticated;

-- 2 -- Units with consumption for a period (paged and sortable on the server) --------------------------
create or replace function public.admin_unit_energy(
  p_from         timestamptz,
  p_to           timestamptz,
  p_default_rate numeric default 8.5,
  p_code         text    default null,     -- one unit, or null for all
  p_sort         text    default 'code',   -- code | kwh | cost | change
  p_desc         boolean default false,
  p_limit        integer default 15,       -- clamped 1..100
  p_offset       integer default 0
)
returns table (
  unit_code text, unit_name text, rate_per_kwh numeric,
  kwh double precision, prev_kwh double precision, cost double precision, change_pct double precision,
  peak_w double precision, last_reading_at timestamptz,
  box_count integer, boxes_online integer, linked text, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_sort   text    := lower(coalesce(p_sort, 'code'));
  v_desc   boolean := coalesce(p_desc, false);
  v_limit  integer := least(greatest(coalesce(p_limit, 15), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_prev   timestamptz;
begin
  if not (select public.is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '366 days' then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  if p_default_rate is null or p_default_rate < 0 or p_default_rate > 1000 then
    raise exception 'invalid_rate' using errcode = '22023';
  end if;
  if v_sort not in ('code', 'kwh', 'cost', 'change') then
    raise exception 'invalid_sort' using errcode = '22023';
  end if;
  v_prev := p_from - (p_to - p_from);   -- previous period of the same length

  return query
  with d as (select * from public.kw_admin_deltas(v_prev, p_to)),
  cur as (
    select d.unit_id,
           coalesce(sum(d.dk) filter (where d.recorded_at >= p_from), 0) as k,
           coalesce(sum(d.dk) filter (where d.recorded_at <  p_from), 0) as pk
      from d group by d.unit_id
  ),
  pk as (   -- peak demand: highest per-minute sum of power across the unit's outlets
    select m.unit_id, max(m.s) as w
      from (select d.unit_id, date_trunc('minute', d.recorded_at) as mn, sum(d.power_w) as s
              from d where d.recorded_at >= p_from group by 1, 2) m
     group by m.unit_id
  ),
  f as (
    select k.id as uid, k.code as ucode, k.name as uname, k.rate_per_kwh as urate,
           coalesce(cur.k, 0)::double precision  as ukwh,
           coalesce(cur.pk, 0)::double precision as upkwh,
           (coalesce(cur.k, 0) * coalesce(k.rate_per_kwh, p_default_rate))::double precision as ucost,
           case when coalesce(cur.pk, 0) > 0 then ((cur.k - cur.pk) / cur.pk * 100)::double precision end as uchg,
           pk.w::double precision as upeak
      from public.kw_units k
      left join cur on cur.unit_id = k.id
      left join pk  on pk.unit_id  = k.id
     where p_code is null or k.code = p_code
  ),
  g as (
    select f.*,
           case v_sort when 'kwh' then f.ukwh when 'cost' then f.ucost when 'change' then f.uchg end as skey
      from f
  )
  select g.ucode, g.uname, g.urate, g.ukwh, g.upkwh, g.ucost, g.uchg, g.upeak,
         (select max(l.recorded_at)
            from public.kw_outlet_latest l
            join public.kw_outlets o on o.id = l.outlet_id
            join public.kw_boxes   b on b.id = o.box_id
           where b.unit_id = g.uid),
         (select count(*)::integer from public.kw_boxes b where b.unit_id = g.uid),
         (select count(*)::integer from public.kw_boxes b where b.unit_id = g.uid and b.last_seen > now() - interval '90 seconds'),
         (select string_agg(pr.full_name, ', ' order by pr.full_name)
            from public.kw_unit_members m join public.profiles pr on pr.id = m.user_id
           where m.unit_id = g.uid),
         count(*) over ()
    from g
   order by (case when v_desc then -g.skey else g.skey end) nulls last,
            case when v_sort = 'code' and v_desc then g.ucode end desc,
            g.ucode asc
   limit v_limit offset v_offset;
end $$;
revoke all on function public.admin_unit_energy(timestamptz, timestamptz, numeric, text, text, boolean, integer, integer) from public, anon;
grant execute on function public.admin_unit_energy(timestamptz, timestamptz, numeric, text, text, boolean, integer, integer) to authenticated;

-- 3 -- kWh series for charts (all units, or one unit by code) -------------------------------------------
create or replace function public.admin_energy_series(
  p_from   timestamptz,
  p_to     timestamptz,
  p_code   text default null,
  p_bucket text default 'day',          -- day | month
  p_tz     text default 'Asia/Manila'
)
returns table (bucket timestamptz, kwh double precision)
language plpgsql stable security definer set search_path = '' as $$
declare v_bucket text := lower(coalesce(p_bucket, 'day'));
begin
  if not (select public.is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '366 days' then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  if v_bucket not in ('day', 'month') then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_tz) then
    raise exception 'invalid_tz' using errcode = '22023';
  end if;

  return query
  with d as (
    select x.recorded_at, x.dk
      from public.kw_admin_deltas(p_from, p_to) x
      join public.kw_units k on k.id = x.unit_id
     where p_code is null or k.code = p_code
  ),
  s as (
    select date_trunc(v_bucket, d.recorded_at, p_tz) as b, sum(d.dk) as k from d group by 1
  ),
  gs as (   -- every bucket in range, so the chart has no gaps (stepped on local time, then converted back)
    select (t at time zone p_tz) as b
      from generate_series(date_trunc(v_bucket, p_from at time zone p_tz),
                           (p_to at time zone p_tz) - interval '1 microsecond',
                           case v_bucket when 'month' then interval '1 month' else interval '1 day' end) t
  )
  select gs.b, coalesce(s.k, 0)::double precision
    from gs left join s on s.b = gs.b
   order by gs.b;
end $$;
revoke all on function public.admin_energy_series(timestamptz, timestamptz, text, text, text) from public, anon;
grant execute on function public.admin_energy_series(timestamptz, timestamptz, text, text, text) to authenticated;

-- 4 -- one unit's details (unit level; no outlet or appliance data) -------------------------------------
create or replace function public.admin_unit_info(p_code text)
returns table (
  code text, name text, rate_per_kwh numeric, created_at timestamptz,
  box_count integer, boxes_online integer, last_seen timestamptz, last_reading_at timestamptz, linked jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select k.code, k.name, k.rate_per_kwh, k.created_at,
         (select count(*)::integer from public.kw_boxes b where b.unit_id = k.id),
         (select count(*)::integer from public.kw_boxes b where b.unit_id = k.id and b.last_seen > now() - interval '90 seconds'),
         (select max(b.last_seen) from public.kw_boxes b where b.unit_id = k.id),
         (select max(l.recorded_at)
            from public.kw_outlet_latest l
            join public.kw_outlets o on o.id = l.outlet_id
            join public.kw_boxes   b on b.id = o.box_id
           where b.unit_id = k.id),
         coalesce((select jsonb_agg(jsonb_build_object('name', pr.full_name, 'member_role', m.role) order by pr.full_name)
                     from public.kw_unit_members m join public.profiles pr on pr.id = m.user_id
                    where m.unit_id = k.id), '[]'::jsonb)
    from public.kw_units k
   where k.code = p_code;
end $$;
revoke all on function public.admin_unit_info(text) from public, anon;
grant execute on function public.admin_unit_info(text) to authenticated;
