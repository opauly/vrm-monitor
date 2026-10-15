-- ============================================================
-- vrm.sites.reserve_soc_pct — the minimum state of charge a site is set to keep
-- ============================================================
-- Run once in the Supabase SQL editor. Safe to run twice.
--
-- For a grid-connected battery system whose reserve is held back by something VRM cannot see —
-- a VE.Bus "Virtual Switch" assistant that hands the load to the grid below a given charge, on a
-- system running Hub-1 rather than ESS — the installer states that minimum here (Sites -> edit).
-- Leave it empty for ESS systems: their minimum is read from the system automatically.
--
-- Used by: the daily health score (a day resting at this level is not a low battery), the daily
-- AI summary, and the Equipment table's "no outage reserve" check (silenced when this is set).
-- It replaces the interim health_thresholds -> socFloorPct key; run vrm_health_ess_floor.sql again
-- afterwards so the scoring function reads this column.
ALTER TABLE vrm.sites
  ADD COLUMN IF NOT EXISTS reserve_soc_pct numeric
  CHECK (reserve_soc_pct IS NULL OR (reserve_soc_pct >= 0 AND reserve_soc_pct <= 100));

COMMENT ON COLUMN vrm.sites.reserve_soc_pct IS
  'Minimum state of charge (%) the system keeps while the grid is up, when held by something other than ESS (e.g. a VE.Bus Virtual Switch). NULL = not set; ESS systems report theirs.';
