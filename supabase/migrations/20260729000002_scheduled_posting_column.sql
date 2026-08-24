-- Second half of scheduled posting (see 20260729000001). The `scheduled` enum
-- value was added and committed there; now it is safe to add the column and an
-- index that the dispatch cron uses to find due items.

-- Exact publish time (date + time). The existing scheduled_date (date only) is
-- kept for the generation calendar; this is the publish moment for one item.
alter table public.content_items
  add column if not exists scheduled_for timestamptz;

-- The cron scans scheduled items whose time has arrived. Index only the rows
-- with a publish time set (all scheduled items, no other rows), which keeps the
-- index small without referencing the enum value in the predicate.
create index if not exists content_items_scheduled_for_idx
  on public.content_items (scheduled_for)
  where scheduled_for is not null;
