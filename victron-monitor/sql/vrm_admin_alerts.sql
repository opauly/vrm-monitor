-- ────────────────────────────────────────────────────────────
-- vrm.admin_alerts — "is the monitor itself working?" alerts for the admin
-- ────────────────────────────────────────────────────────────
-- Written by vrm_api/admin_alerts.py (rules: victron/admin_alerts.py): many
-- sites silent at once, the sweep failing to read VRM, the 15-minute sweep or
-- the daily history sync no longer running. Same lifecycle as vrm.alerts — one
-- row per episode, opened then resolved — but about the system, not a
-- customer's site, so there is no customer_id / site_id.
--
-- At most ONE open alert per kind (partial unique index), so two overlapping
-- runs can't open the same episode twice.
--
-- Service-role only: RLS on, no policies, like the other server-written tables.
CREATE TABLE IF NOT EXISTS vrm.admin_alerts (
  id                    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind                  text        NOT NULL
    CHECK (kind IN ('fleet_offline','fetch_failing','sweep_stale','history_stale')),
  severity              text        NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('warning','critical')),
  status                text        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','resolved')),
  opened_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at           timestamptz,
  detail                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  notified_at           timestamptz,
  resolved_notified_at  timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vrm_admin_alerts_one_open
  ON vrm.admin_alerts (kind)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_vrm_admin_alerts_time
  ON vrm.admin_alerts (opened_at DESC);

ALTER TABLE vrm.admin_alerts ENABLE ROW LEVEL SECURITY;
