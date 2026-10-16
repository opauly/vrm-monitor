"""Turns a site's or fleet's facts (`victron/insight_facts.py`) into the short
daily summary shown on the dashboards.

Two writers, one output shape `{headline, points, suggestion}`:

  * `render_template()` — plain text from the observations, English and Spanish.
    Always available, free, and what is shown when AI is off or fails.
  * `generate()` — a language model rewrites the same facts as natural prose.
    Its answer is accepted only if it passes `numbers_ok()`: every number it
    writes must be a number that is in the facts (so it cannot invent or
    miscompute a figure), and it must have the right shape and lengths. Any
    failure — missing key, API error, bad JSON, a stray number — falls back to
    the template, so the card is never blank and never wrong in a way the facts
    would not allow.

Same fail-soft contract as `weekly_report.generate_narrative()`: losing the
fancy version must never lose the summary.
"""
from __future__ import annotations

import json
import logging
import os
import re

from victron import devices, email_i18n

logger = logging.getLogger("victron.insight_ai")

# A summary is often written while someone waits for the page: a model that has not answered by then loses to the
# plain template, which is always right. No retries for the same reason.
MODEL_TIMEOUT_S = 15.0
DEFAULT_MODEL = "claude-haiku-4-5-20251001"
MAX_POINTS = 3
MAX_HEADLINE, MAX_POINT = 130, 170

# ── template text ────────────────────────────────────────────────────────────
OBS = {
    "en": {
        "offline": "No reading for {minutes} minutes — the system has stopped reporting.",
        "offline_days": "No reading for {days} days — the system has stopped reporting.",
        "alert_grid_outage": "The grid is out right now.",
        "alert_low_battery": "The battery is low right now.",
        "alert_system_alarm": "The system is reporting an alarm.",
        "alert_vrm_link_broken": "The connection to VRM needs to be reconnected.",
        "alert_device_fault": "A piece of equipment (battery, inverter or solar charger) needs attention — see the Equipment table.",
        "anomaly_unexpected_silence": "Solar produced nothing when it should have been producing.",
        "anomaly_quiet_drift": "Solar output has been slowly drifting down.",
        "anomaly_underperformance": "Solar is producing less than expected for this system.",
        "anomaly_incomplete_charging": "The battery has not been reaching a full charge.",
        "outage_held": "The grid was out for {minutes} minutes and the battery kept the loads running (lowest charge {min_soc}%).",
        "outage_deep": "The grid was out for {minutes} minutes and the battery went down to {min_soc}%.",
        "battery_low": "The battery dropped to {min_soc}% at its lowest.",
        "generator_used": "The batteries were topped up from the generator: {kwh} kWh over about {hours} hours.",
        "generator_used_kwh": "The batteries were topped up from the generator: {kwh} kWh.",
        "generator_reliance": "The generator was needed on {days} of the last {window} days.",
        "at_reserve": "The battery rested at {min_soc}%, the minimum charge the system is set to keep — the grid covered the rest.",
        "solar_below": "Solar made {pv} kWh, well below the recent average of {average} kWh.",
        "solar_above": "Solar made {pv} kWh, above the recent average of {average} kWh.",
        "load_above": "Usage was {load} kWh, higher than the recent average of {average} kWh.",
        "load_below": "Usage was {load} kWh, lower than the recent average of {average} kWh.",
        "import_high": "{share_pct}% of the load came from the grid ({import_kwh} kWh).",
        "export": "{export_kwh} kWh went back to the grid — {share_pct}% of what the panels produced.",
        "no_float": "The battery did not reach a full charge.",
        "self_sufficient": "{pct}% of the load was covered by solar and battery.",
        "storm_ahead": "A thunderstorm is forecast in the next day and a half.",
        "tonight_short": "At your usual evening use, the battery is expected to run out about {hours} hours from now, before sunrise.",
        "tomorrow_low_solar": "Tomorrow looks duller than usual: about {pv} kWh of solar expected, against a typical {typical} kWh.",
        "tomorrow_high_solar": "Tomorrow looks sunnier than usual: about {pv} kWh of solar expected, against a typical {typical} kWh.",
        "fleet_storm": "Thunderstorms are forecast at {count} sites: {sites}.",
        "fleet_storm_one": "A thunderstorm is forecast at {sites}.",
        "fleet_silent": "{count} sites have stopped reporting: {sites}.",
        "fleet_silent_one": "1 site has stopped reporting: {sites}.",
        "fleet_attention": "{count} sites have something that needs attention.",
        "fleet_attention_one": "1 site has something that needs attention.",
        "fleet_ok": "All {online} sites are reporting normally.",
    },
    "es": {
        "offline": "Sin lecturas desde hace {minutes} minutos — el sistema dejó de reportar.",
        "offline_days": "Sin lecturas desde hace {days} días — el sistema dejó de reportar.",
        "alert_grid_outage": "La red eléctrica está caída ahora mismo.",
        "alert_low_battery": "La batería está baja ahora mismo.",
        "alert_system_alarm": "El sistema está reportando una alarma.",
        "alert_vrm_link_broken": "Hay que volver a conectar la conexión con VRM.",
        "alert_device_fault": "Un equipo (batería, inversor o cargador solar) necesita atención — vea la tabla de Equipos.",
        "anomaly_unexpected_silence": "La producción solar fue nula cuando debía estar produciendo.",
        "anomaly_quiet_drift": "La producción solar ha ido bajando poco a poco.",
        "anomaly_underperformance": "La producción solar es menor a la esperada para este sistema.",
        "anomaly_incomplete_charging": "La batería no ha estado llegando a la carga completa.",
        "outage_held": "La red estuvo caída {minutes} minutos y la batería mantuvo las cargas funcionando (carga mínima {min_soc}%).",
        "outage_deep": "La red estuvo caída {minutes} minutos y la batería bajó hasta {min_soc}%.",
        "battery_low": "La batería bajó hasta {min_soc}% en su punto más bajo.",
        "generator_used": "Las baterías se recargaron con el generador: {kwh} kWh durante unas {hours} horas.",
        "generator_used_kwh": "Las baterías se recargaron con el generador: {kwh} kWh.",
        "generator_reliance": "Se necesitó el generador en {days} de los últimos {window} días.",
        "at_reserve": "La batería se mantuvo en {min_soc}%, la carga mínima que el sistema está configurado para conservar; la red cubrió el resto.",
        "solar_below": "La energía solar fue de {pv} kWh, bastante por debajo del promedio reciente de {average} kWh.",
        "solar_above": "La energía solar fue de {pv} kWh, por encima del promedio reciente de {average} kWh.",
        "load_above": "El consumo fue de {load} kWh, más alto que el promedio reciente de {average} kWh.",
        "load_below": "El consumo fue de {load} kWh, más bajo que el promedio reciente de {average} kWh.",
        "import_high": "{share_pct}% de la carga vino de la red ({import_kwh} kWh).",
        "export": "{export_kwh} kWh volvieron a la red — {share_pct}% de lo que produjeron los paneles.",
        "no_float": "La batería no llegó a la carga completa.",
        "self_sufficient": "{pct}% de la carga lo cubrieron la energía solar y la batería.",
        "storm_ahead": "Se pronostica una tormenta eléctrica en el próximo día y medio.",
        "tonight_short": "Con tu consumo habitual de la noche, se espera que la batería se agote en unas {hours} horas, antes del amanecer.",
        "tomorrow_low_solar": "Mañana se ve más opaco de lo normal: se esperan unos {pv} kWh de solar, frente a unos {typical} kWh típicos.",
        "tomorrow_high_solar": "Mañana se ve con más sol de lo normal: se esperan unos {pv} kWh de solar, frente a unos {typical} kWh típicos.",
        "fleet_storm": "Se pronostican tormentas eléctricas en {count} sitios: {sites}.",
        "fleet_storm_one": "Se pronostica una tormenta eléctrica en {sites}.",
        "fleet_silent": "{count} sitios dejaron de reportar: {sites}.",
        "fleet_silent_one": "1 sitio dejó de reportar: {sites}.",
        "fleet_attention": "{count} sitios tienen algo que requiere atención.",
        "fleet_attention_one": "1 sitio tiene algo que requiere atención.",
        "fleet_ok": "Los {online} sitios reportan con normalidad.",
    },
}
SUGGEST = {
    "en": {
        "offline": "Check the site's internet connection and power.",
        "offline_days": "Check the site's internet connection and power, or contact your installer.",
        "storm_ahead": "Keeping the battery topped up before a storm gives you more backup time.",
        "tonight_short": "Keeping heavy loads off tonight will help the battery last until sunrise.",
        "tomorrow_low_solar": "With less sun than usual, go easy on heavy loads, especially tonight.",
        "tomorrow_high_solar": "Tomorrow is a good day to run heavy loads around midday.",
        "solar_below": "If this keeps up, check the panels for dirt or shade.",
        "import_high": "Running heavy loads around midday uses more of your own solar.",
        "battery_low": "Keeping the battery topped up ahead of an outage gives you more backup time.",
        "generator_reliance": "Frequent generator top-ups usually mean the solar and batteries cannot cover the load — worth checking the panels, the battery health and the heaviest loads.",
        "outage_deep": "Keeping the battery topped up ahead of an outage gives you more backup time.",
        "load_above": "Check whether something is running that normally isn't.",
        "no_float": "A sunny stretch usually tops the battery up; if it keeps happening, a technician check is worth it.",
        "anomaly_incomplete_charging": "If the battery keeps missing a full charge, a technician check is worth it.",
        "anomaly_underperformance": "A technician can check panels and wiring if this continues.",
    },
    "es": {
        "offline": "Revisa la conexión a internet y la energía del sitio.",
        "offline_days": "Revisa la conexión a internet y la energía del sitio, o contacta a tu instalador.",
        "storm_ahead": "Mantener la batería cargada antes de una tormenta te da más tiempo de respaldo.",
        "tonight_short": "Evitar las cargas pesadas esta noche ayudará a que la batería dure hasta el amanecer.",
        "tomorrow_low_solar": "Con menos sol de lo normal, modera las cargas pesadas, sobre todo esta noche.",
        "tomorrow_high_solar": "Mañana es un buen día para usar las cargas pesadas alrededor del mediodía.",
        "solar_below": "Si esto continúa, revisa si los paneles tienen suciedad o sombra.",
        "import_high": "Usar las cargas pesadas alrededor del mediodía aprovecha más tu propia energía solar.",
        "battery_low": "Mantener la batería cargada antes de un corte te da más tiempo de respaldo.",
        "generator_reliance": "Las recargas frecuentes con generador suelen indicar que la energía solar y las baterías no alcanzan para la carga — conviene revisar los paneles, la salud de la batería y las cargas más grandes.",
        "outage_deep": "Mantener la batería cargada antes de un corte te da más tiempo de respaldo.",
        "load_above": "Revisa si hay algo encendido que normalmente no lo está.",
        "no_float": "Un periodo soleado suele completar la carga; si sigue pasando, vale la pena una revisión técnica.",
        "anomaly_incomplete_charging": "Si la batería sigue sin cargarse por completo, vale la pena una revisión técnica.",
        "anomaly_underperformance": "Un técnico puede revisar paneles y cableado si esto continúa.",
    },
}
HEAD = {
    "en": {"none": "No complete day of data yet.", "site": "{when}: {pv} kWh of solar, {load} kWh used.",
           "site_ss": "{when}: {pv} kWh of solar, {load} kWh used — {ss}% covered by solar and battery.",
           "fleet": "{n} sites made {pv} kWh of solar and used {load} kWh on {date}.", "yesterday": "Yesterday", "on": "On {date}"},
    "es": {"none": "Aún no hay un día completo de datos.", "site": "{when}: {pv} kWh de solar, {load} kWh de consumo.",
           "site_ss": "{when}: {pv} kWh de solar, {load} kWh de consumo — {ss}% cubierto por solar y batería.",
           "fleet": "{n} sitios generaron {pv} kWh de solar y consumieron {load} kWh el {date}.", "yesterday": "Ayer", "on": "El {date}"},
}
# Short reason labels for the fleet's "needs attention" lines.
SHORT = {
    "en": {"offline": "stopped reporting", "offline_days": "stopped reporting", "storm_ahead": "storm forecast", "tonight_short": "battery may not last the night", "alert_grid_outage": "grid out", "alert_low_battery": "low battery", "alert_system_alarm": "alarm", "alert_device_fault": "equipment problem", "device_fault": "equipment fault",
           "alert_vrm_link_broken": "VRM disconnected", "outage_deep": "battery ran low in an outage", "battery_low": "low battery", "generator_reliance": "frequent generator use",
           "solar_below": "solar well below normal", "import_high": "mostly on grid power", "anomaly_unexpected_silence": "no solar output",
           "anomaly_quiet_drift": "solar drifting down", "anomaly_underperformance": "solar underperforming", "anomaly_incomplete_charging": "battery not filling"},
    "es": {"offline": "dejó de reportar", "offline_days": "dejó de reportar", "storm_ahead": "tormenta pronosticada", "tonight_short": "la batería podría no durar la noche", "alert_grid_outage": "red caída", "alert_low_battery": "batería baja", "alert_system_alarm": "alarma", "alert_device_fault": "problema de equipo", "device_fault": "falla de equipo",
           "alert_vrm_link_broken": "VRM desconectado", "outage_deep": "batería baja en un corte", "battery_low": "batería baja", "generator_reliance": "uso frecuente del generador",
           "solar_below": "solar muy por debajo de lo normal", "import_high": "casi todo con energía de la red", "anomaly_unexpected_silence": "sin producción solar",
           "anomaly_quiet_drift": "solar bajando", "anomaly_underperformance": "solar con bajo rendimiento", "anomaly_incomplete_charging": "batería sin llenarse"},
}


def _fill(template: str, params: dict) -> str:
    out = template
    for key, value in params.items():
        out = out.replace("{" + key + "}", _fmt(value))
    return out


def _fmt(value) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    return str(value)


def _obs_text(obs_text: dict, o: dict, lang: str = "en") -> str | None:
    code = o["code"]
    if code == "alert_device_fault" and o["params"].get("equipment"):
        # Name the equipment ("Solar charger 2 made almost nothing ...") rather than a generic line.
        return devices.describe_devices(email_i18n.get(lang), o["params"]["equipment"])
    if code == "generator_used" and not o["params"].get("hours"):
        code = "generator_used_kwh"        # the running time is not recorded for every day
    if o["params"].get("count") == 1 and f"{code}_one" in obs_text:
        code = f"{code}_one"
    return _fill(obs_text[code], o["params"]) if code in obs_text else None


def render_template(facts: dict, lang: str, scope: str, *, today: str | None = None) -> dict:
    """The deterministic summary. `today` (ISO date) lets a day read as "Yesterday"."""
    lang = lang if lang in OBS else "en"
    head, obs_text = HEAD[lang], OBS[lang]
    day = facts.get("day")
    observations = facts.get("observations") or []

    if not day:
        headline = head["none"]
    elif scope == "fleet":
        headline = _fill(head["fleet"], {"n": day["sites_counted"], "pv": day["pv_kwh"], "load": day["load_kwh"], "date": day["date"]})
    else:
        when = head["on"].format(date=day["date"])
        if today:
            from datetime import date, timedelta
            try:
                if date.fromisoformat(day["date"]) == date.fromisoformat(today) - timedelta(days=1):
                    when = head["yesterday"]
            except ValueError:
                pass
        key = "site_ss" if day.get("self_sufficiency_pct") is not None else "site"
        headline = _fill(head[key], {"when": when, "pv": day["pv_kwh"], "load": day["load_kwh"], "ss": day.get("self_sufficiency_pct")})

    if scope == "fleet":
        points = [t for t in (_obs_text(obs_text, o, lang) for o in observations) if t][:MAX_POINTS]
        for entry in (facts.get("needs_attention") or [])[: max(0, MAX_POINTS - len(points))]:
            reason = SHORT[lang].get(entry["reasons"][0], entry["reasons"][0])
            points.append(f"{entry['site']}: {reason}.")
    else:
        points = [t for t in (_obs_text(obs_text, o, lang) for o in observations) if t][:MAX_POINTS]

    suggestion = None
    for o in observations:
        if o["code"] in SUGGEST[lang]:
            suggestion = SUGGEST[lang][o["code"]]
            break
    return {"headline": headline, "points": points, "suggestion": suggestion}


# ── AI ───────────────────────────────────────────────────────────────────────
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


def _walk_numbers(value, out: set[float]) -> None:
    if isinstance(value, bool) or value is None:
        return
    if isinstance(value, (int, float)):
        # A change of -30 is written "down 30%": the magnitude is the same fact.
        out.add(abs(float(value)))
    elif isinstance(value, str):
        for m in _NUMBER.findall(value):
            out.add(float(m.replace(",", ".")))
    elif isinstance(value, dict):
        for v in value.values():
            _walk_numbers(v, out)
    elif isinstance(value, (list, tuple)):
        for v in value:
            _walk_numbers(v, out)


def unexplained_numbers(texts: list[str], facts: dict) -> list[str]:
    """The numbers in `texts` that the facts do not account for (as written)."""
    allowed: set[float] = {0.0, 1.0}
    _walk_numbers(facts, allowed)
    bad: list[str] = []
    for text in texts:
        for raw in _NUMBER.findall(text):
            x = float(raw.replace(",", "."))
            decimals = len(raw.replace(",", ".").split(".")[1]) if "." in raw.replace(",", ".") else 0
            if decimals == 0:
                # A whole number is fine if it is a fact, or a fact rounded (or cut) to a whole number.
                ok = any(x == round(a) or x == int(a) for a in allowed)
            else:
                ok = any(abs(x - a) <= 0.051 or x == round(a, decimals) for a in allowed)
            if not ok:
                bad.append(raw)
    return bad


def numbers_ok(texts: list[str], facts: dict) -> bool:
    """True if every number in `texts` appears in `facts` (to rounding), or is 0/1."""
    return not unexplained_numbers(texts, facts)


def _system_prompt(lang: str, scope: str) -> str:
    audience = "the owner of a solar + battery system" if scope == "site" else "the owner or installer of a fleet of solar + battery systems"
    language = "Spanish (neutral Latin American)" if lang == "es" else "English"
    return (
        f"You write the short daily summary on a monitoring dashboard. The reader is {audience}. Write in {language}.\n"
        "Use ONLY the FACTS. Never state a number that is not in the FACTS, and do not add, subtract or estimate any figure. "
        "Every point must come from an OBSERVATION or a figure in the facts; never add filler or reassurance of your own (for example 'no waste', 'all good', 'everything is fine'). "
        "A count is the \"count\" field of its OBSERVATION; a list beside it names places, and \"Name (3)\" means 3 sites there — never use the length of a list as a count. "
        "Do not use technical field names. Grid export is a good outcome, not waste. If the system is offline, say that first. "
        "The headline summarises the day (what was produced and used); put actions in the suggestion, not the headline. "
        "Do not call anything normal, good, poor or unusual unless an OBSERVATION in the facts says so, and do not state a time of day "
        "(overnight, morning, afternoon) or a cause that the facts do not give. "
        "If nothing notable happened, say it was a normal day. Suggestions must be low-risk and practical (check the panels, shift "
        "heavy loads to midday, keep the battery topped up, call the installer) — never electrical-safety, warranty or financial advice. "
        "A DRAFT is provided; improve its wording and flow but keep its meaning and facts.\n\n"
        'Reply with JSON only: {"headline": string (max 130 chars), "points": [up to 3 strings, max 170 chars each], "suggestion": string or null (max 170 chars)}'
    )


def _parse(text: str) -> dict | None:
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(text[start:end + 1])
    except ValueError:
        return None
    headline, points, suggestion = data.get("headline"), data.get("points"), data.get("suggestion")
    if not isinstance(headline, str) or not headline.strip() or len(headline) > MAX_HEADLINE:
        return None
    if not isinstance(points, list) or len(points) > MAX_POINTS or not all(isinstance(p, str) and 0 < len(p) <= MAX_POINT for p in points):
        return None
    if suggestion is not None and (not isinstance(suggestion, str) or len(suggestion) > MAX_POINT):
        return None
    return {"headline": headline.strip(), "points": [p.strip() for p in points], "suggestion": (suggestion or "").strip() or None}


def generate(facts: dict, lang: str, scope: str, *, today: str | None = None, client=None, model: str | None = None) -> dict:
    """The summary, AI-written when possible. Returns `{headline, points,
    suggestion, source, model}`; `source` is "ai" or "template"."""
    draft = render_template(facts, lang, scope, today=today)
    fallback = {**draft, "source": "template", "model": None}
    key = os.environ.get("ANTHROPIC_API_KEY")
    if client is None and not key:
        return fallback
    model = model or os.environ.get("INSIGHTS_MODEL") or DEFAULT_MODEL
    try:
        if client is None:
            import anthropic
            client = anthropic.Anthropic(api_key=key, timeout=MODEL_TIMEOUT_S, max_retries=0)
        message = client.messages.create(
            model=model, max_tokens=500, system=_system_prompt(lang, scope),
            messages=[{"role": "user", "content": "FACTS:\n" + json.dumps(facts, ensure_ascii=False, default=str) +
                       "\n\nDRAFT:\n" + json.dumps(draft, ensure_ascii=False)}])
        parsed = _parse(message.content[0].text)
    except Exception:  # noqa: BLE001 — AI is an enhancement; the template always works
        logger.warning("insight_ai: model call failed — using the template", exc_info=True)
        return fallback
    if parsed is None:
        logger.warning("insight_ai: model reply was not the expected JSON — using the template")
        return fallback
    bad = unexplained_numbers([parsed["headline"], *parsed["points"], parsed["suggestion"] or ""], facts)
    if bad:
        logger.warning("insight_ai: model wrote numbers that are not in the facts (%s) — using the template", ", ".join(bad))
        return fallback
    return {**parsed, "source": "ai", "model": model}
