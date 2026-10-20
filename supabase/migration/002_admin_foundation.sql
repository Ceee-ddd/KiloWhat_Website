-- =============================================================================
-- KiloWhat · 002 · Admin foundation (replaces the earlier allowlist version)
-- Run AFTER 001_auth_foundation.sql. Safe to re-run.
--
-- Security model
--   * Nobody can become admin through sign-up. The sign-up trigger only grants
--     'admin' when auth.users.raw_APP_meta_data.role = 'admin'. app_metadata can
--     be written ONLY with the service_role key (never by a client signUp, which
--     can only set user_metadata).
--   * Admins are created by (a) the bootstrap command below, run by the project
--     owner with the service_role key, or (b) the `admin-invite` Edge Function,
--     which only an existing admin can call.
--   * is_admin() also requires a verified login session (same rule as all RLS).
-- =============================================================================

-- If you ran the earlier allowlist version, remove it.
drop table if exists public.admin_allowlist;

-- Admins have no phone / birthdate (the mobile sign-up form collects those).
-- CHECK constraints still apply to any non-null value.
alter table public.profiles alter column phone     drop not null;
alter table public.profiles alter column birthdate drop not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name  text  := btrim(regexp_replace(coalesce(v_meta ->> 'full_name', ''), '\s+', ' ', 'g'));
  v_phone text  := coalesce(v_meta ->> 'phone', '');
  v_birth date;
  v_role  public.app_role;
begin
  -- Admin branch. Trusts ONLY app_metadata (service role), never user_metadata.
  if coalesce(new.raw_app_meta_data ->> 'role', '') = 'admin' then
    if char_length(v_name) < 2 or char_length(v_name) > 60 then
      raise exception 'invalid_name';
    end if;
    insert into public.profiles (id, full_name) values (new.id, v_name);
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
    return new;
  end if;

  begin
    v_birth := (v_meta ->> 'birthdate')::date;
  exception when others then
    raise exception 'invalid_birthdate';
  end;

  if v_birth is null
     or v_birth > (current_date - interval '18 years')::date
     or v_birth < (current_date - interval '150 years')::date then
    raise exception 'invalid_birthdate';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'invalid_name';
  end if;

  if v_phone !~ '^\+639[0-9]{9}$' then
    raise exception 'invalid_phone';
  end if;

  begin
    v_role := (v_meta ->> 'role')::public.app_role;
  exception when others then
    raise exception 'invalid_role';
  end;

  if v_role not in ('landlord', 'tenant', 'individual') then
    raise exception 'invalid_role';
  end if;

  insert into public.profiles (id, full_name, phone, birthdate)
  values (new.id, v_name, v_phone, v_birth);

  insert into public.user_roles (user_id, role)
  values (new.id, v_role);

  return new;
end $$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Used by the web's RLS policies. Admin AND verified session.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_session_verified()
     and exists (
       select 1 from public.user_roles
       where user_id = auth.uid() and role = 'admin'
     );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- =============================================================================
-- BOOTSTRAP THE FIRST ADMIN (run on YOUR computer, not in the app or the repo)
--
-- The service_role key is Dashboard -> Project Settings -> API. Never commit
-- it, never put it in the web or the Flutter app. Rotate it if it leaks.
--
--   curl -X POST "https://<PROJECT_REF>.supabase.co/auth/v1/admin/users" \
--     -H "apikey: <SERVICE_ROLE_KEY>" \
--     -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
--     -H "Content-Type: application/json" \
--     -d '{
--       "email": "you@example.com",
--       "password": "<LONG-RANDOM-PASSWORD>",
--       "email_confirm": true,
--       "user_metadata": { "full_name": "Your Name" },
--       "app_metadata":  { "role": "admin" }
--     }'
--
-- Verify:
--   select u.email, p.full_name, r.role
--     from auth.users u
--     join public.profiles p   on p.id = u.id
--     join public.user_roles r on r.user_id = u.id
--    where r.role = 'admin';
--
-- To promote an account that ALREADY exists (SQL editor only):
--   insert into public.user_roles (user_id, role)
--   select id, 'admin' from auth.users where email = 'you@example.com'
--   on conflict do nothing;
-- =============================================================================