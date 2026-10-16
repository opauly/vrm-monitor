# Privacy policy and terms — proposed updates (DRAFT, 2026-10-16)

Status: **draft for review. Not applied to the site.** The live privacy page is itself marked as an unreviewed draft, and
everything below should go through the same lawyer review before it replaces anything. Each block says where it goes,
gives the English wording, then the Spanish. The wording only states what the system does today; the "What this relies
on" notes say where each claim comes from so it can be checked.

---

## A. Privacy policy

### A1. Section 2, "Data we collect" — three additions

**Site location** (new item)

> **Site location** — the latitude and longitude of each site, as stored in your VRM installation or entered by you, and its time zone. We use it for weather, solar-output estimates and forecasts.

> **Ubicación del sitio** — la latitud y longitud de cada sitio, tal como figuran en tu instalación de VRM o como las ingresaste, y su zona horaria. Las usamos para el clima, las estimaciones de producción solar y los pronósticos.

**Equipment and alert data** (new item)

> **Equipment and alert data** — the status of the batteries, inverters and solar chargers in your system (for example, which battery modules are online and how much each charger produced), the alerts we raise from it, and the settings you choose for them.

> **Datos de equipos y alertas** — el estado de las baterías, inversores y cargadores solares de tu sistema (por ejemplo, qué módulos de batería están en línea y cuánto produjo cada cargador), las alertas que generamos a partir de ello y las preferencias que elijas.

**Notification data** (new item)

> **Notification data** — if you turn on push notifications, a technical address for your browser or phone that your device's push service issues, together with the public encryption keys that go with it and the device type. It lets us send notifications to that device only; it is not a login. You can turn notifications off at any time, and the address is deleted when you do or when the device stops accepting them.

> **Datos de notificaciones** — si activás las notificaciones push, una dirección técnica de tu navegador o teléfono que emite el servicio de notificaciones de tu dispositivo, junto con las claves públicas de cifrado asociadas y el tipo de dispositivo. Nos permite enviar notificaciones solo a ese dispositivo; no es una credencial de acceso. Podés desactivar las notificaciones en cualquier momento, y la dirección se elimina cuando lo hacés o cuando el dispositivo deja de aceptarlas.

*What this relies on:* `vrm.sites` latitude/longitude/timezone; `vrm.site_devices`; `vrm.alerts`, `vrm.alert_preferences`;
`vrm.push_subscriptions` (endpoint, p256dh, auth, user_agent; rows deleted on unsubscribe or on a 404/410 from the push service).

### A2. Section 3, "How we use it" — replace item 3 and add two

> 3. To send account-related email (verification, billing receipts, service notices) **and the alert and report emails you have asked for;**
> 5. **To raise alerts and send notifications about your systems, and to produce daily summaries, forecasts and equipment checks.**

> 3. Para enviar correos relacionados con la cuenta (verificación, recibos, avisos del servicio) **y los correos de alertas y reportes que solicitaste;**
> 5. **Para generar alertas y enviar notificaciones sobre tus sistemas, y para producir resúmenes diarios, pronósticos y revisiones de equipos.**

Keep the existing closing sentence ("We don't sell your data, and we don't use your telemetry data to train AI models").

### A3. Section 4, "Who we share data with" — one change and five additions

**Change — Anthropic** (currently "generates the narrative text in your reports"):

> **Anthropic (Claude)** — writes the narrative in your reports and the daily summaries shown in the app, from figures computed from your system's data (energy totals, scores, alerts and equipment findings, and the names you gave your sites). Data sent for this purpose is used only to produce that text, not to train Anthropic's models.

> **Anthropic (Claude)** — redacta la narrativa de tus reportes y los resúmenes diarios que se muestran en la aplicación, a partir de cifras calculadas con los datos de tu sistema (totales de energía, puntajes, alertas y hallazgos de equipos, y los nombres que le diste a tus sitios). Los datos enviados con este fin se usan solo para producir ese texto, no para entrenar los modelos de Anthropic.

*What this relies on:* `victron/insight_ai.py` sends the computed facts as JSON; `weekly_report.generate_narrative` sends the period stats.
Site display names are in those facts. No email addresses or account details are.

**Change — Resend** (currently "transactional email (verification links, receipts, service notices)"):

> **Resend** — delivers email: verification links, receipts, service notices, and the alert and report emails you have asked for.

> **Resend** — entrega el correo: enlaces de verificación, recibos, avisos del servicio y los correos de alertas y reportes que solicitaste.

**New — Open-Meteo**

> **Open-Meteo** — provides weather data and forecasts. We send it the coordinates of a site (rounded to about 10 metres) and its time zone; it returns weather for that place. No account or personal details are sent.

> **Open-Meteo** — proporciona datos y pronósticos del clima. Le enviamos las coordenadas de un sitio (redondeadas a unos 10 metros) y su zona horaria; devuelve el clima de ese lugar. No se envían datos de cuenta ni personales.

**New — PVGIS (European Commission)**

> **PVGIS (European Commission Joint Research Centre)** — a public solar-radiation service we use to estimate how much a site should produce. We send it a site's coordinates and receive typical sunlight figures.

> **PVGIS (Centro Común de Investigación de la Comisión Europea)** — un servicio público de radiación solar que usamos para estimar cuánto debería producir un sitio. Le enviamos las coordenadas del sitio y recibimos cifras típicas de luz solar.

*What this relies on:* `victron/open_meteo.py` (forecast, 4-decimal coordinates), `victron/weekly_report.fetch_weather`
(archive), `victron/vrm_shared/pvgis.py`. Four decimals is about 11 m; confirm before publishing the "10 metres" wording.

**New — Browser and phone push services**

> **Your browser's or phone's push service (Apple, Google or Mozilla)** — if you turn on push notifications, the message goes through the push service your device uses, which delivers it. Messages are encrypted so that only your device can read them; the service sees that a notification was sent to your device, not its content.

> **El servicio de notificaciones de tu navegador o teléfono (Apple, Google o Mozilla)** — si activás las notificaciones push, el mensaje pasa por el servicio de notificaciones que usa tu dispositivo, que lo entrega. Los mensajes van cifrados para que solo tu dispositivo pueda leerlos; el servicio sabe que se envió una notificación a tu dispositivo, no su contenido.

*What this relies on:* Web Push with encrypted payloads (`vrm_api/alerts_push.py`, p256dh/auth keys).

**New — Hosting** (these two were already missing before this update)

> **Vercel and Render** — host the website and the service that processes your data. Your data passes through them when you use VRM Monitor.

> **Vercel y Render** — alojan el sitio web y el servicio que procesa tus datos. Tus datos pasan por ellos cuando usás VRM Monitor.

> Scheduled jobs (for example GitHub Actions and a cron service) only trigger the service on a timer; they do not receive your data.

### A4. Section 5, "Data retention" — add a sentence

> Alerts and their history, equipment status and daily summaries are kept for as long as your account is active. Push notification addresses are deleted when you turn notifications off or your device stops accepting them.

> Las alertas y su historial, el estado de los equipos y los resúmenes diarios se conservan mientras tu cuenta esté activa. Las direcciones de notificaciones push se eliminan cuando desactivás las notificaciones o tu dispositivo deja de aceptarlas.

### A5. Section 8, "Cookies" — add a sentence

> If you install VRM Monitor on your phone or turn on notifications, your browser also stores a small service worker and a temporary note of which page a notification should open. These are not used for tracking.

> Si instalás VRM Monitor en tu teléfono o activás las notificaciones, tu navegador también guarda un pequeño service worker y una nota temporal de qué página debe abrir una notificación. No se usan para rastreo.

---

## B. Terms of service

### B1. Section 2, "The service" — extend the description

> VRM Monitor connects to your Victron VRM account, reads the telemetry your Victron system already exports, and turns it into a live dashboard, **alerts,** and branded, AI-narrated reports delivered on a schedule. **Which features are included depends on your plan.** You control which VRM installations are connected and can disconnect them at any time.

> VRM Monitor se conecta a tu cuenta de Victron VRM, lee la telemetría que tu sistema Victron ya exporta y la convierte en un panel en vivo, **alertas** y reportes con tu marca narrados por IA que se entregan según un calendario. **Las funciones incluidas dependen de tu plan.** Vos controlás qué instalaciones de VRM están conectadas y podés desconectarlas en cualquier momento.

### B2. Section 8, "AI-generated content" — widen

> Report narratives, daily summaries and insights are generated with AI based on your system's telemetry. We work to keep them accurate, but AI output can occasionally be wrong or misleading. Forecasts and estimates (weather, expected solar output, battery time) are approximations built from a weather forecast and your system's own history; they are not guarantees. Don't rely on them alone for decisions with safety or financial consequences — treat them as a summary, and check the underlying data in VRM for anything that matters.

> Las narrativas de los reportes, los resúmenes diarios y los hallazgos se generan con IA a partir de la telemetría de tu sistema. Procuramos que sean precisos, pero la salida de IA puede ser incorrecta o engañosa. Los pronósticos y estimaciones (clima, producción solar esperada, tiempo de batería) son aproximaciones construidas con un pronóstico del clima y el historial de tu propio sistema; no son garantías. No te bases solo en ellos para decisiones con consecuencias de seguridad o financieras — tomalos como un resumen, y verificá los datos de base en VRM para todo lo importante.

### B3. New section "Alerts and monitoring" (after Availability)

> **Alerts and monitoring.** Alerts, equipment checks and notifications are best-effort aids. They depend on data your system sends to Victron's VRM Portal, on that service being reachable, on our own servers, and on your email and phone notification services; any of these can be delayed, incomplete or unavailable, and a problem can occur without an alert being sent. VRM Monitor is not a safety, fire, medical or emergency system and is not a substitute for proper protection devices, alarms, inspection or maintenance of your installation. Equipment checks only cover what your system reports (for example, battery module counts depend on the battery's management system), and a system that is not reporting cannot be checked.

> **Alertas y monitoreo.** Las alertas, las revisiones de equipos y las notificaciones son ayudas de mejor esfuerzo. Dependen de los datos que tu sistema envía al Portal VRM de Victron, de que ese servicio esté disponible, de nuestros propios servidores y de tus servicios de correo y notificaciones del teléfono; cualquiera de ellos puede retrasarse, estar incompleto o no estar disponible, y un problema puede ocurrir sin que se envíe una alerta. VRM Monitor no es un sistema de seguridad, contra incendios, médico ni de emergencia, y no sustituye dispositivos de protección, alarmas, inspección ni mantenimiento adecuados de tu instalación. Las revisiones de equipos solo cubren lo que tu sistema reporta (por ejemplo, el conteo de módulos de batería depende del sistema de gestión de la batería), y un sistema que no está reportando no se puede revisar.

### B4. Section 9, "Availability" — one clause

Add after the existing text: *"Alerts and forecasts are subject to the same limits."* / *"Las alertas y los pronósticos están sujetos a los mismos límites."*

---

## C. Open points

1. **Open-Meteo licence.** The free Open-Meteo API is for non-commercial use. VRM Monitor is a paid product, so it needs
   Open-Meteo's commercial plan (set `OPEN_METEO_API_KEY` on Render) before this goes live as drafted. This is a
   licensing matter more than a privacy one.
2. **Victron's VRM API terms.** I have not read them. Check whether they ask for attribution or restrict
   storing or processing VRM data, and align section 4 and the footer with them.
3. **"About 10 metres".** Coordinates are sent at four decimal places (≈ 11 m). Confirm wording with the lawyer.
4. **Hosting providers and cross-border transfers.** Vercel, Render, Supabase, Anthropic, Resend, Open-Meteo and the push
   services are outside Costa Rica. The current policy has no transfer statement; the lawyer should decide whether one
   is needed.
5. **Beta tester terms.** The beta programme gets Growth-level features free. Check the beta terms mention alerts and
   AI content in the same way.
6. **"Last updated" date** and the "Draft" banner on the privacy page: update both when the text is approved.
7. **Mentioning Pylontech or any battery brand** in the public terms was deliberately avoided; the text says "the battery's
   management system".
