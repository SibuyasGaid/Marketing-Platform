-- OAuth connections for direct social publishing (Meta first, then LinkedIn /
-- YouTube). One row per account + platform. Access tokens live here and are
-- never exposed to the browser: RLS is on with NO client policies, so only the
-- service-role server code can read or write. Tokens may additionally be
-- encrypted at rest by the app (SOCIAL_TOKEN_ENC_KEY).

create table public.social_connections (
  id uuid primary key default gen_random_uuid(),
  account_slug text not null,
  platform text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  -- Primary target id for publishing (e.g. Facebook page_id). Per-platform
  -- extras (ig_user_id, page token owner, etc.) go in `meta`.
  external_id text,
  external_name text,
  meta jsonb not null default '{}'::jsonb,
  connected_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_slug, platform)
);

alter table public.social_connections enable row level security;
-- Intentionally NO policies: only the service role (server) can touch this table.

create trigger social_connections_updated_at before update on public.social_connections
  for each row execute function public.set_updated_at();
