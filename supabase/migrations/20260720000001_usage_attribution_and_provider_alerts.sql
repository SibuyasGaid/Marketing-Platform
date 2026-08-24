-- Cost transparency + Postgres-based caps (replaces the planned Upstash Redis).
-- 1. ai_usage_log gains user attribution so per-user daily caps are a COUNT query.
-- 2. provider_alerts records vendors that are out of credits; surfaced app-wide
--    until an admin resolves the alert.

alter table public.ai_usage_log
  add column created_by uuid references public.profiles (id) on delete set null;

create index ai_usage_log_created_by_idx on public.ai_usage_log (created_by, created_at);

-- ============================================================ provider_alerts

create table public.provider_alerts (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  kind text not null default 'credits_exhausted',
  message text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- At most one active alert per provider.
create unique index provider_alerts_one_active_per_provider
  on public.provider_alerts (provider)
  where is_active;

alter table public.provider_alerts enable row level security;

-- Everyone signed in should see that a vendor is down — that is the point.
create policy "provider_alerts: members read" on public.provider_alerts
  for select using (auth.uid() is not null);
-- Writes are server-side only (raised by services, resolved by admin actions).
