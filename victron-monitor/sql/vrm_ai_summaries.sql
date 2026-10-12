-- ────────────────────────────────────────────────────────────
-- vrm.ai_summaries — the daily summary shown at the top of a site's page and
-- of a fleet view (written by vrm_api/insights_service.py)
-- ────────────────────────────────────────────────────────────
-- One CURRENT row per (scope, site or customer, language): regenerated in
-- place (upsert), not accumulated — the facts the text was written from are
-- kept alongside it (`facts`) so what it says can always be checked.
--
--   scope 'site'   site_id set
--   scope 'fleet'  customer_id set = that customer's sites; both NULL = every
--                  site (the admin's fleet view)
--
-- `source` is 'ai' when a model wrote the text and it passed the number check
-- (every figure it states is in `facts`), else 'template' (the plain,
-- deterministic text). Service-role only: RLS on, no policies.
CREATE TABLE IF NOT EXISTS vrm.ai_summaries (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope       text        NOT NULL CHECK (scope IN ('site','fleet')),
  site_id     text,
  customer_id uuid        REFERENCES vrm.customers(id) ON DELETE CASCADE,
  lang        text        NOT NULL CHECK (lang IN ('en','es')),
  facts_date  date,
  headline    text        NOT NULL,
  points      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  suggestion  text,
  source      text        NOT NULL CHECK (source IN ('ai','template')),
  model       text,
  facts       jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vrm_ai_summaries_key
  ON vrm.ai_summaries (scope, COALESCE(site_id, ''), COALESCE(customer_id::text, ''), lang);

ALTER TABLE vrm.ai_summaries ENABLE ROW LEVEL SECURITY;
