-- ============================================================
-- Generator use on off-grid sites
-- ============================================================
-- Run once in the Supabase SQL editor. Safe to run twice.
--
--  1. vrm.energy_daily.ac_in_minutes — minutes the AC input was live in the day. On an off-grid site only a
--     generator (or shore power) is ever connected there, so this is its running time. Ingestion works with or
--     without the column (it skips the figure until the column exists).
--  2. The new alert kind 'generator_use' ("Generator running", off-grid sites only, OFF by default until a
--     customer switches it on in alert settings).
ALTER TABLE vrm.energy_daily
  ADD COLUMN IF NOT EXISTS ac_in_minutes numeric;

COMMENT ON COLUMN vrm.energy_daily.ac_in_minutes IS
  'Approximate minutes the AC input was live (samples weighted by voltage share). On an off-grid site: the generator''s running time. NULL = day ingested before this existed.';

ALTER TABLE vrm.alerts DROP CONSTRAINT IF EXISTS alerts_kind_check;
ALTER TABLE vrm.alerts ADD CONSTRAINT alerts_kind_check
  CHECK (kind IN ('site_offline','grid_outage','low_battery','system_alarm','vrm_link_broken','device_fault','generator_use'));

ALTER TABLE vrm.alert_preferences DROP CONSTRAINT IF EXISTS alert_preferences_kind_check;
ALTER TABLE vrm.alert_preferences ADD CONSTRAINT alert_preferences_kind_check
  CHECK (kind IN ('site_offline','grid_outage','low_battery','system_alarm','vrm_link_broken','device_fault','generator_use'));
