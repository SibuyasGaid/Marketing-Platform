-- Per-account outro/ending clip. A short mp4 appended to the end of an avatar
-- video (on demand, via the "Add outro" button) before it's posted. Stored in
-- the brand-assets bucket; this column holds its storage path (null = none).
-- No RLS change: accounts already has row-level policies from its own migration.
alter table accounts add column if not exists outro_video_path text;
