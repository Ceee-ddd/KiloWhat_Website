-- =============================================================================
-- KiloWhat · 001 · Auth foundation
-- Roles, profiles, trusted devices, verified sessions, device OTP storage.
-- Run once in: Supabase Dashboard -> SQL Editor  (or `supabase db push`).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. Roles (add new roles later with: alter type public.app_role add value 'x')
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'landlord', 'tenant', 'individual');

-- -----------------------------------------------------------------------------
-- 2. Profiles (1 row per auth user) and user_roles (a user may hold many roles)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text        not null check (char_length(full_name) between 2 and 60),
  phone       text        not null check (phone ~ '^\+639[0-9]{9}$'),
  birthdate   date        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.user_roles (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.app_role not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, role)
);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Device security tables (no direct client access except where noted)
-- -----------------------------------------------------------------------------
create table public.trusted_devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  device_hash   text not null,               -- sha256 of the app's device id
  device_name   text,
  platform      text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  unique (user_id, device_hash)
);

-- A login session (auth.sessions.id) that has passed the device check.
create table public.verified_sessions (
  session_id  uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  device_id   uuid references public.trusted_devices (id) on delete set null,
  verified_at timestamptz not null default now()
);

-- Pending new-device codes. Only the Edge Function (service role) touches this.
create table public.device_otps (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  session_id  uuid not null,
  code_hash   text not null,
  attempts    int  not null default 0,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index device_otps_user_created_idx on public.device_otps (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 4. Sign-up trigger: validates metadata server-side, then creates profile+role.
--    The app can NEVER create an 'admin' (whitelist below). Anything invalid
--    aborts the sign-up.
--    NOTE (Google login later): OAuth users have no such metadata, so add a
--    branch here for non-email providers before enabling Google sign-in.
-- -----------------------------------------------------------------------------
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Session verification helpers
-- -----------------------------------------------------------------------------
create or replace function public.is_session_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.verified_sessions vs
    where vs.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and vs.user_id = auth.uid()
  );
$$;

-- Called by the app after every login / app start. Idempotent.
--   * session already verified            -> 'verified'
--   * known (trusted, not revoked) device -> mark session verified
--   * user's very first device            -> trust it automatically
--   * anything else                       -> 'otp_required'
create or replace function public.register_session(
  p_device_id   text,
  p_device_name text default null,
  p_platform    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_sid    uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_hash   text;
  v_device public.trusted_devices;
  v_has_any boolean;
begin
  if v_uid is null or v_sid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_device_id is null or char_length(p_device_id) < 32 or char_length(p_device_id) > 128 then
    raise exception 'invalid_device' using errcode = '22023';
  end if;

  -- Housekeeping: drop verification rows for sessions that no longer exist.
  delete from public.verified_sessions vs
  where vs.user_id = v_uid
    and not exists (select 1 from auth.sessions s where s.id = vs.session_id);

  if exists (
    select 1 from public.verified_sessions
    where session_id = v_sid and user_id = v_uid
  ) then
    return jsonb_build_object('status', 'verified');
  end if;

  v_hash := encode(extensions.digest(p_device_id, 'sha256'), 'hex');

  select * into v_device
  from public.trusted_devices
  where user_id = v_uid and device_hash = v_hash and revoked_at is null;

  if not found then
    select exists (select 1 from public.trusted_devices where user_id = v_uid)
      into v_has_any;

    if v_has_any then
      return jsonb_build_object('status', 'otp_required');
    end if;

    insert into public.trusted_devices (user_id, device_hash, device_name, platform)
    values (v_uid, v_hash, left(p_device_name, 80), left(p_platform, 20))
    returning * into v_device;
  else
    update public.trusted_devices
       set last_seen_at = now(),
           device_name  = coalesce(left(p_device_name, 80), device_name)
     where id = v_device.id;
  end if;

  insert into public.verified_sessions (session_id, user_id, device_id)
  values (v_sid, v_uid, v_device.id)
  on conflict (session_id) do nothing;

  return jsonb_build_object('status', 'verified');
end $$;

revoke all on function public.is_session_verified() from public, anon;
revoke all on function public.register_session(text, text, text) from public, anon;
grant execute on function public.is_session_verified() to authenticated;
grant execute on function public.register_session(text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Row Level Security
--    Rule for every future table: require (select public.is_session_verified())
--    so an un-verified session (password OK, device OTP pending) sees nothing.
-- -----------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.user_roles        enable row level security;
alter table public.trusted_devices   enable row level security;
alter table public.verified_sessions enable row level security;
alter table public.device_otps       enable row level security;

revoke all on public.profiles, public.user_roles, public.trusted_devices from anon;
revoke all on public.verified_sessions, public.device_otps from anon, authenticated;

-- Users may only change name/phone themselves (birthdate and roles are locked).
revoke insert, delete, truncate on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
grant  update (full_name, phone) on public.profiles to authenticated;
revoke insert, update, delete, truncate on public.user_roles from authenticated;
revoke insert, update, delete, truncate on public.trusted_devices from authenticated;

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id and (select public.is_session_verified()));

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id and (select public.is_session_verified()))
  with check ((select auth.uid()) = id);

create policy "user_roles_select_own" on public.user_roles
  for select to authenticated
  using ((select auth.uid()) = user_id and (select public.is_session_verified()));

create policy "trusted_devices_select_own" on public.trusted_devices
  for select to authenticated
  using ((select auth.uid()) = user_id and (select public.is_session_verified()));

-- verified_sessions and device_otps: RLS on, no policies => service role only.
