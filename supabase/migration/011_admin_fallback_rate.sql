-- 011  Cost fallback = average of the rates that units have set (instead of one fixed number)
--      Units with their own rate_per_kwh keep it. Units without one use the AVERAGE of all rates that are set
--      (rates > 0). If no unit has a rate yet, the website's default (8.50) is used.
--      Replaces admin_dashboard_stats and admin_unit_energy (same signatures and return types; only the cost line changes)
--      and adds admin_fallback_rate so the pages can show which rate was used. No table or policy is changed.

-- internal helper: not callable from the website
create or replace function public.kw_admin_fallback_rate(p_default numeric)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select round(avg(k.rate_per_kwh), 4) from public.kw_units k where k.rate_per_kwh > 0), p_default);
$$;
revoke all on function public.kw_admin_fallback_rate(numeric) from public, anon, authenticated;

-- for the website: which fallback rate is in use, and where it comes from
create or replace function public.admin_fallback_rate(p_default_rate numeric default 8.5)
returns table (rate numeric, source text, units_with_rate integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_default_rate is null or p_default_rate < 0 or p_default_rate > 1000 then
    raise exception 'invalid_rate' using errcode = '22023';
  end if;
  return query
  select public.kw_admin_fallback_rate(p_default_rate),
         case when exists (select 1 from public.kw_units k where k.rate_per_kwh > 0) then 'average' else 'default' end,
         (select count(*)::integer from public.kw_units k where k.rate_per_kwh > 0);
end $$;
revoke all on function public.admin_fallback_rate(numeric) from public, anon;
grant execute on function public.admin_fallback_rate(numeric) to authenticated;

create or replace function public.admin_dashboard_stats(p_default_rate numeric default 8.5)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz    constant text := 'Asia/Manila';
  v_start timestamptz := date_trunc('month', now(), 'Asia/Manila');
  v_prev  timestamptz;
  v_out   jsonb;
  v_fb    numeric;
begin
  if not (select public.is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_default_rate is null or p_default_rate < 0 or p_default_rate > 1000 then
    raise exception 'invalid_rate' using errcode = '22023';
  end if;
  v_prev := date_trunc('month', v_start - interval '1 day', v_tz);
  v_fb   := public.kw_admin_fallback_rate(p_default_rate);

  with d as (select * from public.kw_admin_deltas(v_prev, now() + interval '1 hour')),
  per as (
    select d.unit_id,
           sum(d.dk) filter (where d.recorded_at >= v_start) as m,
           sum(d.dk) filter (where d.recorded_at <  v_start) as p
      from d group by d.unit_id
  ),
  tot as (
    select coalesce(sum(per.m), 0) as kwh_m,
           coalesce(sum(per.m * coalesce(k.rate_per_kwh, v_fb)), 0) as cost_m,
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
  v_fb     numeric;
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
  v_fb   := public.kw_admin_fallback_rate(p_default_rate);

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
           (coalesce(cur.k, 0) * coalesce(k.rate_per_kwh, v_fb))::double precision as ucost,
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
