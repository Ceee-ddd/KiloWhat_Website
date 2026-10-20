-- =============================================================================
-- KiloWhat · 003 · Admin invitations (activation link, auto-cleanup)
-- Run AFTER 002_admin_foundation.sql. Safe to re-run.
--
-- Flow: an admin invites an email -> an inactive account is created -> the
-- invitee gets a one-time activation link and sets their OWN password. If it is
-- not activated before expires_at, the link stops working immediately and the
-- account + its profile/role rows are deleted by purge_expired_admin_invites().
-- =============================================================================

create table if not exists public.admin_invites (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references auth.users (id) on delete cascade,
  token_hash   text not null unique,          -- sha256 of the link token; the token itself is never stored
  created_by   uuid references auth.users (id) on delete set null,
  expires_at   timestamptz not null,
  activated_at timestamptz,
  created_at   timestamptz not null default now()
);

alter table public.admin_invites enable row level security;
revoke all on public.admin_invites from anon, authenticated;   -- service role only

-- Deletes accounts whose invitation expired without being activated.
-- Cascades to profiles, user_roles and admin_invites.
create or replace function public.purge_expired_admin_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
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

-- Run the cleanup every minute (pg_cron). If this errors, enable the extension in
-- Dashboard -> Database -> Extensions -> pg_cron, then run these two lines again.
create extension if not exists pg_cron;
select cron.schedule(
  'purge-expired-admin-invites',
  '* * * * *',
  $$ select public.purge_expired_admin_invites(); $$
);
