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
-- Pulled live 2026-09-17/18, immediately after applying each fix below
-- (confirmed applied by recomputing real rows via the exposed
-- `rpc/compute_daily_health` endpoint and diffing the result each time).
--
-- 2026-09-17 change, in two passes (Oscar's own feedback both times):
-- the low-SOC penalty used to be totally blind to WHY the battery was
-- low — a day where the grid dropped and the battery successfully
-- covered the load (SOC crashes, but the system worked exactly as
-- designed) scored IDENTICAL to a day where SOC crashed for no reason
-- at all with the grid sitting right there available. First pass
-- shifted the outage-explained case down one severity tier rather than
-- waiving it. Oscar pushed back on that too: "a low score for me would
-- be that the system is behaving bad... if there is an outage and my
-- battery is capable of holding the loads... that is a very healthy
-- system" — a customer seeing 45/100 reads it as "something's wrong,"
-- not "your battery did exactly its job." Second (current) pass fully
-- waives the SOC penalty when a real outage happened that day —
-- informational note only, zero score impact — since genuine
-- battery-damage risk is still caught independently by the low-voltage
-- check and by the Cerbo's own alarm events, already scored elsewhere
-- in this function. Only a low SOC with NO outage that day (grid
-- available, drained anyway) still costs the original full penalty.
-- The outage-duration penalty itself (a separate concern — grid
-- reliability, not battery health) is unchanged throughout.
--
-- 2026-09-18 change (Oscar's own follow-up): the single blended score
-- was still asking one number to answer two different questions — "is
-- my equipment okay?" and "is my grid reliable?" — which is exactly
-- how a covered outage could still read as alarming even after the
-- fix above. Split into system_score/system_status/system_notes
-- (alarms, SOC, cycling, temperature, voltage, float charge — "is my
-- equipment okay?") and grid_score/grid_status/grid_notes (outage
-- duration/count, grid dependency — "is my grid reliable?"), computed
-- in parallel with the existing blended v_score at the exact point
-- each deduction already fires, rather than restructuring that logic.
-- health_score/health_status/notes are kept populated as a safety net
-- for any undiscovered reader, but the app no longer surfaces them
-- anywhere — System/Grid are the real numbers now. grid_score is NULL
-- (not 100) for an off_grid site with no grid connection at all.
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
  -- System score (equipment health: alarms, SOC, cycling, temperature,
  -- voltage, float charge) and Grid score (grid reliability: outages,
  -- dependency) — computed in parallel with the legacy blended v_score
  -- above, at the exact same point each deduction already fires, rather
  -- than restructuring that already-verified logic. Grid score is NULL
  -- for a site with no grid connection at all (system_type='off_grid')
  -- — there's no grid to score, not a perfect one.
  v_system_score integer := 100;
  v_system_notes text[] := '{}';
  v_system_status text;
  v_grid_score integer := 100;
  v_grid_notes text[] := '{}';
  v_grid_status text;
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
    -- System side: the alarm categories counted here (Low battery,
    -- Overload, High temperature, ...) are equipment-triggered, not
    -- grid-quality signals — a real grid loss is scored on the Grid
    -- side below via outage minutes/count instead.
    v_system_score := v_system_score - LEAST(25, v_alarms_count * 5);
    v_system_notes := array_append(v_system_notes, v_alarms_count || ' alarm event(s)');
  END IF;

  IF v_has_battery THEN
    -- A battery discharging to cover a real grid outage — holding the
    -- load with no interruption the customer ever noticed — is the
    -- system succeeding, not a fault, no matter how low SOC got that
    -- day (Oscar's own framing, 2026-09-17: "a low score for me would
    -- be that the system is behaving bad... if there is an outage and
    -- my battery is capable of holding the loads... that is a very
    -- healthy system"). So this is a full waiver, not a softened
    -- penalty — informational note only, zero score impact. This does
    -- NOT create a blind spot for genuine battery-damage risk: a truly
    -- dangerous deep discharge is still caught independently below by
    -- the low-voltage check and by the Cerbo's own alarm events
    -- (already scored above, e.g. a real "Low battery" alarm). Only a
    -- low SOC with NO outage that day — the grid was available the
    -- whole time and it still drained — is the genuinely odd case,
    -- and keeps its full original penalty.
    v_soc_outage_explained := v_has_grid AND v_outage_minutes > 0;

    -- SOC is always a System-side concern (it's the battery, not the
    -- grid) — the outage-waiver logic above already keeps this fair
    -- when a real outage explains it, on both the blended and System
    -- scores identically.
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
    ELSIF v_min_soc < t_soc_low_watch AND v_has_grid THEN
      v_score := v_score - 8;
      v_notes := array_append(v_notes, 'SOC below ' || t_soc_low_watch || '%');
      v_system_score := v_system_score - 8;
      v_system_notes := array_append(v_system_notes, 'SOC below ' || t_soc_low_watch || '%');
    END IF;
  END IF;

  IF v_has_grid THEN
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
  END IF;

  IF v_has_battery THEN
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
  END IF;

  IF v_has_grid AND v_grid_data_available = false THEN
    v_notes := array_append(v_notes, 'No grid measurements recorded — verify AC input connections');
    v_grid_notes := array_append(v_grid_notes, 'No grid measurements recorded — verify AC input connections');
  END IF;

  IF ed.complete_day = false THEN
    v_notes := array_append(v_notes,
      'Partial day (' || COALESCE(ROUND(ed.hours_covered, 1)::text, '?') || 'h of data)');
    -- Data-quality caveat, not specific to either side — applies to
    -- both, so both readings carry the same "take this with a grain of
    -- salt today" caveat.
    v_system_notes := array_append(v_system_notes,
      'Partial day (' || COALESCE(ROUND(ed.hours_covered, 1)::text, '?') || 'h of data)');
    IF v_has_grid THEN
      v_grid_notes := array_append(v_grid_notes,
        'Partial day (' || COALESCE(ROUND(ed.hours_covered, 1)::text, '?') || 'h of data)');
    END IF;
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

  -- System score always applies (every site has equipment to score,
  -- even a grid_zero one with no battery — alarms alone still count).
  v_system_score := GREATEST(0, LEAST(100, v_system_score));
  v_system_status := 'Excellent';
  IF v_system_score < 70 THEN v_system_status := 'Attention';
  ELSIF v_system_score < 80 THEN v_system_status := 'Watch';
  ELSIF v_system_score < 90 THEN v_system_status := 'Good';
  END IF;
  IF array_length(v_system_notes, 1) IS NULL THEN
    v_system_notes := array_append(v_system_notes, 'Normal operation');
  END IF;

  -- Grid score is NULL for an off_grid site — there's no grid
  -- connection to score at all, which is a different statement than
  -- "the grid is perfect."
  IF v_has_grid THEN
    v_grid_score := GREATEST(0, LEAST(100, v_grid_score));
    v_grid_status := 'Excellent';
    IF v_grid_score < 70 THEN v_grid_status := 'Attention';
    ELSIF v_grid_score < 80 THEN v_grid_status := 'Watch';
    ELSIF v_grid_score < 90 THEN v_grid_status := 'Good';
    END IF;
    IF array_length(v_grid_notes, 1) IS NULL THEN
      v_grid_notes := array_append(v_grid_notes, 'Normal operation');
    END IF;
  ELSE
    v_grid_score := NULL;
    v_grid_status := NULL;
    v_grid_notes := NULL;
  END IF;

  INSERT INTO vrm.daily_health
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
