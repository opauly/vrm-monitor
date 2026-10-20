-- ────────────────────────────────────────────────────────────
-- vrm.sites.is_shared — an installation another account already has
-- ────────────────────────────────────────────────────────────
-- Victron has no single "owner" of an installation: everyone it is shared with (the owner, an installer, a technician) sees it
-- as theirs, so the API cannot say which account "really" owns it. What we can know is which account registered it HERE first.
-- Any later site, under a different customer, for the same Victron installation is a shared one: it is marked `is_shared`, shown
-- with a "Shared" badge, and kept out of that customer's main fleet view and roll-ups (it stays listed under Sites).
--
-- The backfill below marks existing duplicates: for each installation, every row that is not the earliest one under a different
-- customer. Safe to re-run.
ALTER TABLE vrm.sites ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;

UPDATE vrm.sites s
SET is_shared = true
WHERE s.vrm_installation_id IS NOT NULL
  AND NOT s.is_shared
  AND EXISTS (
    SELECT 1 FROM vrm.sites o
    WHERE o.vrm_installation_id = s.vrm_installation_id
      AND o.customer_id <> s.customer_id
      AND (o.created_at, o.id) < (s.created_at, s.id)
  );
