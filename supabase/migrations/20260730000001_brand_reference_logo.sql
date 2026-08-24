-- Let an account designate one reference image as its LOGO. A logo is always
-- included in that account's generations (never dropped by the reference cap)
-- and the prompt tells the model to place it unaltered. Nullable/false default
-- so existing rows are unaffected and pre-migration code still works.

alter table public.brand_references
  add column if not exists is_logo boolean not null default false;

-- Fast lookup of "the logo for this account".
create index if not exists brand_references_logo_idx
  on public.brand_references (account_slug)
  where is_logo = true;
