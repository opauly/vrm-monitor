-- ============================================================
-- VRM Monitor — vrm.compute_daily_health() (reference copy)
-- ============================================================
-- Source of truth: the LIVE function in Supabase — there is no
-- migration file for it in this repo (the `vrm` schema's migrations,
-- unlike `monitoring`'s, were never checked in anywhere; see
-- ../README.md and ../web/README.md for that split-repo gap). This
-- file exists purely as documentation, so the current scoring logic
-- doesn't require pulling `pg_get_functiondef('vrm.compute_daily_
-- health'::regproc)` from the SQL editor every time someone needs to
-- read it. Keep it in sync manually whenever the live function
-- changes — nothing here is executed automatically.
--
-- Pulled live 2026-09-17, immediately after applying the fix below
-- (confirmed applied by recomputing two real rows via the exposed
-- `rpc/compute_daily_health` endpoint and diffing the result).
--
-- 2026-09-17 change (Oscar's own feedback): the low-SOC penalty used
-- to be totally blind to WHY the battery was low — a day where the
-- grid dropped and the battery successfully covered the load (SOC
-- crashes, but the system worked exactly as designed) scored IDENTICAL
-- to a day where SOC crashed for no reason at all with the grid sitting
-- right there available. Fixed by shifting the SOC penalty down one
-- existing severity tier (not waiving it outright — a battery that
-- still ends the day critically low is worth a softer flag even so, in
-- case it's undersized for outages this long) whenever that day also
-- had real outage minutes recorded. The outage-duration penalty itself
-- (a separate concern — grid reliability, not battery health) is
-- unchanged.
CREATE OR REPLACE FUNCTION vrm.compute_daily_health(p_site_id text, p_date date, p_dump_type text DEFAULT 'csv_upload'::text)
 RETURNS vrm.daily_health
 LANGUAGE plpgsql
AS $function$
DECLARE
  ed vrm.energy_daily%ROWTYPE;
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
  v_system_type text;
  v_has_battery boolean;
  v_has_grid boolean;
  v_soc_outage_explained boolean;
  v_score integer := 100;
  v_notes text[] := '{}';
  v_status text;
  v_result vrm.daily_health;

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
BEGIN
  SELECT * INTO ed
  FROM vrm.energy_daily
  WHERE site_id = p_site_id AND date = p_date AND dump_type = p_dump_type
  ORDER BY id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT health_thresholds, system_type INTO v_thr, v_system_type
  FROM vrm.sites WHERE site_id = p_site_id;
  v_thr := v_defaults || COALESCE(v_thr, '{}'::jsonb);
  v_system_type := COALESCE(v_system_type, 'hybrid');

  v_has_battery := v_system_type IN ('off_grid', 'hybrid');
  v_has_grid    := v_system_type IN ('grid_zero', 'hybrid');

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

  v_alarms_count       := vrm.count_alarm_episodes(p_site_id, p_date);
  v_min_soc            := COALESCE(ed.min_soc, 0);
  v_outage_count       := COALESCE(ed.outage_count, 0);
  v_outage_minutes     := COALESCE(ed.outage_minutes, 0);
  v_battery_capacity   := COALESCE(NULLIF(ed.battery_kwh_snapshot, 0), 1);
  v_battery_cycles     := CASE WHEN ed.battery_discharge_kwh IS NULL THEN NULL
                               ELSE ed.battery_discharge_kwh / v_battery_capacity END;
  -- SOC-swing estimate, only meaningful when both ends of the swing
  -- were actually recorded that day.
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
  END IF;

  IF v_has_battery THEN
    -- A low SOC on a day with a real grid outage is the battery doing
    -- its job (discharging to cover load while the grid was down), not
    -- a fault. Shifted down one severity tier rather than waived
    -- outright — a battery that still ends the day critically low is
    -- worth a softer flag even so, in case it's undersized for outages
    -- this long, but it must not score the same as an unexplained SOC
    -- crash with the grid sitting right there and available all day.
    v_soc_outage_explained := v_has_grid AND v_outage_minutes > 0;

    IF v_min_soc > 0 AND v_min_soc < t_soc_low_alarm THEN
      IF v_soc_outage_explained THEN
        v_score := v_score - 15;
        v_notes := array_append(v_notes, 'Very low SOC (covering a grid outage)');
      ELSE
        v_score := v_score - 25;
        v_notes := array_append(v_notes, 'Very low SOC');
      END IF;
    ELSIF v_min_soc < t_soc_low_warning THEN
      IF v_soc_outage_explained THEN
        v_score := v_score - 8;
        v_notes := array_append(v_notes, 'Low SOC (covering a grid outage)');
      ELSE
        v_score := v_score - 15;
        v_notes := array_append(v_notes, 'Low SOC');
      END IF;
    ELSIF v_min_soc < t_soc_low_watch AND v_has_grid THEN
      IF v_soc_outage_explained THEN
        v_notes := array_append(v_notes, 'SOC below ' || t_soc_low_watch || '% (grid outage that day)');
      ELSE
        v_score := v_score - 8;
        v_notes := array_append(v_notes, 'SOC below ' || t_soc_low_watch || '%');
      END IF;
    END IF;
  END IF;

  IF v_has_grid THEN
    v_outage_penalty := 0;
    IF v_outage_minutes > t_outage_min_long THEN
      v_outage_penalty := v_outage_penalty + 20;
      v_notes := array_append(v_notes, 'Long outage time');
    ELSIF v_outage_minutes > t_outage_min_mid THEN
      v_outage_penalty := v_outage_penalty + 10;
      v_notes := array_append(v_notes, 'Moderate outage time');
    ELSIF v_outage_minutes > 0 THEN
      v_outage_penalty := v_outage_penalty + 5;
      v_notes := array_append(v_notes, 'Grid outage detected');
    END IF;

    IF v_outage_count > t_outage_count_high THEN
      v_outage_penalty := v_outage_penalty + 10;
      v_notes := array_append(v_notes, 'Frequent outages');
    END IF;

    v_score := v_score - LEAST(v_outage_penalty, 20);

    IF v_grid_dependency_pct > t_grid_dep_high THEN
      v_score := v_score - 10;
      v_notes := array_append(v_notes, 'High grid dependency');
    ELSIF v_grid_dependency_pct > t_grid_dep_mid THEN
      v_score := v_score - 5;
      v_notes := array_append(v_notes, 'Moderate grid dependency');
    END IF;
  END IF;

  IF v_has_battery THEN
    IF v_battery_cycles IS NOT NULL THEN
      IF v_battery_cycles > t_battery_cycles_high THEN
        v_score := v_score - 10;
        v_notes := array_append(v_notes, 'High battery cycling');
      ELSIF v_battery_cycles > t_battery_cycles_mid THEN
        v_score := v_score - 5;
        v_notes := array_append(v_notes, 'Moderate battery cycling');
      END IF;
    ELSIF v_est_cycles IS NOT NULL THEN
      IF v_est_cycles > t_est_cycles_high THEN
        v_score := v_score - 10;
        v_notes := array_append(v_notes, 'High battery cycling (estimated from SOC swing)');
      ELSIF v_est_cycles > t_est_cycles_mid THEN
        v_score := v_score - 5;
        v_notes := array_append(v_notes, 'Moderate battery cycling (estimated from SOC swing)');
      END IF;
    END IF;

    IF v_max_temperature IS NOT NULL AND v_max_temperature > 45 THEN
      v_score := v_score - 15;
      v_notes := array_append(v_notes, 'High battery temperature (' || v_max_temperature || '°C)');
    ELSIF v_max_temperature IS NOT NULL AND v_max_temperature > 40 THEN
      v_score := v_score - 5;
      v_notes := array_append(v_notes, 'Elevated battery temperature (' || v_max_temperature || '°C)');
    END IF;

    IF v_min_voltage IS NOT NULL AND v_min_voltage < 46.0 THEN
      v_score := v_score - 10;
      v_notes := array_append(v_notes, 'Low battery voltage (' || v_min_voltage || 'V)');
    END IF;

    IF v_mppt_reached_float = false THEN
      v_score := v_score - 5;
      v_notes := array_append(v_notes, 'Battery did not fully charge today');
    END IF;
  END IF;

  IF v_has_grid AND v_grid_data_available = false THEN
    v_notes := array_append(v_notes, 'No grid measurements recorded — verify AC input connections');
  END IF;

  IF ed.complete_day = false THEN
    v_notes := array_append(v_notes,
      'Partial day (' || COALESCE(ROUND(ed.hours_covered, 1)::text, '?') || 'h of data)');
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

  INSERT INTO vrm.daily_health
    (site_id, date, dump_type, health_score, health_status, alarms_count,
     min_soc, outage_count, outage_minutes, grid_dependency_pct, battery_cycles, notes)
  VALUES
    (p_site_id, p_date, p_dump_type, v_score, v_status, v_alarms_count,
     ed.min_soc, v_outage_count, v_outage_minutes,
     ROUND(v_grid_dependency_pct, 1), ROUND(v_battery_cycles, 2), array_to_string(v_notes, '; '))
  ON CONFLICT (site_id, date, dump_type) DO UPDATE SET
    health_score        = EXCLUDED.health_score,
    health_status       = EXCLUDED.health_status,
    alarms_count        = EXCLUDED.alarms_count,
    min_soc             = EXCLUDED.min_soc,
    outage_count        = EXCLUDED.outage_count,
    outage_minutes      = EXCLUDED.outage_minutes,
    grid_dependency_pct = EXCLUDED.grid_dependency_pct,
    battery_cycles      = EXCLUDED.battery_cycles,
    notes               = EXCLUDED.notes
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$function$
