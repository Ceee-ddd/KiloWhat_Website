-- =============================================================================
-- 006  admin_list(): the Settings -> Administrators table
--   Read-only. Adds one new function; no table, policy or app-facing object is changed.
--   Only a verified-session admin may call it (is_admin()).
--   Returns every admin account with name, email, Active/Pending status and who invited it.
-- =============================================================================
create or replace function public.admin_list()
returns table (
  id          uuid,
  name        text,
  email       text,
  status      text,
  added       timestamptz,
  expires_at  timestamptz,   -- only for Pending
  invited_by  text
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
         case when i.id is not null and i.activated_at is null then 'Pending' else 'Active' end,
         p.created_at,
         case when i.activated_at is null then i.expires_at end,
         (select b.email::text from auth.users b where b.id = i.created_by)
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
  join auth.users u      on u.id = r.user_id
  left join public.admin_invites i on i.user_id = r.user_id
  where r.role = 'admin'
  order by p.created_at;
end $$;

revoke all on function public.admin_list() from public, anon;
grant execute on function public.admin_list() to authenticated;
