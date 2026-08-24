-- People ("who can appear in posts") are now scoped per account instead of
-- shared across all accounts. Add a nullable account_slug: NULL means a legacy
-- shared person (visible everywhere) so existing rows keep working; new uploads
-- set the account they were added under.

alter table public.avatar_references
  add column if not exists account_slug text;

create index if not exists avatar_references_account_slug_idx
  on public.avatar_references (account_slug);
