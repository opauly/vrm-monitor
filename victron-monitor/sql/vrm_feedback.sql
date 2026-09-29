-- ────────────────────────────────────────────────────────────
-- vrm.feedback — bug reports and suggestions submitted from inside the app
-- ────────────────────────────────────────────────────────────
-- PLAN_BETA_PROGRAM.md §4.5/§11 Q10. Open to EVERY customer (not just beta
-- testers — resolved mid-planning), submitted via the in-app feedback
-- widget (lib/server/db/feedback.ts:createFeedback()). Read/triaged only
-- from /admin/feedback; the submitter never sees a status (§11 Q14 — no
-- "My feedback" page).
--
-- customer_id is ON DELETE SET NULL, not CASCADE: feedback is a record of
-- what someone told us, and should outlive a deleted customer the same way
-- an audit log would, not vanish with them.
CREATE TABLE IF NOT EXISTS vrm.feedback (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid        REFERENCES vrm.customers(id) ON DELETE SET NULL,
  auth_user_id      uuid,
  -- From the session at submission time, kept even if the customer/account
  -- is later deleted or the email changes.
  submitter_email   text        NOT NULL,
  kind              text        NOT NULL
                                  CHECK (kind IN ('bug', 'suggestion')),
  -- Bug only; NULL for suggestions is an app-level rule
  -- (submitFeedbackAction), not a DB CHECK — a DB constraint tying severity
  -- to kind would duplicate that validation for no real safety gain here.
  severity          text        CHECK (severity IS NULL OR severity IN ('low', 'medium', 'high', 'blocker')),
  title             text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body              text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  -- Pathname only — the application strips any query string before this is
  -- ever written (never trust a client-sent path to already be clean).
  page_path         text        CHECK (page_path IS NULL OR char_length(page_path) <= 500),
  -- Only ever set after sites.ts:assertOwnsSite() passes for this
  -- customer; a forged/foreign site_id is stored as NULL, never rejected
  -- outright, so a submission is never lost over an unowned site.
  site_id           text,
  ui_language       text        CHECK (ui_language IS NULL OR ui_language IN ('en', 'es')),
  -- Truncated to 200 chars by the application (signup.ts:clientMeta()'s
  -- own existing convention), not re-truncated here.
  user_agent        text,
  app_version       text,
  -- Must start with 'feedback/{customer_id}/' — server-checked in
  -- createFeedback(), not a DB CHECK (customer_id can be NULL here after a
  -- deletion, which would make a matching CHECK meaningless retroactively).
  screenshot_path   text,
  status            text        NOT NULL DEFAULT 'new'
                                  CHECK (status IN ('new', 'triaged', 'in_progress', 'resolved', 'wont_fix', 'duplicate')),
  -- Admin-owned triage priority, deliberately separate from the
  -- submitter's own `severity` — the two are allowed to disagree.
  admin_priority    text        CHECK (admin_priority IS NULL OR admin_priority IN ('p1', 'p2', 'p3')),
  admin_notes       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_vrm_feedback_status_created
  ON vrm.feedback (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vrm_feedback_customer_created
  ON vrm.feedback (customer_id, created_at DESC);

ALTER TABLE vrm.feedback ENABLE ROW LEVEL SECURITY;
GRANT ALL ON vrm.feedback TO service_role;

COMMENT ON TABLE vrm.feedback IS
  'Bug reports and suggestions submitted from inside the app (PLAN_BETA_PROGRAM.md §4.5). Open to every customer, not just beta testers (§11 Q10). Written by lib/server/db/feedback.ts:createFeedback(); triaged only from /admin/feedback (lib/server/db/admin.ts:listFeedback()/updateFeedback()) — the submitter never sees status or admin_notes (§11 Q14).';
COMMENT ON COLUMN vrm.feedback.admin_priority IS
  'Admin-set triage priority, independent of the submitter''s own severity — the two may disagree.';
