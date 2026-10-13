-- ────────────────────────────────────────────────────────────
-- vrm.site_forecasts — the cached "tonight / tomorrow" forecast, one row per site
-- ────────────────────────────────────────────────────────────
-- Written by vrm_api/forecast_service.py. `result` is what the site page shows
-- (rebuilt at most hourly); `load_profile` is the site's usual usage by hour of
-- day (24 values, W), read from VRM about once a day and kept so a page view
-- never has to wait on VRM. Service-role only: RLS on, no policies.
CREATE TABLE IF NOT EXISTS vrm.site_forecasts (
  site_id      text        PRIMARY KEY,
  generated_at timestamptz NOT NULL DEFAULT now(),
  load_profile jsonb,
  result       jsonb       NOT NULL
);

ALTER TABLE vrm.site_forecasts ENABLE ROW LEVEL SECURITY;
