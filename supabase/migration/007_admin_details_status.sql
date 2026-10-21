-- =============================================================================
-- 007  Administrators: details, enable/disable, edit own name
--   1. admin_list()            replaced: adds Disabled status, last sign-in, trusted-device count
--   2. admin_set_disabled()    service_role only (called by the admin-set-status Edge Function)
--   3. admin_update_own_name() an admin can change ONLY their own full name
--   No existing table, RLS policy, or app-facing function is changed.
-- =============================================================================

-- 1 ---------------------------------------------------------------------------
drop function if exists public.admin_list();
create function public.admin_list()
returns table (
  id               uuid,
  name             text,
  email            text,
  status           text,          -- Active | Pending | Disabled
  added            timestamptz,
  expires_at       timestamptz,   -- only for Pending
  invited_by       text,
  last_sign_in_at  timestamptz,
  devices          integer        -- trusted browsers/devices not revoked
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
  select p.id,
         p.full_name,
         u.email::text,
         case when i.id is not null and i.activated_at is null then 'Pending'
              when u.banned_until is not null and u.banned_until > now() then 'Disabled'
              else 'Active' end,
         p.created_at,
         case when i.activated_at is null then i.expires_at end,
         (select b.email::text from auth.users b where b.id = i.created_by),
         u.last_sign_in_at,
         (select count(*)::int from public.trusted_devices d where d.user_id = p.id and d.revoked_at is null)
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
  join auth.users u      on u.id = r.user_id
  left join public.admin_invites i on i.user_id = r.user_id
  where r.role = 'admin'
  order by p.created_at;
end $$;
revoke all on function public.admin_list() from public, anon;
grant execute on function public.admin_list() to authenticated;

-- 2 ---------------------------------------------------------------------------
-- Disabling: blocks sign-in, kills every session, un-verifies it, revokes trusted devices.
-- Enabling: only lifts the block (the person must pass the new-device email check again).
create or replace function public.admin_set_disabled(p_actor uuid, p_target uuid, p_disable boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_banned  timestamptz;
  v_pending boolean;
  v_others  integer;
begin
  perform pg_advisory_xact_lock(hashtext('kilowhat_admin_status'));   -- serialises concurrent changes

  if p_actor = p_target then raise exception 'self_not_allowed'; end if;
  if not exists (select 1 from public.user_roles where user_id = p_target and role = 'admin') then
    raise exception 'target_not_admin';
  end if;
  select exists (select 1 from public.admin_invites where user_id = p_target and activated_at is null) into v_pending;
  if v_pending then raise exception 'pending'; end if;
  select banned_until into v_banned from auth.users where id = p_target;

  if p_disable then
    if v_banned is not null and v_banned > now() then raise exception 'already_disabled'; end if;

    select count(*) into v_others
    from public.user_roles r
    join auth.users u on u.id = r.user_id
    where r.role = 'admin' and r.user_id <> p_target
      and (u.banned_until is null or u.banned_until <= now())
      and not exists (select 1 from public.admin_invites i where i.user_id = r.user_id and i.activated_at is null);
    if v_others < 1 then raise exception 'last_admin'; end if;

    update auth.users set banned_until = now() + interval '100 years' where id = p_target;
    delete from public.verified_sessions where user_id = p_target;
    update public.trusted_devices set revoked_at = now() where user_id = p_target and revoked_at is null;
    delete from auth.sessions where user_id = p_target;
    return 'Disabled';
  else
    if v_banned is null or v_banned <= now() then raise exception 'already_enabled'; end if;
    update auth.users set banned_until = null where id = p_target;
    return 'Active';
  end if;
end $$;
revoke all on function public.admin_set_disabled(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_disabled(uuid, uuid, boolean) to service_role;

-- 3 ---------------------------------------------------------------------------
create or replace function public.admin_update_own_name(p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_name  text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_old   text;
  v_email text;
begin
  if not public.is_admin() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  select full_name into v_old from public.profiles where id = auth.uid();
  if v_old = v_name then return v_name; end if;

  update public.profiles set full_name = v_name where id = auth.uid();
  select email into v_email from auth.users where id = auth.uid();
  insert into public.admin_audit_log (actor_id, actor_email, action, target, metadata)
  values (auth.uid(), v_email, 'profile_updated', v_email, jsonb_build_object('field', 'name', 'from', v_old, 'to', v_name));
  return v_name;
end $$;
revoke all on function public.admin_update_own_name(text) from public, anon;
grant execute on function public.admin_update_own_name(text) to authenticated;
