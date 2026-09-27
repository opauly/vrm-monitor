-- ────────────────────────────────────────────────────────────
-- vrm.grid_events — one row per detected grid outage (CSV/API sites)
-- ────────────────────────────────────────────────────────────
-- `victron/vrm_daily.py:_grid_outages()` already detects each individual
-- outage (start, end, duration) for `vrm`-schema sites, but until now
-- `to_energy_daily_rows()` immediately collapsed that into a day's
-- `outage_count`/`outage_minutes` and the per-event detail was discarded —
-- see that function's own comments. This table is where the mapper
-- (`victron/ingest.py:ingest_parsed()`) now writes the individual events it
-- was already computing, enriched with what covered the load during each
-- one: SOC before/after/during, and which source (PV/battery) carried it.
--
-- Deliberately NOT a mirror of `monitoring.grid_events` (lost/restored
-- state-transition rows): Node-RED never captures a raw SOC/power series
-- anywhere, so it has nothing to enrich this way — those sites keep using
-- their existing `timestamp`/`duration_minutes` rows as-is. This table is
-- `vrm`-schema-only.
--
-- No unique constraint: `victron/ingest.py` re-ingest safety follows the
-- same pattern as `alarm_events`/`critical_alerts` — delete every row in the
-- touched date range, then insert fresh, rather than upsert.
CREATE TABLE IF NOT EXISTS vrm.grid_events (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id           text        NOT NULL,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz NOT NULL,
  duration_minutes  numeric     NOT NULL,
  soc_start_pct     numeric,
  soc_end_pct       numeric,
  soc_min_pct       numeric,
  -- 'pv' | 'battery' | 'mixed' | null (neither signal moved — e.g. a genset
  -- carried it, or PV/battery telemetry isn't wired on this installation).
  source            text,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vrm_grid_events_site_time
  ON vrm.grid_events USING btree (site_id, started_at DESC);
