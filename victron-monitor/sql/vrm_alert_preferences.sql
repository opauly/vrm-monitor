-- ────────────────────────────────────────────────────────────
-- vrm.alert_preferences — what each customer wants to hear about
-- ────────────────────────────────────────────────────────────
-- One row per (customer, alert kind), created the first time a customer saves
-- their alert settings (`/app/alerts`). NO row means the defaults: both
-- `enabled` and `email` true — so a customer who never opens the settings page
-- gets everything, and adding a new alert kind later needs no backfill.
--
--   enabled  false -> the alert is not raised for this customer at all (not in
--                     the app, not by email); any open one is closed silently
--   email    false -> still raised and shown in the app, but never emailed
--
-- Read by `vrm_api/alerts_service.py` / `alerts_delivery.py` and by the web
-- app (service-role only: RLS on, no policies, like the other server-side tables).
CREATE TABLE IF NOT EXISTS vrm.alert_preferences (
  customer_id  uuid        NOT NULL REFERENCES vrm.customers(id) ON DELETE CASCADE,
  kind         text        NOT NULL
    CHECK (kind IN ('site_offline','grid_outage','low_battery','system_alarm','vrm_link_broken')),
  enabled      boolean     NOT NULL DEFAULT true,
  email        boolean     NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, kind)
);

ALTER TABLE vrm.alert_preferences ENABLE ROW LEVEL SECURITY;
