-- ────────────────────────────────────────────────────────────
-- vrm.site_alarm_patterns — warnings that keep coming back
-- ────────────────────────────────────────────────────────────
-- Written by the ~15-minute refresh sweep (vrm_api/alarm_log_service.py, rules in victron/alarm_log.py)
-- from Victron's own alarm log. One row per kind of alarm that has repeated lately on a site, for example
-- "charger terminal overheated, 3 times in 14 days". They are shown quietly on the site page and in reports;
-- they never open an alert and never change a health score. A row is removed when the kind stops repeating.
--
--   category  overload | temperature | high_current | low_battery | battery_voltage | bms | grid_input |
--             vebus_error | internal_failure | charger_error
--   count     episodes inside window_days (alarms a few minutes apart count as one)
--   device    the device Victron names in the log, when it names one
--   detail    Victron's own wording for the state, when it says more than "Alarm"
--
-- Safe to re-run. Service-role only: RLS on, no policies, like the other server-written tables.
CREATE TABLE IF NOT EXISTS vrm.site_alarm_patterns (
  site_id     text        NOT NULL,
  category    text        NOT NULL,
  count       integer     NOT NULL,
  window_days integer     NOT NULL,
  first_at    timestamptz NOT NULL,
  last_at     timestamptz NOT NULL,
  active      boolean     NOT NULL DEFAULT false,
  device      text        NOT NULL DEFAULT '',
  detail      text        NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, category)
);

ALTER TABLE vrm.site_alarm_patterns ENABLE ROW LEVEL SECURITY;
