-- ────────────────────────────────────────────────────────────
-- vrm.alerts — fleet alerts: one row per episode (open -> resolved)
-- ────────────────────────────────────────────────────────────
-- Written by the ~15-minute `vrm-fleet/refresh-snapshots` sweep
-- (`vrm_api/alerts_service.py`, rules in `victron/alerts.py`). A row is opened
-- when a condition first holds, kept up to date while it holds, and resolved
-- when it clears — the table is both the current state ("what is open right
-- now") and the history (resolved rows stay).
--
-- Five kinds (first notification set): site_offline, grid_outage,
-- low_battery, system_alarm, vrm_link_broken. `site_id` is NULL for the one
-- customer-level kind (vrm_link_broken: the token belongs to the customer,
-- not to a site).
--
-- At most ONE open alert per (customer, site, kind): the partial unique index
-- below, so two overlapping sweeps can't open the same episode twice.
--
-- `notified_at` / `resolved_notified_at` are what the (later) email step reads
-- to know what still has to be sent, and `read_at` is for the (later) in-app
-- list — they exist now so delivery can be added without another migration.
--
-- Service-role only: RLS on, no policies, like the other server-written tables.
CREATE TABLE IF NOT EXISTS vrm.alerts (
  id                    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id           uuid        NOT NULL REFERENCES vrm.customers(id) ON DELETE CASCADE,
  site_id               text,
  kind                  text        NOT NULL
    CHECK (kind IN ('site_offline','grid_outage','low_battery','system_alarm','vrm_link_broken')),
  severity              text        NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('warning','critical')),
  status                text        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','resolved')),
  opened_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at           timestamptz,
  detail                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  notified_at           timestamptz,
  resolved_notified_at  timestamptz,
  read_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vrm_alerts_one_open
  ON vrm.alerts (customer_id, COALESCE(site_id, ''), kind)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_vrm_alerts_customer_time
  ON vrm.alerts (customer_id, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_vrm_alerts_open
  ON vrm.alerts (status) WHERE status = 'open';

ALTER TABLE vrm.alerts ENABLE ROW LEVEL SECURITY;
