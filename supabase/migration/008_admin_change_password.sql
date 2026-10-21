-- 008  (1) After an admin changes their own password, every OTHER session of theirs is ended.
--      (2) Admins can read the profile row of OTHER ADMINS, so the Admin activity log shows names.
--      Additive only: no existing object is changed. Safe to re-run (create or replace / drop if exists).

-- -----------------------------------------------------------------------------
-- 1. Revoke other sessions. Called only by admin-change-password (service_role).
-- -----------------------------------------------------------------------------
create or replace function public.admin_revoke_other_sessions(p_user uuid, p_keep uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.verified_sessions where user_id = p_user and session_id <> p_keep;
  delete from auth.sessions where user_id = p_user and id <> p_keep;
end $$;
revoke all on function public.admin_revoke_other_sessions(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_other_sessions(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2. Admins read other admins' profiles (names for the Admin activity log).
--    profiles_select_own is untouched, so the Flutter app is unaffected (policies are OR-ed).
--    Tenant, landlord and individual-user profiles stay unreadable by admins through this policy.
--    user_roles is RLS-limited to own rows, so a helper answers the yes/no check (returns no data).
-- -----------------------------------------------------------------------------
create or replace function public.is_admin_user(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = p_id and role = 'admin');
$$;
revoke all on function public.is_admin_user(uuid) from public, anon;
grant execute on function public.is_admin_user(uuid) to authenticated;

drop policy if exists "profiles_select_admins_by_admin" on public.profiles;
create policy "profiles_select_admins_by_admin" on public.profiles
  for select to authenticated
  using ((select public.is_admin()) and (select public.is_admin_user(id)));