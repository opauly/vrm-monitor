-- ────────────────────────────────────────────────────────────
-- vrm.push_subscriptions — phones/browsers that opted in to push alerts
-- ────────────────────────────────────────────────────────────
-- One row per device (the browser's push `endpoint` is unique per device and
-- app install). Written by the web app when someone taps "Turn on
-- notifications" on /app/alerts (a customer's own device) or on /admin/fleet
-- (the admin's device, for the internal fleet); read and pruned by the Python
-- sender (`vrm_api/alerts_push.py`).
--
-- Exactly one owner: `customer_id` (that customer's alerts reach the device) OR
-- `admin_email` (the device receives alerts for the accounts listed in
-- ALERTS_FORCE_CUSTOMER_IDS — the admin-owned fleet, whose "customer" has no
-- login of its own to subscribe from).
--
-- `p256dh` / `auth` are the device's public encryption key and auth secret
-- from PushSubscription.toJSON(): they let the server encrypt a message only
-- that device can read; they are not a login or a password. Treated as
-- secrets-adjacent anyway: service-role only (RLS on, no policies).
--
-- A subscription that the push service reports as gone (HTTP 404/410 — app
-- uninstalled, permission revoked) is deleted by the sender on the spot.
CREATE TABLE IF NOT EXISTS vrm.push_subscriptions (
  id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id      uuid        REFERENCES vrm.customers(id) ON DELETE CASCADE,
  admin_email      text,
  endpoint         text        NOT NULL UNIQUE,
  p256dh           text        NOT NULL,
  auth             text        NOT NULL,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_success_at  timestamptz,
  last_failure_at  timestamptz,
  failure_count    integer     NOT NULL DEFAULT 0,
  CONSTRAINT push_subscriptions_one_owner CHECK ((customer_id IS NOT NULL) <> (admin_email IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_vrm_push_customer ON vrm.push_subscriptions (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vrm_push_admin ON vrm.push_subscriptions (admin_email) WHERE admin_email IS NOT NULL;

ALTER TABLE vrm.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Per-alert-type push preference (next to the existing `enabled` / `email`).
-- Default true: a device only receives pushes after someone explicitly opted
-- in on it, so the opt-in is the real gate; this column just lets them mute
-- one alert type without turning notifications off entirely.
ALTER TABLE vrm.alert_preferences ADD COLUMN IF NOT EXISTS push boolean NOT NULL DEFAULT true;
