-- Editable accounts (brand profiles). The two hardcoded brands become rows the
-- team can edit (description = prompt context, visual_identity = the look) and
-- attach reference photos to, and new accounts can be added. content brand
-- fields become free-text slugs that reference accounts.slug (converted from the
-- fixed brand enum, non-destructive: existing values are preserved).

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text not null default '',
  visual_identity text not null default '',
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.accounts enable row level security;

create policy "accounts: members read" on public.accounts
  for select using (auth.uid() is not null);
create policy "accounts: admin/editor insert" on public.accounts
  for insert with check (public.current_user_role() in ('admin', 'editor'));
create policy "accounts: admin/editor update" on public.accounts
  for update using (public.current_user_role() in ('admin', 'editor'));
create policy "accounts: admin delete" on public.accounts
  for delete using (public.current_user_role() = 'admin');

create trigger accounts_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();

-- Seed two sample accounts. Slugs match the brand enum values above so existing
-- content_items keep pointing at the right account. These are placeholders that
-- show what a filled-in account looks like; edit or delete them on /accounts and
-- add your own.
insert into public.accounts (slug, name, description, visual_identity) values
  (
    'demo_brand',
    'Demo Brand',
    'Demo Brand is a sample account showing how an account profile steers generation. Voice: confident, practical, premium, and encouraging. Themes: practical how-tos, customer results, behind the scenes.',
    'Deep ocean-blue backgrounds (base #0B2A4A) with a soft aqua gradient glow. Bright aqua #2EC4B6 for accent shapes and highlight blocks. Coral #FF6B57 for highlighted keywords, large numbers, and small callouts. White headlines with a few key words in coral or inside a solid aqua or coral highlight box. Heavy Archivo Black-style headlines, Inter-style body. Portrait 4:5. Recurring motifs: large decorative quotation marks for testimonials, people cutouts with aqua rim lighting, big coral stat numbers, soft wave textures, pill badges. Fresh, modern, high energy.'
  ),
  (
    'sample_co',
    'Sample Co',
    'Sample Co is a second sample account with a deliberately different look, so the per-account prompt injection is easy to see side by side. Voice: clean, direct, data-driven; quiet confidence, outcomes over hype.',
    'Flat bone-white backgrounds (approximately #F4F1EC) with generous negative space. Near-black ink (approximately #161616) for type. Signal orange (approximately #FF5A1F) as the only accent, for big numbers, uppercase section labels, a few keywords, and CTA buttons. Huge condensed headlines with select words colored orange. Small uppercase orange labels, structured data rows, numbered steps. Portrait 4:5, minimal, editorial.'
  )
on conflict (slug) do nothing;

-- Content brand fields become free-text slugs referencing accounts.slug.
alter table public.content_items alter column brand drop default;
alter table public.content_items alter column brand type text using brand::text;
alter table public.content_calendar alter column brand drop default;
alter table public.content_calendar alter column brand type text using brand::text;

-- Reference images can scope to an account (null = shared across all accounts).
alter table public.brand_references add column if not exists account_slug text;
