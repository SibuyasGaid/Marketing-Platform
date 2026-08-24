-- Reusable brand reference images for image generation (logos, product shots,
-- style/mood boards). Distinct from avatar_references, which are real people's
-- likenesses and admin-only; brand references are not likenesses, so
-- admin/editor may manage them.

create table public.brand_references (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  storage_path text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brand_references enable row level security;

create policy "brand_references: members read" on public.brand_references
  for select using (auth.uid() is not null);
create policy "brand_references: admin/editor insert" on public.brand_references
  for insert with check (public.current_user_role() in ('admin', 'editor'));
create policy "brand_references: admin/editor update" on public.brand_references
  for update using (public.current_user_role() in ('admin', 'editor'));
create policy "brand_references: admin delete" on public.brand_references
  for delete using (public.current_user_role() = 'admin');

create trigger brand_references_updated_at before update on public.brand_references
  for each row execute function public.set_updated_at();
