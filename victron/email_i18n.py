from __future__ import annotations
"""
Strings for the transactional emails this repo's Python side renders and
sends (2026-09-30) — `report_email.html`, `cap_reached_email.html`,
`trial_ending_with_card_email.html`, `trial_ending_no_card_email.html`, and
(PLAN_BETA_PROGRAM.md § Phase 3) `beta_ending_email.html`,
`beta_ended_email.html`. A separate, flat dict from `report_i18n.py` on
purpose: that module's `get(lang, num_days, is_overview)` period/overview-
variant machinery exists for the PDF report body, which these emails
aren't — every key here is period-neutral, so a plain `t(lang, key)` is
all any of them need.

Every one of this module's callers (`vrm_api/report_delivery.py`'s
`send_report_email()`/`notify_cap_reached_once()`, `vrm_api/billing.py`'s
`send_trial_ending_reminders()`/`run_beta_sweep()`) already has the
recipient's own stored language in scope by the time it renders —
`site.get("report_language")` for the report email (the exact field
`weekly_report.py` already reads for the PDF itself), `customer.get(
"ui_language")` for everything else (account-level notices, not tied to
one site). Nothing here needed a new place to capture a language choice,
same finding as the TypeScript-side transactional emails this mirrors
(`victron-monitor/web/lib/server/emailTemplates.ts`).

Interpolated strings use the same `{token}`-and-`.replace()` shape the
TypeScript side's `lib/i18n/strings.ts` already established for its own
templated strings, rather than Python's `.format()` — one convention across
both runtimes, not two.
"""

EN = {
    "report_page_title": "{site} report",
    "report_preheader": "Your {site} report for {start} – {end} is attached.",
    "report_intro": "Your report for {site} ({start} – {end}) is ready — attached as a PDF.",
    "report_health_score_label": "Health score",
    "report_key_stats_label": "Key stats",
    "report_solar_label": "Solar generated",
    "report_consumed_label": "Consumed",
    "report_grid_independence_label": "Grid independence",
    "report_full_report_note": "The full report, with every section, is attached as a PDF.",
    "report_sent_by": "Sent by {company}",
    "report_unsubscribe_link": "Stop receiving this report",

    "cap_title": "Scheduled report limit reached",
    "cap_body1": "Your plan allows {cap} scheduled report(s) per billing period. You've reached that limit for "
                "the period ending {period_end} — any further scheduled reports due before then will be "
                "skipped, and your existing reports remain downloadable in the portal.",
    "cap_body2": "New scheduled reports will resume automatically once the next billing period starts. If this "
                "keeps happening, consider a less frequent cadence on some sites, or contact us about a higher "
                "limit.",
    "cap_footer": "Sent once per billing period — you won't get another one of these until your next period starts.",

    "trial_title": "Your trial ends tomorrow",
    "trial_footer": "You're receiving this because your trial is ending soon. This is a one-time notice.",
    "trial_card_body1": "Your free trial ends on {date}. Your saved payment method will be charged "
                        "{amount} automatically to start your subscription — no action needed on your part.",
    "trial_card_body2": "Want to change your plan or update your card first? You can do that any time from the "
                        "Billing page in your account.",
    "trial_nocard_body1": "We don't have a payment method on file for your account. Without one, your access "
                          "will be suspended when your trial ends on {date} — your data stays safe, but "
                          "reports and the dashboard won't be available until you add a card and subscribe.",
    "trial_nocard_body2": "Add a payment method from the Billing page in your account to keep your access "
                          "without interruption.",

    "beta_ending_title": "Your beta access ends in a week",
    "beta_ending_body1": "Your free beta access ends on {date}. After that, reports, the dashboard, and "
                        "branding won't be available until you subscribe.",
    "beta_ending_body2": "You can subscribe any time before then from the Billing page in your account — your "
                        "data and sites stay exactly as they are either way.",
    "beta_ending_footer": "Sent once, a week before your beta access ends. This is a one-time notice.",
    "beta_ended_title": "Your beta access has ended",
    "beta_ended_body1": "Your free beta access has ended. Your data and sites are safe, but reports, the "
                        "dashboard, and branding won't be available until you subscribe.",
    "beta_ended_body2": "Subscribe any time from the Billing page in your account to pick up right where "
                        "you left off.",
    "beta_ended_footer": "Sent once, when your beta access ended. This is a one-time notice.",

    # Fleet alerts (vrm_api/alerts_delivery.py). {site}/{since}/{minutes}/{soc}/{alarms} are filled in there.
    "alert_severity_critical": "Critical",
    "alert_severity_warning": "Warning",
    "alert_section_new": "New alerts",
    "alert_section_resolved": "Back to normal",
    "alert_multi_subject": "{n} updates on your systems",
    "alert_view_site": "View site",
    "alert_reconnect": "Reconnect VRM",
    "alert_footer": "You are receiving this because alerts are turned on for your account.",
    "alert_site_offline_push": "Site offline",
    "alert_site_offline_push_resolved": "Site back online",
    "alert_grid_outage_push": "Grid outage",
    "alert_grid_outage_push_resolved": "Grid power is back",
    "alert_low_battery_push": "Low battery",
    "alert_low_battery_critical_push": "Battery critically low",
    "alert_low_battery_push_resolved": "Battery recovered",
    "alert_system_alarm_push": "System alarm",
    "alert_system_alarm_push_resolved": "System alarm cleared",
    "alert_vrm_link_broken_push": "VRM connection stopped",
    "alert_vrm_link_broken_push_resolved": "VRM connection restored",
    "alert_device_fault_push": "Equipment problem",
    "alert_device_fault_push_resolved": "Equipment problem resolved",
    "victron_attribution": "Data from Victron Energy’s VRM Portal. Victron Energy and VRM are trademarks of Victron Energy B.V. This service is independent and is not affiliated with or endorsed by Victron Energy.",
    "alert_manage": "Choose which alerts you get",
    "alert_push_test_title": "Test notification",
    "alert_push_test_body": "Alerts will arrive on this device like this.",
    "alert_site_offline_title": "{site} stopped reporting",
    "alert_site_offline_body": "No data has arrived since {since} ({minutes} minutes). "
                               "Check the site's internet connection and power.",
    "alert_site_offline_resolved": "{site} is reporting again",
    "alert_grid_outage_title": "Grid outage at {site}",
    "alert_grid_outage_body": "Utility power is out. The system is running on its battery{soc_phrase}.",
    "alert_grid_outage_soc_phrase": " (charge: {soc}%)",
    "alert_grid_outage_resolved": "Grid power is back at {site}",
    "alert_low_battery_title": "Low battery at {site}",
    "alert_low_battery_body": "Battery charge is {soc}%.",
    "alert_low_battery_critical_title": "Battery critically low at {site}",
    "alert_low_battery_critical_body": "Battery charge is {soc}% — the system may shut down soon.",
    "alert_low_battery_resolved": "Battery recovered at {site}",
    "alert_system_alarm_title": "System alarm at {site}",
    "alert_system_alarm_body": "Active: {alarms}.",
    "alert_system_alarm_resolved": "System alarm cleared at {site}",
    "alert_device_fault_title": "Equipment problem at {site}",
    "alert_device_fault_body": "{devices}",
    "alert_device_fault_resolved": "Equipment problem resolved at {site}",
    "alert_device_name_charger": "Solar charger {n}",
    "alert_device_name_charger_single": "Solar charger",
    "alert_device_name_battery": "Battery",
    "alert_device_name_inverter": "Inverter",
    "alert_device_note_charger_error": "reports an error ({error})",
    "alert_device_note_not_reporting": "has not reported for {minutes} minutes",
    "alert_device_note_no_output": "made almost nothing ({kwh} kWh) while the others made {others_kwh} kWh",
    "alert_device_note_low_output": "made {pct_below}% less than usual while the others were normal",
    "alert_device_note_modules_offline": "only {online} of {total} modules are online",
    "alert_device_note_battery_failure": "reports an internal failure",
    "alert_device_note_blocking": "has a module blocking charge or discharge",
    "alert_device_note_inverter_error": "reports an error ({error})",
    "alert_device_note_units_missing": "only {units} of {expected} units are responding",
    "alert_device_note_inverter_warning": "unit {unit} reports a warning",
    "alert_device_note_missing": "no longer appears in the system's data",
    "alert_alarm_overload": "overload",
    "alert_alarm_dc_ripple": "DC ripple",
    "alert_alarm_temp_fault": "temperature fault",
    "alert_alarm_cell_imbalance": "cell imbalance",
    "alert_vrm_link_broken_title": "Your Victron VRM connection stopped working",
    "alert_vrm_link_broken_body": "Automatic updates are paused until you reconnect your VRM account.",
    "alert_vrm_link_broken_resolved": "Your Victron VRM connection is working again",
    # Admin fleet-health alerts (vrm_api/admin_alerts.py) — to the admin, about the monitor itself.
    "admin_alert_footer": "You are receiving this because fleet-health alerts are turned on for the admin.",
    "admin_alert_open": "Open fleet alerts",
    "admin_alert_multi_subject": "{n} fleet-health updates",
    "admin_alert_fleet_offline_title": "{offline} of {total} sites went quiet together",
    "admin_alert_fleet_offline_body": "Silent now: {sites}. Several sites stopping at once usually means a VRM, credential or connectivity problem rather than the sites themselves.",
    "admin_alert_fleet_offline_resolved": "Sites are reporting again",
    "admin_alert_fetch_failing_title": "Most sites could not be read ({failed} of {attempted})",
    "admin_alert_fetch_failing_body": "The latest sweep failed to fetch from {failed} of {attempted} sites. Check VRM's status, the admin VRM token and the API logs.",
    "admin_alert_fetch_failing_resolved": "Reading sites works again",
    "admin_alert_sweep_stale_title": "The live-data sweep has stopped",
    "admin_alert_sweep_stale_body": "The 15-minute snapshot sweep last ran {minutes} minutes ago, so every dashboard and alert is out of date. Check the scheduler job and the API service.",
    "admin_alert_sweep_stale_resolved": "The live-data sweep is running again",
    "admin_alert_history_stale_title": "Daily history is behind",
    "admin_alert_history_stale_body": "The newest daily figures are from {day} ({days} days ago). Check the daily history sync job.",
    "admin_alert_history_stale_resolved": "Daily history is up to date",
}

ES = dict(EN, **{
    "report_page_title": "Reporte de {site}",
    "report_preheader": "Tu reporte de {site} para el período {start} – {end} está adjunto.",
    "report_intro": "Tu reporte de {site} ({start} – {end}) está listo — adjunto como PDF.",
    "report_health_score_label": "Puntaje de salud",
    "report_key_stats_label": "Datos clave",
    "report_solar_label": "Solar generado",
    "report_consumed_label": "Consumido",
    "report_grid_independence_label": "Independencia de red",
    "report_full_report_note": "El reporte completo, con cada sección, está adjunto como PDF.",
    "report_sent_by": "Enviado por {company}",
    "report_unsubscribe_link": "Dejar de recibir este reporte",

    "cap_title": "Se alcanzó el límite de reportes programados",
    "cap_body1": "Tu plan permite {cap} reporte(s) programado(s) por período de facturación. "
                "Alcanzaste ese límite para el período que termina el {period_end} — cualquier "
                "reporte programado adicional antes de esa fecha se omitirá, y tus reportes existentes "
                "siguen disponibles para descargar en el portal.",
    "cap_body2": "Los reportes programados se reanudarán automáticamente al comenzar el próximo "
                "período de facturación. Si esto sigue pasando, considerá una cadencia menos "
                "frecuente en algunos sitios, o contactanos sobre un límite mayor.",
    "cap_footer": "Enviado una vez por período de facturación — no recibirás otro de estos "
                 "hasta que comience tu próximo período.",

    "trial_title": "Tu prueba termina mañana",
    "trial_footer": "Recibís esto porque tu prueba gratis está por terminar. Este es un aviso único.",
    "trial_card_body1": "Tu prueba gratis termina el {date}. Se le cobrará {amount} automáticamente a "
                        "tu método de pago guardado para iniciar tu suscripción — no necesitás "
                        "hacer nada.",
    "trial_card_body2": "¿Querés cambiar tu plan o actualizar tu tarjeta antes? Podés hacerlo "
                        "cuando quieras desde la página de Facturación de tu cuenta.",
    "trial_nocard_body1": "No tenemos un método de pago registrado para tu cuenta. Sin uno, tu acceso se "
                          "suspenderá cuando tu prueba termine el {date} — tus datos se mantienen a "
                          "salvo, pero los reportes y el panel no estarán disponibles hasta que agregues "
                          "una tarjeta y te suscribas.",
    "trial_nocard_body2": "Agregá un método de pago desde la página de Facturación de tu "
                          "cuenta para mantener tu acceso sin interrupciones.",

    "beta_ending_title": "Tu acceso beta termina en una semana",
    "beta_ending_body1": "Tu acceso beta gratuito termina el {date}. Después de esa fecha, los reportes, "
                        "el panel y la marca personalizada no estarán disponibles hasta que te suscribas.",
    "beta_ending_body2": "Podés suscribirte en cualquier momento antes de esa fecha desde la página de "
                        "Facturación de tu cuenta — tus datos y sitios se mantienen igual de cualquier forma.",
    "beta_ending_footer": "Enviado una sola vez, una semana antes de que termine tu acceso beta. Este es un "
                        "aviso único.",
    "beta_ended_title": "Tu acceso beta terminó",
    "beta_ended_body1": "Tu acceso beta gratuito terminó. Tus datos y sitios están a salvo, pero los "
                        "reportes, el panel y la marca personalizada no estarán disponibles hasta que "
                        "te suscribas.",
    "beta_ended_body2": "Suscribite en cualquier momento desde la página de Facturación de tu cuenta para "
                        "continuar justo donde lo dejaste.",
    "beta_ended_footer": "Enviado una sola vez, cuando terminó tu acceso beta. Este es un aviso único.",
    "alert_severity_critical": "Crítica",
    "alert_severity_warning": "Advertencia",
    "alert_section_new": "Alertas nuevas",
    "alert_section_resolved": "Volvió a la normalidad",
    "alert_multi_subject": "{n} novedades en tus sistemas",
    "alert_view_site": "Ver sitio",
    "alert_reconnect": "Reconectar VRM",
    "alert_footer": "Recibes esto porque las alertas están activadas en tu cuenta.",
    "alert_site_offline_push": "Sitio sin reportar",
    "alert_site_offline_push_resolved": "Sitio de nuevo en línea",
    "alert_grid_outage_push": "Corte de red",
    "alert_grid_outage_push_resolved": "Volvió la red",
    "alert_low_battery_push": "Batería baja",
    "alert_low_battery_critical_push": "Batería críticamente baja",
    "alert_low_battery_push_resolved": "Batería recuperada",
    "alert_system_alarm_push": "Alarma del sistema",
    "alert_system_alarm_push_resolved": "Alarma resuelta",
    "alert_vrm_link_broken_push": "Conexión con VRM detenida",
    "alert_vrm_link_broken_push_resolved": "Conexión con VRM restablecida",
    "alert_device_fault_push": "Problema de equipo",
    "alert_device_fault_push_resolved": "Problema de equipo resuelto",
    "victron_attribution": "Datos del Portal VRM de Victron Energy. Victron Energy y VRM son marcas de Victron Energy B.V. Este servicio es independiente y no está afiliado ni respaldado por Victron Energy.",
    "alert_manage": "Elige qué alertas recibir",
    "alert_push_test_title": "Notificación de prueba",
    "alert_push_test_body": "Las alertas llegarán a este dispositivo así.",
    "alert_site_offline_title": "{site} dejó de reportar",
    "alert_site_offline_body": "No llegan datos desde {since} ({minutes} minutos). "
                               "Revisa la conexión a internet y la energía del sitio.",
    "alert_site_offline_resolved": "{site} volvió a reportar",
    "alert_grid_outage_title": "Corte de red en {site}",
    "alert_grid_outage_body": "No hay energía de la red eléctrica. El sistema funciona con su batería{soc_phrase}.",
    "alert_grid_outage_soc_phrase": " (carga: {soc}%)",
    "alert_grid_outage_resolved": "Volvió la red eléctrica en {site}",
    "alert_low_battery_title": "Batería baja en {site}",
    "alert_low_battery_body": "La carga de la batería es {soc}%.",
    "alert_low_battery_critical_title": "Batería críticamente baja en {site}",
    "alert_low_battery_critical_body": "La carga de la batería es {soc}%: el sistema podría apagarse pronto.",
    "alert_low_battery_resolved": "La batería se recuperó en {site}",
    "alert_system_alarm_title": "Alarma del sistema en {site}",
    "alert_system_alarm_body": "Activa: {alarms}.",
    "alert_system_alarm_resolved": "Alarma del sistema resuelta en {site}",
    "alert_device_fault_title": "Problema de equipo en {site}",
    "alert_device_fault_body": "{devices}",
    "alert_device_fault_resolved": "Problema de equipo resuelto en {site}",
    "alert_device_name_charger": "Cargador solar {n}",
    "alert_device_name_charger_single": "Cargador solar",
    "alert_device_name_battery": "Batería",
    "alert_device_name_inverter": "Inversor",
    "alert_device_note_charger_error": "reporta un error ({error})",
    "alert_device_note_not_reporting": "no ha reportado en {minutes} minutos",
    "alert_device_note_no_output": "produjo casi nada ({kwh} kWh) mientras los demás produjeron {others_kwh} kWh",
    "alert_device_note_low_output": "produjo {pct_below}% menos de lo habitual mientras los demás estaban normales",
    "alert_device_note_modules_offline": "solo {online} de {total} módulos están en línea",
    "alert_device_note_battery_failure": "reporta una falla interna",
    "alert_device_note_blocking": "tiene un módulo bloqueando la carga o descarga",
    "alert_device_note_inverter_error": "reporta un error ({error})",
    "alert_device_note_units_missing": "solo {units} de {expected} unidades responden",
    "alert_device_note_inverter_warning": "la unidad {unit} reporta una advertencia",
    "alert_device_note_missing": "ya no aparece en los datos del sistema",
    "alert_alarm_overload": "sobrecarga",
    "alert_alarm_dc_ripple": "rizado de CC",
    "alert_alarm_temp_fault": "falla de temperatura",
    "alert_alarm_cell_imbalance": "desbalance de celdas",
    "alert_vrm_link_broken_title": "Tu conexión con Victron VRM dejó de funcionar",
    "alert_vrm_link_broken_body": "Las actualizaciones automáticas están en pausa hasta que vuelvas a conectar tu cuenta de VRM.",
    "alert_vrm_link_broken_resolved": "Tu conexión con Victron VRM funciona de nuevo",
    # Alertas de salud de la flota para el admin (vrm_api/admin_alerts.py).
    "admin_alert_footer": "Recibes esto porque las alertas de salud de la flota están activadas para el admin.",
    "admin_alert_open": "Abrir alertas de la flota",
    "admin_alert_multi_subject": "{n} novedades de salud de la flota",
    "admin_alert_fleet_offline_title": "{offline} de {total} sitios se quedaron sin reportar a la vez",
    "admin_alert_fleet_offline_body": "Sin reportar ahora: {sites}. Que varios sitios se detengan a la vez suele indicar un problema de VRM, de credenciales o de conectividad, no de los sitios.",
    "admin_alert_fleet_offline_resolved": "Los sitios vuelven a reportar",
    "admin_alert_fetch_failing_title": "No se pudo leer la mayoría de los sitios ({failed} de {attempted})",
    "admin_alert_fetch_failing_body": "El último barrido falló al leer {failed} de {attempted} sitios. Revisa el estado de VRM, el token de VRM del admin y los logs de la API.",
    "admin_alert_fetch_failing_resolved": "La lectura de los sitios vuelve a funcionar",
    "admin_alert_sweep_stale_title": "El barrido de datos en vivo se detuvo",
    "admin_alert_sweep_stale_body": "El barrido de 15 minutos corrió por última vez hace {minutes} minutos, así que todos los paneles y alertas están desactualizados. Revisa el job del programador y el servicio de la API.",
    "admin_alert_sweep_stale_resolved": "El barrido de datos en vivo corre de nuevo",
    "admin_alert_history_stale_title": "El historial diario está atrasado",
    "admin_alert_history_stale_body": "Las cifras diarias más recientes son del {day} (hace {days} días). Revisa el job de sincronización del historial diario.",
    "admin_alert_history_stale_resolved": "El historial diario está al día",
})

TRANSLATIONS = {"en": EN, "es": ES}


def get(lang: str) -> dict:
    """Translation dict for `lang` — falls back to English for anything
    unrecognized, same fallback `report_i18n.get()` uses."""
    return TRANSLATIONS.get(lang, EN)
