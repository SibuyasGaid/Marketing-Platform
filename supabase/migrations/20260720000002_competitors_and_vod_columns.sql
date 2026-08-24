-- Phase 3: competitor watchlist (managed in-app) + VOD file metadata.

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website_url text,
  social_handles jsonb not null default '[]'::jsonb,
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.competitors enable row level security;

create policy "competitors: members read" on public.competitors
  for select using (auth.uid() is not null);
-- Writes go through server actions (service role) with role checks.

create trigger competitors_updated_at before update on public.competitors
  for each row execute function public.set_updated_at();

-- VOD file metadata needed for streaming uploads to the transcription API.
alter table public.source_videos
  add column mime_type text,
  add column size_bytes bigint;
