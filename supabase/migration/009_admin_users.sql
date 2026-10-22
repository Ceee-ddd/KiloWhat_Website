-- 009  Admin website: read-only Users data (landlords, tenants, individual users)
--      Adds three security-definer functions. No table, policy or app-facing function is changed.
--      Every function refuses non-admins (is_admin() also requires a verified session).
--      Never returned: birthdate, kw_units.link_code, device keys. Admin accounts are not listed here
--      (they are on Settings -> Administrators).

-- 1 -- role counts for the Dashboard ------------------------------------------------
create or replace function public.admin_user_counts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not (select public.is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'landlord',   count(*) filter (where r.role::text = 'landlord'),
           'tenant',     count(*) filter (where r.role::text = 'tenant'),
           'individual', count(*) filter (where r.role::text = 'individual'),
           'total',      count(distinct r.user_id))
    into v
    from public.user_roles r
   where r.role::text <> 'admin'
     and not exists (select 1 from public.user_roles a where a.user_id = r.user_id and a.role::text = 'admin');
  return v;
end $$;
revoke all on function public.admin_user_counts() from public, anon;
grant execute on function public.admin_user_counts() to authenticated;

-- 2 -- paged, filtered user list ----------------------------------------------------
create or replace function public.admin_users_list(
  p_role   text default null,    -- landlord | tenant | individual | null = all
  p_search text default null,    -- name, email or phone (max 60 chars)
  p_limit  integer default 15,   -- clamped to 1..100
  p_offset integer default 0
)
returns table (
  id               uuid,
  name             text,
  email            text,
  phone            text,
  role             text,
  joined           timestamptz,
  last_sign_in_at  timestamptz,
  suspended        boolean,
  units            text,          -- unit names the user is linked to
  total_count      bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role   text := nullif(lower(btrim(coalesce(p_role, ''))), '');
  v_q      text := left(btrim(coalesce(p_search, '')), 60);
  v_like   text;
  v_limit  integer := least(greatest(coalesce(p_limit, 15), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not (select public.is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_role is not null and v_role not in ('landlord', 'tenant', 'individual') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with base as (
    select p.id as uid, p.full_name as fname, p.phone as fphone, p.created_at as fjoined,
           (array_agg(r.role::text order by case r.role::text when 'landlord' then 1 when 'tenant' then 2 else 3 end))[1] as prim
      from public.profiles p
      join public.user_roles r on r.user_id = p.id
     where r.role::text <> 'admin'
       and not exists (select 1 from public.user_roles a where a.user_id = p.id and a.role::text = 'admin')
     group by p.id
  ), f as (
    select b.uid, b.fname, b.fphone, b.fjoined, b.prim,
           u.email::text as femail, u.last_sign_in_at as flast,
           (u.banned_until is not null and u.banned_until > now()) as fsusp
      from base b
      join auth.users u on u.id = b.uid
     where (v_role is null or exists (select 1 from public.user_roles x where x.user_id = b.uid and x.role::text = v_role))
       and (v_q = ''
            or b.fname ilike v_like escape '\'
            or u.email::text ilike v_like escape '\'
            or coalesce(b.fphone, '') ilike v_like escape '\')
  )
  select f.uid, f.fname, f.femail, f.fphone, coalesce(v_role, f.prim), f.fjoined, f.flast, f.fsusp,
         (select string_agg(coalesce(k.name, k.code), ', ' order by coalesce(k.name, k.code))
            from public.kw_unit_members m
            join public.kw_units k on k.id = m.unit_id
           where m.user_id = f.uid),
         count(*) over ()
    from f
   order by f.fjoined desc, f.uid
   limit v_limit offset v_offset;
end $$;
revoke all on function public.admin_users_list(text, text, integer, integer) from public, anon;
grant execute on function public.admin_users_list(text, text, integer, integer) to authenticated;

-- 3 -- one user with linked units (unit-level only; link_code is never returned) -----
create or replace function public.admin_user_detail(p_id uuid)
returns table (
  id               uuid,
  name             text,
  email            text,
  phone            text,
  roles            text[],
  joined           timestamptz,
  last_sign_in_at  timestamptz,
  suspended        boolean,
  units            jsonb          -- [{code, name, member_role, linked_at}]
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
  select p.id, p.full_name, u.email::text, p.phone,
         (select array_agg(r.role::text order by r.role::text) from public.user_roles r where r.user_id = p.id),
         p.created_at, u.last_sign_in_at,
         (u.banned_until is not null and u.banned_until > now()),
         coalesce((select jsonb_agg(jsonb_build_object('code', k.code, 'name', k.name, 'member_role', m.role, 'linked_at', m.linked_at)
                                    order by m.linked_at)
                     from public.kw_unit_members m
                     join public.kw_units k on k.id = m.unit_id
                    where m.user_id = p.id), '[]'::jsonb)
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.id = p_id
     and not exists (select 1 from public.user_roles a where a.user_id = p.id and a.role::text = 'admin');
end $$;
revoke all on function public.admin_user_detail(uuid) from public, anon;
grant execute on function public.admin_user_detail(uuid) to authenticated;
