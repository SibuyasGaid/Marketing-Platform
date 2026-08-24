-- Initial schema for AI Marketing & Content Operations Platform.
-- Every table gets RLS enabled in this same migration (docs/SECURITY.md §2).
-- Default posture: deny. Client (anon key) access is read-mostly; all state
-- machine writes happen server-side with the service role.

-- ============================================================ enums

create type public.user_role as enum ('admin', 'editor', 'reviewer');
create type public.platform as enum ('instagram', 'facebook', 'linkedin', 'youtube');
create type public.content_type as enum ('image_post', 'clip', 'heygen_video', 'copy_set');
create type public.content_status as enum (
  'draft', 'pending_approval', 'approved', 'publishing', 'posted',
  'edits_requested', 'regenerating', 'failed'
);
create type public.approval_action as enum ('approved', 'edits_requested');
create type public.transcript_status as enum ('pending', 'processing', 'completed', 'failed');
create type public.job_status as enum ('queued', 'running', 'completed', 'failed');

-- ============================================================ helpers

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================ profiles

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role public.user_role not null default 'editor',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Role lookup for policies. SECURITY DEFINER so it can read profiles without
-- recursing through profiles' own RLS. Defined after profiles because SQL
-- function bodies are validated against existing relations at creation time.
create or replace function public.current_user_role()
returns public.user_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

create policy "profiles: read own" on public.profiles
  for select using (id = auth.uid());
create policy "profiles: admins read all" on public.profiles
  for select using (public.current_user_role() = 'admin');
-- Users may update their own display name but never their own role.
create policy "profiles: update own (role immutable)" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select p.role from public.profiles p where p.id = auth.uid()));

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================ brand_presets

create table public.brand_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tone text not null,
  palette jsonb not null default '[]'::jsonb,
  style_rules text not null default '',
  campaign_context text,
  -- Per-platform variants: dimensions, tone overrides, visual treatment.
  -- LinkedIn is a distinct style from IG/FB by spec.
  platform_variants jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brand_presets enable row level security;

create policy "brand_presets: members read" on public.brand_presets
  for select using (auth.uid() is not null);
create policy "brand_presets: admin/editor insert" on public.brand_presets
  for insert with check (public.current_user_role() in ('admin', 'editor'));
create policy "brand_presets: admin/editor update" on public.brand_presets
  for update using (public.current_user_role() in ('admin', 'editor'));
create policy "brand_presets: admin delete" on public.brand_presets
  for delete using (public.current_user_role() = 'admin');

create trigger brand_presets_updated_at before update on public.brand_presets
  for each row execute function public.set_updated_at();

-- ============================================================ avatar_references
-- Real people's likenesses (the people in your reference library): read for members, writes admin-only.

create table public.avatar_references (
  id uuid primary key default gen_random_uuid(),
  person_name text not null,
  storage_path text not null,
  -- Provider-side asset id (e.g. HeyGen) so references are uploaded once, never per generation.
  provider_asset_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.avatar_references enable row level security;

create policy "avatar_references: members read" on public.avatar_references
  for select using (auth.uid() is not null);
create policy "avatar_references: admin insert" on public.avatar_references
  for insert with check (public.current_user_role() = 'admin');
create policy "avatar_references: admin update" on public.avatar_references
  for update using (public.current_user_role() = 'admin');
create policy "avatar_references: admin delete" on public.avatar_references
  for delete using (public.current_user_role() = 'admin');

create trigger avatar_references_updated_at before update on public.avatar_references
  for each row execute function public.set_updated_at();

-- ============================================================ source_videos

create table public.source_videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  storage_path text,
  source_url text,
  duration_seconds integer,
  transcript_status public.transcript_status not null default 'pending',
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_videos_has_source check (storage_path is not null or source_url is not null)
);

alter table public.source_videos enable row level security;

create policy "source_videos: members read" on public.source_videos
  for select using (auth.uid() is not null);
-- Writes are server-side only (service role) so ingestion state can't be forged.

create trigger source_videos_updated_at before update on public.source_videos
  for each row execute function public.set_updated_at();

-- ============================================================ transcripts
-- Persisted permanently; a video is transcribed exactly once (docs/API_OPTIMIZATION.md §2).

create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  source_video_id uuid not null references public.source_videos (id) on delete cascade,
  full_text text not null,
  -- Segment map: [{ start_s, end_s, text }] plus analysis results keyed by version.
  segment_map jsonb not null default '[]'::jsonb,
  analysis jsonb,
  analysis_version integer not null default 0,
  created_at timestamptz not null default now(),
  unique (source_video_id)
);

alter table public.transcripts enable row level security;

create policy "transcripts: members read" on public.transcripts
  for select using (auth.uid() is not null);
-- Writes are server-side only.

-- ============================================================ content_items
-- Central table. Status writes go through the server-side state machine only.

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  type public.content_type not null,
  platform public.platform not null,
  status public.content_status not null default 'draft',
  title text,
  caption text,
  -- Everything needed to (re)generate: prompt, preset id, segment refs, edit notes.
  generation_inputs jsonb not null default '{}'::jsonb,
  -- Storage paths / provider refs for produced assets.
  output_assets jsonb not null default '[]'::jsonb,
  edit_comment text,
  scheduled_date date,
  source_video_id uuid references public.source_videos (id) on delete set null,
  brand_preset_id uuid references public.brand_presets (id) on delete set null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index content_items_scheduled_date_idx on public.content_items (scheduled_date);
create index content_items_status_idx on public.content_items (status);

alter table public.content_items enable row level security;

create policy "content_items: members read" on public.content_items
  for select using (auth.uid() is not null);
-- No client-side insert/update/delete: the state machine cannot be bypassed
-- via direct PostgREST calls (docs/SECURITY.md §2, §4).

create trigger content_items_updated_at before update on public.content_items
  for each row execute function public.set_updated_at();

-- ============================================================ content_calendar

create table public.content_calendar (
  id uuid primary key default gen_random_uuid(),
  calendar_date date not null,
  platform public.platform,
  prompt text,
  brand_preset_id uuid references public.brand_presets (id) on delete set null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_calendar_has_input check (prompt is not null or brand_preset_id is not null)
);

create index content_calendar_date_idx on public.content_calendar (calendar_date);

alter table public.content_calendar enable row level security;

create policy "content_calendar: members read" on public.content_calendar
  for select using (auth.uid() is not null);
-- Calendar entry writes go through server actions (validated + audited).

create trigger content_calendar_updated_at before update on public.content_calendar
  for each row execute function public.set_updated_at();

-- ============================================================ approval_events
-- Append-only audit log: no update or delete policies exist, ever (docs/SECURITY.md §4).

create table public.approval_events (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id),
  action public.approval_action not null,
  comment text,
  created_at timestamptz not null default now()
);

create index approval_events_item_idx on public.approval_events (content_item_id);

alter table public.approval_events enable row level security;

create policy "approval_events: members read" on public.approval_events
  for select using (auth.uid() is not null);
-- Inserts are server-side only, in the same transaction as the status change.

-- ============================================================ competitor_reports

create table public.competitor_reports (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  content_html text not null,
  delivery_status text not null default 'pending',
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.competitor_reports enable row level security;

create policy "competitor_reports: members read" on public.competitor_reports
  for select using (auth.uid() is not null);

-- ============================================================ ai_usage_log
-- Cost observability (docs/API_OPTIMIZATION.md §7). Admin-read, server-written.

create table public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  task_type text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(10, 6) not null default 0,
  content_item_id uuid references public.content_items (id) on delete set null,
  job_ref text,
  created_at timestamptz not null default now()
);

create index ai_usage_log_created_idx on public.ai_usage_log (created_at);

alter table public.ai_usage_log enable row level security;

create policy "ai_usage_log: admin read" on public.ai_usage_log
  for select using (public.current_user_role() = 'admin');

-- ============================================================ jobs
-- Inngest job mirror for UI status display. Admin-read, server-written.

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  inngest_run_id text,
  job_name text not null,
  status public.job_status not null default 'queued',
  content_item_id uuid references public.content_items (id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jobs enable row level security;

create policy "jobs: admin read" on public.jobs
  for select using (public.current_user_role() = 'admin');

create trigger jobs_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- ============================================================ storage buckets
-- All private. The UI gets short-lived signed URLs generated server-side;
-- uploads happen server-side. No permissive storage.objects policies —
-- deny by default (docs/SECURITY.md §2).

insert into storage.buckets (id, name, public)
values
  ('brand-assets', 'brand-assets', false),
  ('avatar-references', 'avatar-references', false),
  ('source-videos', 'source-videos', false),
  ('generated-media', 'generated-media', false)
on conflict (id) do nothing;
