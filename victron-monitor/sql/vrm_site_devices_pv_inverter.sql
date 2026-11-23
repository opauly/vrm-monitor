-- Equipment table: also list PV inverters (an AC-coupled Fronius and the like). Safe to re-run.
ALTER TABLE vrm.site_devices DROP CONSTRAINT IF EXISTS site_devices_kind_check;
ALTER TABLE vrm.site_devices ADD CONSTRAINT site_devices_kind_check
  CHECK (kind IN ('charger','battery','inverter','pv_inverter'));
