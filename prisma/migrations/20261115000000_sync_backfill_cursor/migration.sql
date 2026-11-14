-- Keyset backfill: resume point (ISO fileCreatedAt of the last asset seen) and
-- when the backfill started (the incremental cursor starts 5 minutes before it).
ALTER TABLE "sync_state" ADD COLUMN "backfill_cursor" TEXT,
ADD COLUMN "backfill_started_at" TIMESTAMP(3);
