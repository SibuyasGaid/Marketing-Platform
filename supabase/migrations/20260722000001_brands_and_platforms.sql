-- Two brands under one company, each with its own pages/channels per platform.
-- Content items and calendar entries now carry the brand; calendar entries can
-- target multiple platforms in one entry.

create type public.brand as enum ('demo_brand', 'sample_co');

alter table public.content_items
  add column brand public.brand not null default 'demo_brand';

alter table public.content_calendar
  add column brand public.brand not null default 'demo_brand',
  add column platforms jsonb not null default '[]'::jsonb;

create index content_items_brand_idx on public.content_items (brand);
