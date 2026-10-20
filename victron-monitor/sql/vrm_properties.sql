-- ────────────────────────────────────────────────────────────
-- vrm.properties — group a customer's sites into properties
-- ────────────────────────────────────────────────────────────
-- A customer can have several properties (an address, a farm, a building), each with several sites. A site belongs to ONE
-- property or to none (`vrm.sites.property_id`); deleting a property just un-groups its sites.
--
-- Used by the fleet views (`/admin/fleet`, `/app/dashboard`) to show one property at a time, by the AI summary for that view and by
-- PDF reports generated for a whole property. A customer with no properties sees nothing different.
--
-- Safe to re-run. Service-role only: RLS on, no policies, like the other server-written tables.
CREATE TABLE IF NOT EXISTS vrm.properties (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid        NOT NULL REFERENCES vrm.customers(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, name)
);

ALTER TABLE vrm.sites ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES vrm.properties(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vrm_sites_property ON vrm.sites (property_id) WHERE property_id IS NOT NULL;

ALTER TABLE vrm.properties ENABLE ROW LEVEL SECURITY;
