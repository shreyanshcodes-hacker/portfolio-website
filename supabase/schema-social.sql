-- ============================================================
-- Social sharing add-on. Run once in Supabase SQL Editor
-- (after the main schema). Safe to re-run.
-- ============================================================

-- OAuth tokens: RLS on, NO policies => only Edge Functions (service role) can read them.
create table if not exists public.social_accounts (
  platform text primary key check (platform in ('linkedin','x')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  account_id text,
  account_name text,
  updated_at timestamptz not null default now()
);
alter table public.social_accounts enable row level security;

create table if not exists public.social_oauth_state (
  state text primary key,
  platform text not null,
  code_verifier text,
  created_at timestamptz not null default now()
);
alter table public.social_oauth_state enable row level security;

-- Non-secret connection info the admin dashboard may read.
create table if not exists public.social_status (
  platform text primary key check (platform in ('linkedin','x')),
  connected boolean not null default false,
  account_name text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.social_status enable row level security;
drop policy if exists "social_status: admin read" on public.social_status;
create policy "social_status: admin read" on public.social_status for select to authenticated using (public.is_admin());

-- Audit log of every publish attempt.
create table if not exists public.social_shares (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('project','post')),
  source_id uuid not null,
  platform text not null check (platform in ('linkedin','x')),
  text text not null,
  image_url text,
  status text not null check (status in ('posted','failed')),
  external_id text,
  external_url text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists social_shares_src_idx on public.social_shares (source_type, source_id, platform);
alter table public.social_shares enable row level security;
drop policy if exists "social_shares: admin read" on public.social_shares;
create policy "social_shares: admin read" on public.social_shares for select to authenticated using (public.is_admin());

-- Storage bucket for the generated share images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-images', 'social-images', true, 5242880, array['image/png','image/jpeg'])
on conflict (id) do nothing;
drop policy if exists "social-images: admin upload" on storage.objects;
create policy "social-images: admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'social-images' and public.is_admin());
drop policy if exists "social-images: public read" on storage.objects;
create policy "social-images: public read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'social-images');
