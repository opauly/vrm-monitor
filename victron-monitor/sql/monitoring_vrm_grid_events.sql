-- ────────────────────────────────────────────────────────────
-- monitoring.sites — link the 3 real-Victron sites to their VRM installation
-- ────────────────────────────────────────────────────────────
-- Of the 16 `monitoring`-schema sites (Pauly & Co's own Node-RED-managed
-- portfolio), only the 3 Vista Atenas properties are genuine Victron
-- hardware with a VRM Portal installation behind them — confirmed with
-- Oscar directly, 2026-09-27. The other 13 are non-Victron gear monitored
-- some other way and have no VRM installation to link at all, so this
-- column stays NULL for them by design, not as a gap to fill later.
ALTER TABLE monitoring.sites
  ADD COLUMN IF NOT EXISTS vrm_installation_id bigint;

UPDATE monitoring.sites SET vrm_installation_id = 844477 WHERE site_id = 'vista-atenas-lp-m1';
UPDATE monitoring.sites SET vrm_installation_id = 844480 WHERE site_id = 'vista-atenas-lp-m2';
UPDATE monitoring.sites SET vrm_installation_id = 844478 WHERE site_id = 'vista-atenas-lp-m3';

-- ────────────────────────────────────────────────────────────
-- monitoring.grid_events — add the same per-event detail vrm.grid_events has
-- ────────────────────────────────────────────────────────────
-- Node-RED's own GRID_LOST_STARTED/GRID_RESTORED flow logic (victron-
-- monitor/node-red/victron_monitor_v1p8.json) is correct, but keeps its
-- state in Node-RED's `flow` context — exactly the state a real grid outage
-- can itself wipe, if it power-cycles the gateway before the flow gets to
-- write the closing event. Caught live, 2026-09-27: vista-atenas-lp-m3 had a
-- real, independently-confirmed 135-minute outage on 2026-09-23 that
-- `monitoring.grid_events` never recorded — only a stray INITIAL_STATE boot
-- marker with a null duration, timestamped the same day.
--
-- `vrm_api`'s new `POST /v1/monitoring-sync/grid-events` (2026-09-27) closes
-- this specific gap for the 3 linked sites by re-deriving outages from VRM's
-- own cloud telemetry instead — the same `victron/vrm_series.py` mapper the
-- `vrm`-schema CSV/API path already uses, which has no dependency on the
-- local gateway's own volatile state. These new columns are additive:
-- Node-RED's existing `event`/`previous_state`/`new_state`/`timestamp`/
-- `duration_minutes` columns are untouched and keep working exactly as
-- before for every site (including the 13 with no VRM link, where this sync
-- never runs at all). `started_at` is what tells the two kinds of rows
-- apart when reading this table back (see database/vrm_report_db.py:
-- get_outage_events()) — non-null only on a row this sync itself wrote.
ALTER TABLE monitoring.grid_events
  ADD COLUMN IF NOT EXISTS started_at    timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at      timestamptz,
  ADD COLUMN IF NOT EXISTS soc_start_pct numeric,
  ADD COLUMN IF NOT EXISTS soc_end_pct   numeric,
  ADD COLUMN IF NOT EXISTS soc_min_pct   numeric,
  ADD COLUMN IF NOT EXISTS source        text;

CREATE INDEX IF NOT EXISTS idx_monitoring_grid_events_site_started
  ON monitoring.grid_events USING btree (site_id, started_at DESC);
