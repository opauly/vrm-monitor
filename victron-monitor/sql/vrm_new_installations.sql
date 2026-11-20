-- ────────────────────────────────────────────────────────────
-- vrm.new_installations — systems found in a VRM account that are not monitored here yet
-- ────────────────────────────────────────────────────────────
-- Written by vrm_api/site_discovery.py about once an hour. It reads the installation list of the admin's own VRM
-- account (customer_id NULL) and of every customer who connected theirs, and keeps one row for each installation
-- created in the last 14 days that has no site yet. The row carries what VRM already says about the equipment
-- (`prefill`: inverter, battery, solar, system type, reserve), which fills the new-site wizard.
--
-- status: 'new' (waiting), 'added' (a site now exists for it — through the wizard or any other way),
-- 'dismissed' (the person said it is not one to monitor). Rows are never re-created once closed.
-- Service-role only: RLS on, no policies. Safe to re-run.
CREATE TABLE IF NOT EXISTS vrm.new_installations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         uuid        REFERENCES vrm.customers(id) ON DELETE CASCADE,
  vrm_installation_id bigint      NOT NULL,
  name                text,
  vrm_created_at      timestamptz,
  prefill             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status              text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'added', 'dismissed')),
  site_id             text,
  found_at            timestamptz NOT NULL DEFAULT now(),
  notified_at         timestamptz,
  closed_at           timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vrm_new_installations_account
  ON vrm.new_installations (COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), vrm_installation_id);

CREATE INDEX IF NOT EXISTS idx_vrm_new_installations_open
  ON vrm.new_installations (status) WHERE status = 'new';

ALTER TABLE vrm.new_installations ENABLE ROW LEVEL SECURITY;
