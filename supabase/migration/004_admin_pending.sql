-- =============================================================================
-- KiloWhat · 004 · Fix admin creation (replaces the app_metadata check in 002)
-- Run AFTER 003. Safe to re-run. Also replaces the DEBUG function if installed.
--
-- Why: Supabase writes app_metadata AFTER inserting the user row, so the
-- sign-up trigger could never see role = 'admin'. Instead, the service role
-- (the admin-invite Edge Function, or you for the first admin) writes the email
-- into admin_pending just before creating the account. Clients cannot touch
-- this table, and each row expires after a few minutes and is single-use.
-- =============================================================================

create table if not exists public.admin_pending (
  email       text primary key,
  created_by  uuid references auth.users (id) on delete set null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
alter table public.admin_pending enable row level security;
revoke all on public.admin_pending from anon, authenticated;   -- service role only

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
  -- Admin branch: only if the service role pre-registered this email moments ago.
  if exists (
    select 1 from public.admin_pending p
    where p.email = lower(new.email) and p.expires_at > now()
  ) then
    if char_length(v_name) < 2 or char_length(v_name) > 60 then
      raise exception 'invalid_name';
    end if;
    delete from public.admin_pending where email = lower(new.email);   -- single use
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

-- Also sweep stale pending rows during the existing every-minute cleanup.
create or replace function public.purge_expired_admin_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.admin_pending where expires_at < now();

  with gone as (
    delete from auth.users u
     using public.admin_invites i
     where i.user_id = u.id
       and i.activated_at is null
       and i.expires_at < now()
       and u.email_confirmed_at is null
    returning u.id
  )
  select count(*) into n from gone;
  return n;
end $$;

revoke all on function public.purge_expired_admin_invites() from public, anon, authenticated;
grant execute on function public.purge_expired_admin_invites() to service_role;

-- =============================================================================
-- FIRST ADMIN (bootstrap): run this in the SQL Editor, then IMMEDIATELY run the
-- PowerShell command (within 10 minutes) using the SAME email.
--
--   insert into public.admin_pending (email, expires_at)
--   values (lower('you@example.com'), now() + interval '10 minutes')
--   on conflict (email) do update set expires_at = excluded.expires_at;
-- =============================================================================