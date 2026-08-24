-- One post → many destinations. Previously each selected platform created its
-- own content_item. Now a single item is generated/reviewed once and posted to
-- every platform in target_platforms on approval. `platform` stays as the
-- primary/first platform (drives the output shape and back-compat); NULL/empty
-- target_platforms means "just the primary platform".

alter table public.content_items
  add column if not exists target_platforms jsonb not null default '[]'::jsonb;
