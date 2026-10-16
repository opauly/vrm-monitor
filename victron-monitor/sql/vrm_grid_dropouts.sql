-- ============================================================
-- vrm.energy_daily.grid_dropout_minutes — brief grid interruptions
-- ============================================================
-- Run once in the Supabase SQL editor. Safe to run twice.
--
-- VRM's 15-minute averages turn a ~90-second grid dropout into "53.96 Hz / 108 V" for that bucket, which made the
-- day's grid quality look Poor while the outage count read zero. The ingestion now leaves those buckets out of
-- the frequency and voltage ranges and records here, roughly, how many minutes the grid was gone inside them.
-- Ingestion works with or without this column (it skips the figure until the column exists).
ALTER TABLE vrm.energy_daily
  ADD COLUMN IF NOT EXISTS grid_dropout_minutes numeric;

COMMENT ON COLUMN vrm.energy_daily.grid_dropout_minutes IS
  'Approximate minutes the grid was absent inside 15-min buckets too short to count as an outage (average frequency < 95% of nominal). NULL = day ingested before this existed.';
