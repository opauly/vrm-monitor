from __future__ import annotations
"""
Strings for the transactional emails this repo's Python side renders and
sends (2026-09-30) — `report_email.html`, `cap_reached_email.html`,
`trial_ending_with_card_email.html`, `trial_ending_no_card_email.html`. A
separate, flat dict from `report_i18n.py` on purpose: that module's
`get(lang, num_days, is_overview)` period/overview-variant machinery exists
for the PDF report body, which these emails aren't — every key here is
period-neutral, so a plain `t(lang, key)` is all any of them need.

Every one of this module's four callers (`vrm_api/report_delivery.py`'s
`send_report_email()`/`notify_cap_reached_once()`, `vrm_api/billing.py`'s
`send_trial_ending_reminders()`) already has the recipient's own stored
language in scope by the time it renders — `site.get("report_language")`
for the report email (the exact field `weekly_report.py` already reads for
the PDF itself), `customer.get("ui_language")` for the other three
(account-level notices, not tied to one site). Nothing here needed a new
place to capture a language choice, same finding as the TypeScript-side
transactional emails this mirrors (`victron-monitor/web/lib/server/
emailTemplates.ts`).

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
})

TRANSLATIONS = {"en": EN, "es": ES}


def get(lang: str) -> dict:
    """Translation dict for `lang` — falls back to English for anything
    unrecognized, same fallback `report_i18n.get()` uses."""
    return TRANSLATIONS.get(lang, EN)
