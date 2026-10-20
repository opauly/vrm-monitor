-- ────────────────────────────────────────────────────────────
-- vrm.insight_notices — tips and heads-ups (not alerts)
-- ────────────────────────────────────────────────────────────
-- Written by the ~15-minute refresh sweep (vrm_api/insight_notices_service.py, rules in victron/insight_notices.py).
-- An alert is a problem with a start and an end; a notice is said once and is over: the day's outlook (daily_briefing),
-- a great solar day tomorrow (solar_day), a storm coming while the battery is low (storm_battery), unusually high use
-- right now (high_usage) and a high-use day yesterday (usage_day).
--
-- Every kind is OFF until the customer switches it on in their alert settings, so nothing is sent from the day this
-- runs. `dedupe_key` makes a notice once-only per customer ('briefing:2026-10-19', 'storm:2026-10-19:15:00', ...).
-- `notified_at` NULL = still owed a notification; unsent ones older than a few hours are dropped, not sent late.
--
-- Also lets alert_preferences hold the five new kinds (same table the alert settings page already uses).
-- Safe to re-run. Service-role only: RLS on, no policies, like the other server-written tables.
CREATE TABLE IF NOT EXISTS vrm.insight_notices (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id  uuid        NOT NULL REFERENCES vrm.customers(id) ON DELETE CASCADE,
  site_id      text,
  kind         text        NOT NULL
    CHECK (kind IN ('daily_briefing','solar_day','storm_battery','high_usage','usage_day')),
  dedupe_key   text        NOT NULL,
  severity     text        NOT NULL DEFAULT 'ok' CHECK (severity IN ('ok','warning')),
  detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  notified_at  timestamptz,
  UNIQUE (customer_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_vrm_insight_notices_unsent ON vrm.insight_notices (created_at) WHERE notified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vrm_insight_notices_customer_time ON vrm.insight_notices (customer_id, created_at DESC);

ALTER TABLE vrm.insight_notices ENABLE ROW LEVEL SECURITY;

ALTER TABLE vrm.alert_preferences DROP CONSTRAINT IF EXISTS alert_preferences_kind_check;
ALTER TABLE vrm.alert_preferences ADD CONSTRAINT alert_preferences_kind_check
  CHECK (kind IN ('site_offline','grid_outage','low_battery','system_alarm','vrm_link_broken','device_fault','generator_use',
                  'daily_briefing','solar_day','storm_battery','high_usage','usage_day'));
