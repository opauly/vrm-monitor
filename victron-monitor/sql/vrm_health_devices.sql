-- ============================================================
-- VRM Monitor — equipment faults bring the System health score down
-- ============================================================
-- Run once in the Supabase SQL editor, AFTER vrm_site_devices.sql and
-- vrm_health_breakdown.sql. Safe to run twice.
--
-- A site whose equipment (battery module, inverter unit, solar charger) was
-- flagged "bad" in vrm.site_devices for a good part of a day has a problem, and
-- that day's SYSTEM score (and the blended health score) drops:
--
--     1 device  -15 points      2 devices  -25      3 or more  -35 (the cap)
--
-- "A good part of a day" = bad in at least 4 of the ~15-minute sweeps (about an
-- hour), so a one-sweep VRM glitch costs nothing. The sweep keeps the per-day
-- counts in vrm.site_devices.state.bad_sweeps. The deduction is listed in the
-- score breakdown as {code: 'device_fault', points: -N, value: <devices>}.
--
-- How, without touching the 400-line scoring function: the existing
-- vrm.compute_daily_health() is renamed to compute_daily_health_core() (once),
-- and a thin function with the original name and signature calls it and then
-- applies the deduction to the row it just wrote. Every caller (the daily sync,
-- recomputes) keeps working unchanged. Days scored before the equipment checks
-- existed have no counts, so they are not changed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'vrm' AND p.proname = 'compute_daily_health_core') THEN
    ALTER FUNCTION vrm.compute_daily_health(text, date, text) RENAME TO compute_daily_health_core;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION vrm.compute_daily_health(p_site_id text, p_date date, p_dump_type text DEFAULT 'csv_upload'::text)
 RETURNS vrm.daily_health
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_row vrm.daily_health;
  v_devices integer := 0;
  v_points integer;
  v_note text;
BEGIN
  v_row := vrm.compute_daily_health_core(p_site_id, p_date, p_dump_type);
  IF v_row.site_id IS NULL THEN
    RETURN v_row;                       -- no energy data for that day: nothing was scored
  END IF;

  IF to_regclass('vrm.site_devices') IS NOT NULL THEN
    SELECT count(*) INTO v_devices
    FROM vrm.site_devices d
    WHERE d.site_id = p_site_id
      AND COALESCE((d.state -> 'bad_sweeps' ->> (p_date::text))::integer, 0) >= 4;
  END IF;

  IF v_devices > 0 THEN
    v_points := LEAST(35, 15 + 10 * (v_devices - 1));
    v_note := v_devices || ' equipment fault(s)';
    UPDATE vrm.daily_health h SET
      health_score  = GREATEST(0, h.health_score - v_points),
      health_status = CASE WHEN GREATEST(0, h.health_score - v_points) < 70 THEN 'Attention'
                           WHEN GREATEST(0, h.health_score - v_points) < 80 THEN 'Watch'
                           WHEN GREATEST(0, h.health_score - v_points) < 90 THEN 'Good'
                           ELSE 'Excellent' END,
      notes         = CASE WHEN h.notes = 'Normal operation' THEN v_note ELSE h.notes || '; ' || v_note END,
      system_score  = GREATEST(0, h.system_score - v_points),
      system_status = CASE WHEN GREATEST(0, h.system_score - v_points) < 70 THEN 'Attention'
                           WHEN GREATEST(0, h.system_score - v_points) < 80 THEN 'Watch'
                           WHEN GREATEST(0, h.system_score - v_points) < 90 THEN 'Good'
                           ELSE 'Excellent' END,
      system_notes  = CASE WHEN h.system_notes = 'Normal operation' THEN v_note ELSE h.system_notes || '; ' || v_note END,
      system_breakdown = COALESCE(h.system_breakdown, '[]'::jsonb)
                         || jsonb_build_object('code', 'device_fault', 'points', -v_points, 'value', v_devices)
    WHERE h.site_id = p_site_id AND h.date = p_date AND h.dump_type = p_dump_type
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$function$;
