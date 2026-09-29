-- ────────────────────────────────────────────────────────────
-- vrm.app_settings — small admin-editable key/value settings
-- ────────────────────────────────────────────────────────────
-- PLAN_BETA_PROGRAM.md §4.6/§11 Q11. First and so far only use: the
-- feedback-notification address must be editable from /admin/feedback, not
-- fixed to an env var. Key/value rather than a dedicated column so the
-- NEXT setting doesn't need its own migration — this is deliberately
-- generic, not a beta-program-specific table.
CREATE TABLE IF NOT EXISTS vrm.app_settings (
  key              text        PRIMARY KEY,
  value            text        NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by_email text
);

ALTER TABLE vrm.app_settings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON vrm.app_settings TO service_role;

COMMENT ON TABLE vrm.app_settings IS
  'Small admin-editable key/value settings (PLAN_BETA_PROGRAM.md §4.6). Read via lib/server/db/admin.ts:getAppSetting()/vrm_api equivalent where needed; written only from an admin action (requireAdmin()-gated). A missing key is not an error — every reader falls back to a hardcoded or env-var default (e.g. notifyFeedback() falls back to process.env.FEEDBACK_NOTIFY_EMAIL, then a literal address) so an empty table never breaks anything.';

INSERT INTO vrm.app_settings (key, value)
VALUES ('feedback_notify_email', 'info@paulyco.com')
ON CONFLICT (key) DO NOTHING;
