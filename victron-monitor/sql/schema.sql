-- ============================================================
-- Victron Monitor — monitoring schema (reference copy)
-- ============================================================
-- Source of truth: database/migrations/004_add_monitoring_schema.sql
-- (repo root, one level up from this file). This copy exists for
-- portability — e.g. spinning up monitoring in a fresh Supabase
-- project for another business line — and should be kept in sync
-- with the migration manually if the schema changes.
--
-- As of 2026-07-13, Victron Monitor shares ONE Supabase project
-- with the Pauly&Co Solar Design Tool. These tables live in the
-- `monitoring` schema (NOT `public`) so they stay isolated from
-- the solar tool's proposal/project tables. New sites do NOT need
-- a new Supabase project — insert a new row into monitoring.sites.
--
-- No RLS is used (matches the solar tool's existing pattern).
-- Access is controlled via schema-level GRANTs to anon/authenticated/
-- service_role — see the bottom of this file. The Data API must
-- also have `monitoring` added under Settings -> API -> Exposed schemas,
-- and every REST request must carry a Content-Profile (writes) or
-- Accept-Profile (reads) header set to `monitoring` — PostgREST
-- ignores schema-qualified paths and requires this header instead.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS monitoring;

-- ────────────────────────────────────────────────────────────
-- 1. SITES — one row per monitored installation
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitoring.sites (
  id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id             text        NOT NULL UNIQUE,
  display_name        text        NOT NULL,
  owner               text,
  location            text,
  country             text        DEFAULT 'CR'::text,
  latitude            numeric,
  longitude           numeric,
  pv_kwp              numeric,
  battery_usable_kwh  numeric,
  timezone            text,
  commissioned_at     date,
  active              boolean     DEFAULT true,
  created_at          timestamptz DEFAULT now(),
  report_language     text        DEFAULT 'en'::text,
  -- Per-site config fetched by Node-RED at startup (migration 006).
  -- Lets a new site be onboarded by inserting a row instead of editing
  -- the flow's Project Config JavaScript.
  utc_offset_hours    int         NOT NULL DEFAULT -6,
  app_script_url      text,
  health_thresholds   jsonb       NOT NULL DEFAULT '{
      "socLowAlarm": 20, "socLowWarning": 30, "socLowWatch": 40,
      "outageMinLong": 120, "outageMinMid": 30, "outageCountHigh": 5,
      "gridDepHigh": 50, "gridDepMid": 20,
      "batteryCyclesHigh": 1.5, "batteryCyclesMid": 1.0
  }'::jsonb,
  -- 'grid_zero' | 'off_grid' | 'hybrid' — same vocabulary as
  -- public.proposals.system_type (migration 009). Drives which report
  -- cards apply (grid-dependent vs battery-dependent insights).
  system_type         text        NOT NULL DEFAULT 'hybrid'
                                    CHECK (system_type IN ('grid_zero', 'off_grid', 'hybrid'))
);

-- ────────────────────────────────────────────────────────────
-- 2. ENERGY DAILY — one row per site per day
-- dump_type: AUTO (23:55 cron) | MANUAL | TEST
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitoring.energy_daily (
  id                      bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id                 text        NOT NULL,
  date                    date        NOT NULL,
  dump_type               text        NOT NULL DEFAULT 'AUTO'::text,
  pv_kwh                  numeric,
  grid_kwh                numeric,
  load_kwh                numeric,
  battery_charge_kwh      numeric,
  battery_discharge_kwh   numeric,
  min_soc                 numeric,
  max_soc                 numeric,
  avg_soc                 numeric,
  outage_count            integer,
  outage_minutes          numeric,
  pv_kwp_snapshot         numeric,
  battery_kwh_snapshot    numeric,
  created_at              timestamptz DEFAULT now(),
  min_voltage             numeric,
  max_voltage             numeric,
  min_temperature         numeric,
  max_temperature         numeric,
  avg_temperature         numeric,
  pv_yield_kwh_mppt       numeric,
  min_grid_freq           numeric,
  max_grid_freq           numeric,
  min_grid_v_l1           numeric,
  max_grid_v_l1           numeric,
  min_grid_v_l2           numeric,
  max_grid_v_l2           numeric,
  pv_yield_kwh_sc0        numeric,
  pv_yield_kwh_sc1        numeric,
  grid_data_available     boolean     DEFAULT true,
  battery_reached_float   boolean     DEFAULT false
);

-- ────────────────────────────────────────────────────────────
-- 3. DAILY HEALTH — computed health score per site per day
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitoring.daily_health (
  id                    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id               text        NOT NULL,
  date                  date        NOT NULL,
  dump_type             text        NOT NULL DEFAULT 'AUTO'::text,
  health_score          integer,
  health_status         text,
  alarms_count          integer,
  min_soc               numeric,
  outage_count          integer,
  outage_minutes        numeric,
  grid_dependency_pct   numeric,
  battery_cycles        numeric,
  notes                 text,
  created_at            timestamptz DEFAULT now(),
  CONSTRAINT daily_health_site_date_type_unique UNIQUE (site_id, date, dump_type)
);

-- ────────────────────────────────────────────────────────────
-- 4. AC INPUT EVENTS — AC input source transitions
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitoring.ac_input_events (
  id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id             text        NOT NULL,
  event               text,
  source              text,
  previous_state      text,
  new_state           text,
  "timestamp"         timestamptz,
  duration_minutes    numeric,
  created_at          timestamptz DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 5. ALARM EVENTS — alarm state changes
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitoring.alarm_events (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id       text        NOT NULL,
  alarm         text,
  severity      text,
  source        text,
  "timestamp"   timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 6. GRID EVENTS — grid lost / restored transitions
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitoring.grid_events (
  id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id             text        NOT NULL,
  event               text,
  previous_state      text,
  new_state           text,
  "timestamp"         timestamptz,
  duration_minutes    numeric,
  created_at          timestamptz DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 7. MPPT SNAPSHOTS — 15-min per-tracker MPPT JSONB snapshots
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitoring.mppt_snapshots (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id       text        NOT NULL,
  "timestamp"   timestamptz NOT NULL,
  data          jsonb       NOT NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monitoring_mppt_snapshots_site_time
  ON monitoring.mppt_snapshots USING btree (site_id, "timestamp" DESC);

-- ────────────────────────────────────────────────────────────
-- 8. FLOW LOGS — persistent Node-RED diagnostic log
-- Events: HTTP_RESPONSE, ACCUMULATOR_RESET | Level: info | warn | error
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitoring.flow_logs (
  id          bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  site_id     text        NOT NULL,
  ts          timestamptz NOT NULL DEFAULT now(),
  event       text        NOT NULL,
  level       text        NOT NULL DEFAULT 'info'::text,
  data        jsonb
);

CREATE INDEX IF NOT EXISTS idx_monitoring_flow_logs_site_ts
  ON monitoring.flow_logs USING btree (site_id, ts DESC);

-- ────────────────────────────────────────────────────────────
-- VIEW — fleet_summary (sites + energy_daily + daily_health joined)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW monitoring.fleet_summary AS
SELECT
  s.site_id, s.display_name, s.owner, s.location, s.country,
  s.pv_kwp, s.battery_usable_kwh,
  ed.date, ed.dump_type, ed.pv_kwh, ed.grid_kwh, ed.load_kwh,
  ed.battery_charge_kwh, ed.battery_discharge_kwh,
  ed.min_soc, ed.max_soc, ed.avg_soc,
  ed.outage_count, ed.outage_minutes,
  ed.min_voltage, ed.max_voltage,
  ed.min_temperature, ed.max_temperature, ed.avg_temperature,
  ed.pv_yield_kwh_sc0, ed.pv_yield_kwh_sc1, ed.pv_yield_kwh_mppt,
  ed.battery_reached_float,
  ed.min_grid_freq, ed.max_grid_freq,
  ed.min_grid_v_l1, ed.max_grid_v_l1, ed.min_grid_v_l2, ed.max_grid_v_l2,
  ed.grid_data_available,
  round(ed.grid_kwh / NULLIF(ed.load_kwh, 0::numeric) * 100::numeric, 1) AS grid_dependency_pct,
  round(ed.battery_discharge_kwh / NULLIF(s.battery_usable_kwh, 0::numeric), 3) AS battery_cycles,
  dh.health_score, dh.health_status, dh.alarms_count, dh.notes
FROM monitoring.energy_daily ed
JOIN monitoring.sites s ON s.site_id = ed.site_id
LEFT JOIN monitoring.daily_health dh
  ON dh.site_id = ed.site_id AND dh.date = ed.date AND dh.dump_type = ed.dump_type
WHERE s.active = true
ORDER BY ed.date DESC, s.display_name;

-- ────────────────────────────────────────────────────────────
-- DAILY HEALTH — auto-compute (added 2026-07-14, per-site thresholds
-- added 2026-07-16 via migration 006)
-- Ports Google Apps Script's calculateHealthScore() / appendDailyHealth() /
-- countAlarmEpisodesForDate() into Postgres. Full source of truth:
-- ../../database/migrations/005_add_daily_health_compute.sql and
-- ../../database/migrations/006_per_site_config.sql (repo root).
-- This block is a reference copy — keep in sync manually.
--
-- Thresholds are read per-site from monitoring.sites.health_thresholds,
-- merged over the defaults below (jsonb `||`, right side wins) — a site
-- with no overrides falls back to these defaults entirely.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION monitoring.count_alarm_episodes(p_site_id text, p_date date)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  episodes integer := 0;
  in_episode boolean := false;
BEGIN
  FOR rec IN
    SELECT severity
    FROM monitoring.alarm_events
    WHERE site_id = p_site_id
      AND ("timestamp" AT TIME ZONE 'America/Costa_Rica')::date = p_date
    ORDER BY "timestamp" ASC
  LOOP
    IF (rec.severity = 'WARNING' OR rec.severity = 'ALARM') AND NOT in_episode THEN
      episodes := episodes + 1;
      in_episode := true;
    ELSIF rec.severity = 'CLEARED' THEN
      in_episode := false;
    END IF;
  END LOOP;

  RETURN episodes;
END;
$$;

-- `monitoring.compute_daily_health()` used to be embedded here, but this
-- copy had drifted badly stale from the live function even before
-- 2026-09-18's split (missing v_est_cycles, the SOC-swing fallback, and
-- running battery-cycle thresholds of 1.5/1.0 against a live default of
-- 10.0/7.0 — found while adding the System/Grid split, not something
-- that split caused). Its own source-of-truth comment claimed a
-- migration file this split repo never actually inherited, so "kept
-- manually in sync" had silently stopped happening at some earlier,
-- unknown point. Now documented in its own dedicated, actually-current
-- file instead — see `monitoring_compute_daily_health.sql`, pulled live
-- via `pg_get_functiondef()` immediately before the split, same
-- discipline `vrm_compute_daily_health.sql` already follows for the
-- `vrm` schema's version. Kept as CREATE OR REPLACE there too, so
-- re-running it is always safe.

CREATE OR REPLACE FUNCTION monitoring.trg_energy_daily_health()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM monitoring.compute_daily_health(NEW.site_id, NEW.date, NEW.dump_type);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS energy_daily_health_trigger ON monitoring.energy_daily;
CREATE TRIGGER energy_daily_health_trigger
  AFTER INSERT OR UPDATE ON monitoring.energy_daily
  FOR EACH ROW
  EXECUTE FUNCTION monitoring.trg_energy_daily_health();

-- ────────────────────────────────────────────────────────────
-- GRANTS — required because `monitoring` is not the default
-- `public` schema; Supabase does not auto-grant new schemas.
-- ────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA monitoring TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA monitoring TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA monitoring TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA monitoring GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA monitoring GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION monitoring.count_alarm_episodes(text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION monitoring.compute_daily_health(text, date, text) TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA monitoring GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- Also required once, via Supabase Dashboard (not SQL):
-- Settings -> API -> Data API -> Exposed schemas -> check "monitoring" -> Save

-- ────────────────────────────────────────────────────────────
-- SEED: insert your first site
-- ────────────────────────────────────────────────────────────
-- INSERT INTO monitoring.sites (site_id, display_name, owner, location, country,
--   latitude, longitude, pv_kwp, battery_usable_kwh, timezone, commissioned_at, report_language)
-- VALUES ('your-site-id', 'Your Site Display Name', 'Owner Name', 'Location', 'CR',
--   9.969576, -84.405197, 19.36, 41.04, 'America/Costa_Rica', '2025-10-04', 'en');
