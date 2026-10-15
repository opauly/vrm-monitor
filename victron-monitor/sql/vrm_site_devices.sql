-- ────────────────────────────────────────────────────────────
-- vrm.site_devices — the batteries, inverters and solar chargers behind each site
-- ────────────────────────────────────────────────────────────
-- One row per physical device, written by the ~15-minute refresh sweep
-- (vrm_api/devices_service.py, rules in victron/devices.py) from the VRM
-- diagnostics it already fetches. It is both what the site page's "Devices"
-- table shows and the small memory the checks need: `state` holds each charger's
-- daily yield history and the most modules / units ever seen.
--
--   status   ok | warn | bad      (bad opens a "device_fault" alert; warn is only shown)
--   note     {code, params} of the worst finding, null when ok
--   metrics  the figures the table shows (yield yesterday, modules online, ...)
--
-- Also lets the alert kinds include the new 'device_fault'. Safe to re-run.
-- Service-role only: RLS on, no policies, like the other server-written tables.
CREATE TABLE IF NOT EXISTS vrm.site_devices (
  site_id        text        NOT NULL,
  device_key     text        NOT NULL,                       -- 'charger:288', 'battery:512', 'inverter:274'
  kind           text        NOT NULL CHECK (kind IN ('charger','battery','inverter')),
  label          text        NOT NULL DEFAULT '',            -- model / maker
  status         text        NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','warn','bad')),
  note           jsonb,
  metrics        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  state          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  missing_sweeps integer     NOT NULL DEFAULT 0,
  first_seen     timestamptz NOT NULL DEFAULT now(),
  last_seen      timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, device_key)
);

ALTER TABLE vrm.site_devices ENABLE ROW LEVEL SECURITY;

-- The new alert kind.
ALTER TABLE vrm.alerts DROP CONSTRAINT IF EXISTS alerts_kind_check;
ALTER TABLE vrm.alerts ADD CONSTRAINT alerts_kind_check
  CHECK (kind IN ('site_offline','grid_outage','low_battery','system_alarm','vrm_link_broken','device_fault'));

ALTER TABLE vrm.alert_preferences DROP CONSTRAINT IF EXISTS alert_preferences_kind_check;
ALTER TABLE vrm.alert_preferences ADD CONSTRAINT alert_preferences_kind_check
  CHECK (kind IN ('site_offline','grid_outage','low_battery','system_alarm','vrm_link_broken','device_fault'));
