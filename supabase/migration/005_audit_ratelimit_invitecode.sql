-- =============================================================================
-- KiloWhat · 005 · Audit log, rate limiting, invite code
-- Run AFTER 004. Safe to re-run. Paste into Supabase Dashboard -> SQL Editor.
--
--  1. admin_audit_log   append-only; admins can read, nobody can edit/delete
--  2. rate_limit_hits   + rate_limit_hit()  DB-backed limiter for Edge Functions
--  3. admin_invites     + code_hash / code_attempts (out-of-band invite code)
--  4. purge_expired_admin_invites() now also writes an 'invite_expired' event
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Audit log
-- -----------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_id     uuid,                       -- no FK: the row must outlive a deleted account
  actor_email  text,                       -- snapshot, same reason
  action       text not null check (char_length(action) between 2 and 64),
  target       text,                       -- e.g. the invited email or a user id
  success      boolean not null default true,
  ip           text,
  user_agent   text,
  metadata     jsonb not null default '{}'::jsonb   -- NEVER put tokens, codes or passwords here
);
create index if not exists admin_audit_log_at_idx     on public.admin_audit_log (at desc);
create index if not exists admin_audit_log_action_idx on public.admin_audit_log (action, at desc);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to authenticated;

drop policy if exists "audit_select_admin" on public.admin_audit_log;
create policy "audit_select_admin" on public.admin_audit_log
  for select to authenticated
  using ((select public.is_admin()));

-- Append-only: UPDATE and TRUNCATE always fail. DELETE only fails unless the
-- retention function below switched the flag on for its own transaction.
create or replace function public.audit_log_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('kilowhat.audit_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'audit_log_is_append_only';
end $$;

drop trigger if exists audit_log_no_update on public.admin_audit_log;
create trigger audit_log_no_update
  before update or delete on public.admin_audit_log
  for each row execute function public.audit_log_guard();

drop trigger if exists audit_log_no_truncate on public.admin_audit_log;
create trigger audit_log_no_truncate
  before truncate on public.admin_audit_log
  for each statement execute function public.audit_log_guard();

-- Writer used by the Edge Functions (service role only).
create or replace function public.log_admin_event(
  p_actor_id    uuid,
  p_actor_email text,
  p_action      text,
  p_target      text    default null,
  p_success     boolean default true,
  p_ip          text    default null,
  p_user_agent  text    default null,
  p_metadata    jsonb   default '{}'::jsonb
)
returns void language sql security definer set search_path = '' as $$
  insert into public.admin_audit_log (actor_id, actor_email, action, target, success, ip, user_agent, metadata)
  values (p_actor_id, left(p_actor_email, 254), left(p_action, 64), left(p_target, 254),
          coalesce(p_success, true), left(p_ip, 64), left(p_user_agent, 300), coalesce(p_metadata, '{}'::jsonb));
$$;
revoke all on function public.log_admin_event(uuid, text, text, text, boolean, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_admin_event(uuid, text, text, text, boolean, text, text, jsonb) to service_role;

-- Writer used by the website itself: an admin may log ONLY these two events about themselves.
create or replace function public.log_session_event(p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null or not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_action not in ('login', 'logout') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  select email into v_email from auth.users where id = v_uid;
  insert into public.admin_audit_log (actor_id, actor_email, action, target)
  values (v_uid, v_email, p_action, v_email);
end $$;
revoke all on function public.log_session_event(text) from public, anon;
grant execute on function public.log_session_event(text) to authenticated;

-- Retention (matches Settings -> "Keep log entries for"; default 12 months). Runs daily.
create or replace function public.purge_old_audit_log(p_days integer default 365)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform set_config('kilowhat.audit_purge', 'on', true);   -- this transaction only
  with d as (delete from public.admin_audit_log where at < now() - make_interval(days => greatest(p_days, 30)) returning 1)
  select count(*) into n from d;
  return n;
end $$;
revoke all on function public.purge_old_audit_log(integer) from public, anon, authenticated;
grant execute on function public.purge_old_audit_log(integer) to service_role;

select cron.schedule('purge-old-audit-log', '0 3 * * *', $$ select public.purge_old_audit_log(365); $$);

-- -----------------------------------------------------------------------------
-- 2. Rate limiting (Edge Functions are stateless, so the counters live here)
--    rate_limit_hit('invite:<adminId>', 5, 3600) -> true = allowed, false = blocked
-- -----------------------------------------------------------------------------
create table if not exists public.rate_limit_hits (
  key text        not null,
  at  timestamptz not null default now()
);
create index if not exists rate_limit_hits_key_at_idx on public.rate_limit_hits (key, at desc);
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;       -- service role only

create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_key is null or char_length(p_key) > 200 then return false; end if;
  perform pg_advisory_xact_lock(hashtext(p_key));        -- parallel requests can't slip past the limit
  delete from public.rate_limit_hits
   where key = p_key and at < now() - make_interval(secs => p_window_seconds);
  select count(*) into n from public.rate_limit_hits where key = p_key;
  if n >= p_limit then return false; end if;
  insert into public.rate_limit_hits (key) values (p_key);
  return true;
end $$;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

select cron.schedule('purge-rate-limit-hits', '17 * * * *',
  $$ delete from public.rate_limit_hits where at < now() - interval '1 day'; $$);

-- -----------------------------------------------------------------------------
-- 3. Invite code (the second factor that is NOT in the email)
--    Only a hash is stored. 5 wrong tries burn the invite (enforced in admin-activate).
-- -----------------------------------------------------------------------------
alter table public.admin_invites add column if not exists code_hash     text;
alter table public.admin_invites add column if not exists code_attempts integer not null default 0;

-- -----------------------------------------------------------------------------
-- 4. Expiry cleanup now leaves a trace in the audit log
-- -----------------------------------------------------------------------------
create or replace function public.purge_expired_admin_invites()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.admin_pending where expires_at < now();

  with gone as (
    delete from auth.users u
     using public.admin_invites i
     where i.user_id = u.id
       and i.activated_at is null
       and i.expires_at < now()
       and u.email_confirmed_at is null
    returning u.id, u.email
  ), logged as (
    insert into public.admin_audit_log (action, target, success)
    select 'invite_expired', email, true from gone
    returning 1
  )
  select count(*) into n from gone;
  return n;
end $$;
revoke all on function public.purge_expired_admin_invites() from public, anon, authenticated;
grant execute on function public.purge_expired_admin_invites() to service_role;

-- =============================================================================
-- VERIFY (run each; expected result in the comment)
--   select count(*) from public.admin_audit_log;                         -- 0 (or more)
--   select public.rate_limit_hit('test', 2, 60);                         -- true  (run as postgres)
--   select public.rate_limit_hit('test', 2, 60);                         -- true
--   select public.rate_limit_hit('test', 2, 60);                         -- false
--   delete from public.rate_limit_hits where key = 'test';
--   insert into public.admin_audit_log (action) values ('self_test');
--   update public.admin_audit_log set action = 'x' where action = 'self_test'; -- ERROR audit_log_is_append_only
--   delete from public.admin_audit_log where action = 'self_test';             -- ERROR audit_log_is_append_only
--   select jobname from cron.job where jobname like 'purge-%';           -- 3 purge-* jobs
-- Note: 'self_test' row stays in the log by design (that is the point of append-only).
-- =============================================================================
