-- Phase 4: record where an approved item actually went live, so the queue can
-- link straight to the published post.

alter table public.content_items
  add column platform_post_url text;
