-- ────────────────────────────────────────────────────────────
-- Who hears about what, by property
-- ────────────────────────────────────────────────────────────
-- An account's alerts and notices go to its own email address and to every phone registered to it. A property can add:
--
--   vrm.property_recipients     extra EMAIL addresses for a property (its owner, a technician). They get every alert and
--                               notice about the sites in that property, whatever the account's own email choices are, so a
--                               fleet owner can keep email off for itself and still have a property's owner get theirs.
--   vrm.push_subscriptions.property_ids
--                               a PHONE takes either everything the account does (NULL, the default) or only the alerts of the
--                               listed properties.
--
-- Nothing changes for an account that sets neither. Safe to re-run. Service-role only: RLS on, no policies.
CREATE TABLE IF NOT EXISTS vrm.property_recipients (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id uuid        NOT NULL REFERENCES vrm.properties(id) ON DELETE CASCADE,
  customer_id uuid        NOT NULL REFERENCES vrm.customers(id) ON DELETE CASCADE,
  email       text        NOT NULL CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, email)
);

CREATE INDEX IF NOT EXISTS idx_vrm_property_recipients_property ON vrm.property_recipients (property_id);
ALTER TABLE vrm.property_recipients ENABLE ROW LEVEL SECURITY;

ALTER TABLE vrm.push_subscriptions ADD COLUMN IF NOT EXISTS property_ids uuid[];
