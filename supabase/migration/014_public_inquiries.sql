-- =============================================================================
-- KiloWhat · 014 · Public website inquiries
-- Run AFTER 005 (uses is_admin). Safe to re-run.
-- Paste into Supabase Dashboard -> SQL Editor.
--
-- Written only by the submit-inquiry Edge Function (service role).
-- Admins can read inquiries and change their status. Nobody else has access.
-- =============================================================================

create table if not exists public.public_inquiries (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  full_name    text not null check (char_length(full_name) between 2 and 100),
  email        text not null check (char_length(email) between 3 and 255),
  inquiry_type text not null check (inquiry_type in (
                 'General Inquiry', 'Product Information', 'Property / Landlord Inquiry',
                 'Technical Question', 'Collaboration / Research', 'Other')),
  subject      text not null check (char_length(subject) between 3 and 120),
  message      text not null check (char_length(message) between 10 and 2000),
  status       text not null default 'new' check (status in ('new', 'contacted', 'archived')),
  notified_at  timestamptz,   -- team email sent
  ack_sent_at  timestamptz    -- confirmation email sent to the visitor
);
create index if not exists public_inquiries_created_idx on public.public_inquiries (created_at desc);
create index if not exists public_inquiries_status_idx  on public.public_inquiries (status, created_at desc);

alter table public.public_inquiries enable row level security;
revoke all on public.public_inquiries from anon, authenticated;
grant select on public.public_inquiries to authenticated;
grant update (status) on public.public_inquiries to authenticated;

drop policy if exists "inquiries_select_admin" on public.public_inquiries;
create policy "inquiries_select_admin" on public.public_inquiries
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "inquiries_update_status_admin" on public.public_inquiries;
create policy "inquiries_update_status_admin" on public.public_inquiries
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
