-- vrm.insight_notices.text — what each notice said, so the app can show it
-- Stored by the sweep when it creates a notice: {"en": {"title", "body"}, "es": {...}}, the same wording the push and the email
-- use. The "Insights" tab on the alerts page reads it. Older rows have none (the tab then shows the kind and the site).
-- Safe to re-run.
ALTER TABLE vrm.insight_notices ADD COLUMN IF NOT EXISTS text jsonb;
