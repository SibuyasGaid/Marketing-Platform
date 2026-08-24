-- Scheduled posting: an approved item can be held until a future time instead
-- of publishing immediately. A cron sweeps due items and dispatches them through
-- the same approval gate (the approval_events row is still written at approve
-- time, so scheduling never bypasses review).
--
--   approved -> scheduled            (reviewer picked a future time)
--   scheduled -> publishing -> posted (cron, when due)
--   scheduled -> pending_approval    (schedule cancelled)
--   scheduled -> failed              (dispatch error)
--
-- Postgres forbids USING a new enum value in the same transaction that adds it
-- ("unsafe use of new value ... must be committed before use"). Supabase runs
-- each migration file in one transaction, so this file ONLY adds the value; the
-- column + index that reference it live in the next migration.

alter type public.content_status add value if not exists 'scheduled';
