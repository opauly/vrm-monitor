-- ============================================================
-- Victron Monitor — monitoring.compute_daily_health() (reference copy)
-- ============================================================
-- Source of truth: the LIVE function in Supabase, same "no migration file
-- in this repo" gap as vrm.compute_daily_health() (see that file's own
-- header, and ../README.md) — the monitoring schema DOES have a migration
-- history in principle (004_add_monitoring_schema.sql is referenced
-- elsewhere), but this function's own migration was never checked into
-- this split repo either. Pulled live 2026-09-18 via
-- `pg_get_functiondef('monitoring.compute_daily_health'::regproc)`,
-- immediately before applying the change below.
--
-- 2026-09-18 change (Oscar's own request, mirroring the identical fix
-- already applied to vrm.compute_daily_health() — see
-- vrm_compute_daily_health.sql for the full history): this trigger had
-- BOTH of that file's original problems, unfixed, for every monitoring
-- site (Pauly & Co's own Cerbo GX installs, including Vista Atenas):
--   1. A low SOC on a day with a real grid outage was scored identically
--      to an unexplained SOC crash with the grid available all day —
--      fixed the same way: full waiver (informational note only) when
--      outage minutes explain it that day.
--   2. One blended score asked "is my equipment okay?" and "is my grid
--      reliable?" at the same time — split into system_score/
--      system_status/system_notes (alarms, SOC, cycling, temperature,
--      voltage, float charge) and grid_score/grid_status/grid_notes
--      (outage duration/count, grid dependency), computed in parallel
--      with the existing blended v_score/v_notes at the exact point each
--      deduction already fires, rather than restructuring that logic.
--      health_score/health_status/notes are kept populated as a safety
--      net for any undiscovered reader.
--
-- Deliberately NOT added here: vrm's own system_type gating
-- (v_has_battery/v_has_grid, which makes SOC/battery checks skip for a
-- battery-less site and outage/grid checks skip for a site with no grid
-- connection). This function has never had that gating — its own
-- "-- TODO(system_type): unchanged from migration 010/037" comment marks
-- it as a known, separate, pre-existing gap, not something introduced by
-- this change. Vista Atenas sites are all `hybrid`, so the gap doesn't
-- affect them either way; every check here still fires unconditionally,
-- exactly as it already did, just re-bucketed into System/Grid instead of
-- one blended number. Flagged, not silently fixed — a real behavior
-- change for the fleet's `grid_zero` sites (most of them) is a separate
-- decision from the one asked for here.
CREATE OR REPLACE FUNCTION monitoring.compute_daily_health(p_site_id text, p_date date, p_dump_type text DEFAULT 'AUTO'::text)
 RETURNS monitoring.daily_health
 LANGUAGE plpgsql
AS $function$
DECLARE
  ed monitoring.energy_daily%ROWTYPE;
  v_alarms_count integer;
  v_battery_capacity numeric;
  v_battery_cycles numeric;
  v_est_cycles numeric;
  v_grid_dependency_pct numeric;
  v_min_soc numeric;
  v_outage_count integer;
  v_outage_minutes numeric;
  v_outage_penalty integer;
  v_max_temperature numeric;
  v_min_voltage numeric;
  v_mppt_reached_float boolean;
  v_grid_data_available boolean;
  v_soc_outage_explained boolean;
  v_score integer := 100;
  v_notes text[] := '{}';
  v_status text;
  -- System score (equipment health) and Grid score (grid reliability) —
  -- computed in parallel with the legacy blended v_score above, at the
  -- exact same point each deduction already fires. Both always apply
  -- here (no system_type gating in this function — see header comment),
  -- so unlike vrm's version, grid_score is never NULL.
  v_system_score integer := 100;
  v_system_notes text[] := '{}';
  v_system_status text;
  v_grid_score integer := 100;
  v_grid_notes text[] := '{}';
  v_grid_status text;
  v_result monitoring.daily_health;

  v_defaults constant jsonb := '{
      "socLowAlarm": 20, "socLowWarning": 30, "socLowWatch": 40,
      "outageMinLong": 120, "outageMinMid": 30, "outageCountHigh": 5,
      "gridDepHigh": 50, "gridDepMid": 20,
      "batteryCyclesHigh": 10.0, "batteryCyclesMid": 7.0,
      "estCyclesHigh": 0.85, "estCyclesMid": 0.65
  }'::jsonb;
  v_thr jsonb;

  t_soc_low_alarm       numeric;
  t_soc_low_warning     numeric;
  t_soc_low_watch       numeric;
  t_outage_min_long     numeric;
  t_outage_min_mid      numeric;
  t_outage_count_high   integer;
  t_grid_dep_high       numeric;
  t_grid_dep_mid        numeric;
  t_battery_cycles_high numeric;
  t_battery_cycles_mid  numeric;
  t_est_cycles_high     numeric;
  t_est_cycles_mid      numeric;

  -- TODO(system_type): unchanged from migration 010/037.
BEGIN
  SELECT * INTO ed
  FROM monitoring.energy_daily
  WHERE site_id = p_site_id AND date = p_date AND dump_type = p_dump_type
  ORDER BY id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT health_thresholds INTO v_thr FROM monitoring.sites WHERE site_id = p_site_id;
  v_thr := v_defaults || COALESCE(v_thr, '{}'::jsonb);

  t_soc_low_alarm       := (v_thr->>'socLowAlarm')::numeric;
  t_soc_low_warning     := (v_thr->>'socLowWarning')::numeric;
  t_soc_low_watch       := (v_thr->>'socLowWatch')::numeric;
  t_outage_min_long     := (v_thr->>'outageMinLong')::numeric;
  t_outage_min_mid      := (v_thr->>'outageMinMid')::numeric;
  t_outage_count_high   := (v_thr->>'outageCountHigh')::integer;
  t_grid_dep_high       := (v_thr->>'gridDepHigh')::numeric;
  t_grid_dep_mid        := (v_thr->>'gridDepMid')::numeric;
  t_battery_cycles_high := (v_thr->>'batteryCyclesHigh')::numeric;
  t_battery_cycles_mid  := (v_thr->>'batteryCyclesMid')::numeric;
  t_est_cycles_high     := (v_thr->>'estCyclesHigh')::numeric;
  t_est_cycles_mid      := (v_thr->>'estCyclesMid')::numeric;

  v_alarms_count       := monitoring.count_alarm_episodes(p_site_id, p_date);
  v_min_soc            := COALESCE(ed.min_soc, 0);
  v_outage_count       := COALESCE(ed.outage_count, 0);
  v_outage_minutes     := COALESCE(ed.outage_minutes, 0);
  v_battery_capacity   := COALESCE(NULLIF(ed.battery_kwh_snapshot, 0), 1);
  v_battery_cycles     := CASE WHEN ed.battery_discharge_kwh IS NULL THEN NULL
                               ELSE ed.battery_discharge_kwh / v_battery_capacity END;
  v_est_cycles         := CASE WHEN ed.min_soc IS NOT NULL AND ed.max_soc IS NOT NULL
                               THEN (ed.max_soc - ed.min_soc) / 100.0 ELSE NULL END;
  v_grid_dependency_pct := CASE WHEN COALESCE(ed.load_kwh, 0) > 0
                             THEN (COALESCE(ed.grid_kwh, 0) / ed.load_kwh) * 100
                             ELSE 0 END;
  v_max_temperature    := NULLIF(COALESCE(ed.max_temperature, 0), 0);
  v_min_voltage        := NULLIF(COALESCE(ed.min_voltage, 0), 0);
  v_mppt_reached_float := COALESCE(ed.battery_reached_float, false);
  v_grid_data_available := COALESCE(ed.grid_data_available, true);

  IF v_alarms_count > 0 THEN
    v_score := v_score - LEAST(25, v_alarms_count * 5);
    v_notes := array_append(v_notes, v_alarms_count || ' alarm event(s)');
    v_system_score := v_system_score - LEAST(25, v_alarms_count * 5);
    v_system_notes := array_append(v_system_notes, v_alarms_count || ' alarm event(s)');
  END IF;

  -- Same outage-waiver fix as vrm.compute_daily_health(): a low SOC on a
  -- day with a real grid outage is the battery doing its job, not a
  -- fault — full waiver, informational note only, on both the blended
  -- and System scores. Only a low SOC with NO outage that day still
  -- costs the original full penalty.
  v_soc_outage_explained := v_outage_minutes > 0;

  IF v_soc_outage_explained THEN
    IF v_min_soc > 0 AND v_min_soc < t_soc_low_watch THEN
      v_notes := array_append(v_notes, 'SOC reached ' || v_min_soc || '% covering a grid outage — battery held the load');
      v_system_notes := array_append(v_system_notes, 'SOC reached ' || v_min_soc || '% covering a grid outage — battery held the load');
    END IF;
  ELSIF v_min_soc > 0 AND v_min_soc < t_soc_low_alarm THEN
    v_score := v_score - 25;
    v_notes := array_append(v_notes, 'Very low SOC');
    v_system_score := v_system_score - 25;
    v_system_notes := array_append(v_system_notes, 'Very low SOC');
  ELSIF v_min_soc < t_soc_low_warning THEN
    v_score := v_score - 15;
    v_notes := array_append(v_notes, 'Low SOC');
    v_system_score := v_system_score - 15;
    v_system_notes := array_append(v_system_notes, 'Low SOC');
  ELSIF v_min_soc < t_soc_low_watch THEN
    v_score := v_score - 8;
    v_notes := array_append(v_notes, 'SOC below ' || t_soc_low_watch || '%');
    v_system_score := v_system_score - 8;
    v_system_notes := array_append(v_system_notes, 'SOC below ' || t_soc_low_watch || '%');
  END IF;

  v_outage_penalty := 0;
  IF v_outage_minutes > t_outage_min_long THEN
    v_outage_penalty := v_outage_penalty + 20;
    v_notes := array_append(v_notes, 'Long outage time');
    v_grid_notes := array_append(v_grid_notes, 'Long outage time');
  ELSIF v_outage_minutes > t_outage_min_mid THEN
    v_outage_penalty := v_outage_penalty + 10;
    v_notes := array_append(v_notes, 'Moderate outage time');
    v_grid_notes := array_append(v_grid_notes, 'Moderate outage time');
  ELSIF v_outage_minutes > 0 THEN
    v_outage_penalty := v_outage_penalty + 5;
    v_notes := array_append(v_notes, 'Grid outage detected');
    v_grid_notes := array_append(v_grid_notes, 'Grid outage detected');
  END IF;

  IF v_outage_count > t_outage_count_high THEN
    v_outage_penalty := v_outage_penalty + 10;
    v_notes := array_append(v_notes, 'Frequent outages');
    v_grid_notes := array_append(v_grid_notes, 'Frequent outages');
  END IF;

  v_score := v_score - LEAST(v_outage_penalty, 20);
  v_grid_score := v_grid_score - LEAST(v_outage_penalty, 20);

  IF v_grid_dependency_pct > t_grid_dep_high THEN
    v_score := v_score - 10;
    v_notes := array_append(v_notes, 'High grid dependency');
    v_grid_score := v_grid_score - 10;
    v_grid_notes := array_append(v_grid_notes, 'High grid dependency');
  ELSIF v_grid_dependency_pct > t_grid_dep_mid THEN
    v_score := v_score - 5;
    v_notes := array_append(v_notes, 'Moderate grid dependency');
    v_grid_score := v_grid_score - 5;
    v_grid_notes := array_append(v_grid_notes, 'Moderate grid dependency');
  END IF;

  IF v_battery_cycles IS NOT NULL THEN
    IF v_battery_cycles > t_battery_cycles_high THEN
      v_score := v_score - 10;
      v_notes := array_append(v_notes, 'High battery cycling');
      v_system_score := v_system_score - 10;
      v_system_notes := array_append(v_system_notes, 'High battery cycling');
    ELSIF v_battery_cycles > t_battery_cycles_mid THEN
      v_score := v_score - 5;
      v_notes := array_append(v_notes, 'Moderate battery cycling');
      v_system_score := v_system_score - 5;
      v_system_notes := array_append(v_system_notes, 'Moderate battery cycling');
    END IF;
  ELSIF v_est_cycles IS NOT NULL THEN
    IF v_est_cycles > t_est_cycles_high THEN
      v_score := v_score - 10;
      v_notes := array_append(v_notes, 'High battery cycling (estimated from SOC swing)');
      v_system_score := v_system_score - 10;
      v_system_notes := array_append(v_system_notes, 'High battery cycling (estimated from SOC swing)');
    ELSIF v_est_cycles > t_est_cycles_mid THEN
      v_score := v_score - 5;
      v_notes := array_append(v_notes, 'Moderate battery cycling (estimated from SOC swing)');
      v_system_score := v_system_score - 5;
      v_system_notes := array_append(v_system_notes, 'Moderate battery cycling (estimated from SOC swing)');
    END IF;
  END IF;

  IF v_max_temperature IS NOT NULL AND v_max_temperature > 45 THEN
    v_score := v_score - 15;
    v_notes := array_append(v_notes, 'High battery temperature (' || v_max_temperature || '°C)');
    v_system_score := v_system_score - 15;
    v_system_notes := array_append(v_system_notes, 'High battery temperature (' || v_max_temperature || '°C)');
  ELSIF v_max_temperature IS NOT NULL AND v_max_temperature > 40 THEN
    v_score := v_score - 5;
    v_notes := array_append(v_notes, 'Elevated battery temperature (' || v_max_temperature || '°C)');
    v_system_score := v_system_score - 5;
    v_system_notes := array_append(v_system_notes, 'Elevated battery temperature (' || v_max_temperature || '°C)');
  END IF;

  IF v_min_voltage IS NOT NULL AND v_min_voltage < 46.0 THEN
    v_score := v_score - 10;
    v_notes := array_append(v_notes, 'Low battery voltage (' || v_min_voltage || 'V)');
    v_system_score := v_system_score - 10;
    v_system_notes := array_append(v_system_notes, 'Low battery voltage (' || v_min_voltage || 'V)');
  END IF;

  IF v_mppt_reached_float = false THEN
    v_score := v_score - 5;
    v_notes := array_append(v_notes, 'Battery did not fully charge today');
    v_system_score := v_system_score - 5;
    v_system_notes := array_append(v_system_notes, 'Battery did not fully charge today');
  END IF;

  IF v_grid_data_available = false THEN
    v_notes := array_append(v_notes, 'No grid measurements recorded — verify AC input connections');
    v_grid_notes := array_append(v_grid_notes, 'No grid measurements recorded — verify AC input connections');
  END IF;

  v_score := GREATEST(0, LEAST(100, v_score));

  v_status := 'Excellent';
  IF v_score < 70 THEN v_status := 'Attention';
  ELSIF v_score < 80 THEN v_status := 'Watch';
  ELSIF v_score < 90 THEN v_status := 'Good';
  END IF;

  IF array_length(v_notes, 1) IS NULL THEN
    v_notes := array_append(v_notes, 'Normal operation');
  END IF;

  v_system_score := GREATEST(0, LEAST(100, v_system_score));
  v_system_status := 'Excellent';
  IF v_system_score < 70 THEN v_system_status := 'Attention';
  ELSIF v_system_score < 80 THEN v_system_status := 'Watch';
  ELSIF v_system_score < 90 THEN v_system_status := 'Good';
  END IF;
  IF array_length(v_system_notes, 1) IS NULL THEN
    v_system_notes := array_append(v_system_notes, 'Normal operation');
  END IF;

  v_grid_score := GREATEST(0, LEAST(100, v_grid_score));
  v_grid_status := 'Excellent';
  IF v_grid_score < 70 THEN v_grid_status := 'Attention';
  ELSIF v_grid_score < 80 THEN v_grid_status := 'Watch';
  ELSIF v_grid_score < 90 THEN v_grid_status := 'Good';
  END IF;
  IF array_length(v_grid_notes, 1) IS NULL THEN
    v_grid_notes := array_append(v_grid_notes, 'Normal operation');
  END IF;

  INSERT INTO monitoring.daily_health
    (site_id, date, dump_type, health_score, health_status, alarms_count,
     min_soc, outage_count, outage_minutes, grid_dependency_pct, battery_cycles, notes,
     system_score, system_status, system_notes, grid_score, grid_status, grid_notes)
  VALUES
    (p_site_id, p_date, p_dump_type, v_score, v_status, v_alarms_count,
     ed.min_soc, v_outage_count, v_outage_minutes,
     ROUND(v_grid_dependency_pct, 1), ROUND(v_battery_cycles, 2), array_to_string(v_notes, '; '),
     v_system_score, v_system_status, array_to_string(v_system_notes, '; '),
     v_grid_score, v_grid_status, array_to_string(v_grid_notes, '; '))
  ON CONFLICT (site_id, date, dump_type) DO UPDATE SET
    health_score        = EXCLUDED.health_score,
    health_status       = EXCLUDED.health_status,
    alarms_count        = EXCLUDED.alarms_count,
    min_soc             = EXCLUDED.min_soc,
    outage_count        = EXCLUDED.outage_count,
    outage_minutes      = EXCLUDED.outage_minutes,
    grid_dependency_pct = EXCLUDED.grid_dependency_pct,
    battery_cycles      = EXCLUDED.battery_cycles,
    notes               = EXCLUDED.notes,
    system_score        = EXCLUDED.system_score,
    system_status       = EXCLUDED.system_status,
    system_notes        = EXCLUDED.system_notes,
    grid_score          = EXCLUDED.grid_score,
    grid_status         = EXCLUDED.grid_status,
    grid_notes          = EXCLUDED.grid_notes
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$function$
