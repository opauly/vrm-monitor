# Victron developer resources — digested reference

Source: [Victron developer resources](https://docs.google.com/document/d/1OwUFOfVsLl-dbJ9mk6PyGBoV-X-KeO60hYhwO9BkfbQ/edit) (Google Doc, Victron-maintained link index). Digested 2026-09-01 by fetching every real content link (GitHub wikis/repos, docs pages, blog, community pages). YouTube/Vimeo links are **not** digested — fetching a video URL only returns page metadata, not transcript content — they're listed as pointers only.

Each section below maps to a real ingestion path or dev surface in **this** project, noted at the top of the section.

---

## VRM API development
**Used by**: `victron/vrm_remote.py`, `vrm_series.py`, `vrm_live.py`, `vrm_shape.py` — everything under `source='vrm_api'` (VRM Fleet, weekly reports for VRM-linked sites).

### Primary reference: [vrm-api-docs.victronenergy.com](https://vrm-api-docs.victronenergy.com/#/)
The authoritative source — not community guesses. Structured as an OpenAPI 3.1 spec (`Elements`-rendered UI, so `WebFetch` on the rendered page returns nothing useful — fetch the actual spec instead, see below).

- **Auth**: `x-authorization` header, `Token <value>` format (the deprecated `Bearer <value>` format is being phased out — this codebase's own `VRM_ADMIN_TOKEN`/customer tokens should confirm which format `vrm_remote.py` currently sends).
- **Rate limit**: rolling window, ~200 requests, refills one slot every 0.33s (≈3 req/s sustained average). A 429 carries a `Retry-After` header.
- **Related but separate service**: bulk report/export generation (CSV/XLSX energy + alarm exports) now lives in a *different* API — `vrm-reports-api.victronenergy.com` — not the same base URL as the main VRM API.
- **`GET /installations/{idSite}/stats`** (`type=custom`) — the endpoint this project's live snapshot and shape-chart code both call:
  - `attributeCodes[]` — repeated param, required for `type=custom`.
  - **`show_instance` (boolean)** — found 2026-09-01, not previously known to this codebase: groups `records`/`totals` by device instance instead of one merged series. This is the ONLY documented way to disambiguate a code that exists on more than one physical device (e.g. two solar chargers both reporting `PVP`). A bare `instance=N` query param is silently ignored — confirmed live against real production data, do not rely on it.
  - Response quirk: a code with no data in the window returns the literal boolean `false`, not an empty array — every caller in this codebase already handles this (`_series_to_pandas()`).
  - Max lookback per `interval`: 31 days (15mins or hours), 180 days (days), 140 days (weeks), 24 months (months), 5 years (years).
- **To get the raw spec directly** (needed since the rendered docs page is JS-only): fetch `https://vrm-api-docs.victronenergy.com/docs/docs/openapi.yaml`, which is an index of `$ref`s into `https://vrm-api-docs.victronenergy.com/docs/Commands/<Area>/docs/<Command>.yaml` — e.g. the stats endpoint's full spec is at `.../docs/Commands/Installation/docs/StatsCommand.yaml`.

### Community wrapper: [dirkjanfaber/victron-vrm-api](https://github.com/dirkjanfaber/victron-vrm-api) (Node-RED node, also on [flows.nodered.org](https://flows.nodered.org/node/victron-vrm-api))
Not used directly by this project (we call the REST API straight from Python), but useful as a second reference implementation when an endpoint's behavior is ambiguous:
- Wraps 4 API areas: **Users**, **Installations** (site stats w/ attributes + time range), **Widgets**, **Dynamic ESS**.
- Also covers alarm creation/retrieval and solar forecast data.
- Auth: personal access token from VRM → Preferences → Integrations.
- Escape hatch for unsupported endpoints: raw HTTP via `msg.method`/`msg.query`, built against the same base URL `https://vrmapi.victronenergy.com/v2` this project's `vrm_remote.py` already uses.

---

## Node-RED development
**Used by**: the `monitoring`-schema ingestion path (`database/monitoring_sites_db.py`, `victron/vrm_daily.py`) — sites that push data via a Node-RED flow running on the Cerbo/GX device itself, separate from the `vrm_api`-pulled sites.

### [node-red-contrib-victron wiki](https://github.com/victronenergy/node-red-contrib-victron/wiki) + [Example Flows](https://github.com/victronenergy/node-red-contrib-victron/wiki/Example-Flows)
- Three node categories: **input** (read from Victron devices), **output** (send commands), **virtual devices** (software-defined equipment).
- Real example-flow patterns worth knowing if debugging or extending a Node-RED-sourced site:
  - Persist a value across delayed triggers: input node → change node (context store) → inject node reads it back later.
  - RBE ("Report By Exception") nodes suppress redundant messages unless the value actually changed — relevant if a `monitoring` site's data looks "stuck," check for an RBE node upstream.
  - MQTT in/out nodes can bypass the Victron-specific nodes entirely for a generic D-Bus query.
  - GPS-based flows recompute sunrise/sunset dynamically and store coordinates in flow context (relevant only for mobile installations).

### [Venus OS Large — Node-RED section](https://www.victronenergy.com/live/venus-os:large#node-red)
- Enabled via GX device Settings → "Venus OS Large Features."
- Flow editor: `https://venus.local:1881` (accept the self-signed HTTPS warning).
- **Resource limit**: running Signal K + Node-RED together on a GX device will "very likely overload the device."
- **Since Venus OS v2.90**: Node-RED runs as user `nodered`, not `root` — file access is restricted to `/data/home/nodered/`. If a `monitoring` site's flow needs to read/write files, this is the permission boundary to know about.
- Relays must be switched to *manual* control mode (VictronConnect or GX UI) before Node-RED can command them.

### [Blog: Node-RED update, Feb 2024](https://www.victronenergy.com/blog/2024/02/23/node-red-update-for-victron-users/)
- Input nodes now show last-seen value in their status, not just connection state — useful for live debugging a flow without extra logging.
- New "Context store" option on the Victron Energy Client config persists latest values to `global.victronenergy.*` (e.g. `victronenergy.tank._25.BatteryVoltage`), readable without waiting for a fresh message.
- Dashboard migrating 1.0 → 2.0 (`@flowfuse/node-red-dashboard`), reachable via VRM's Venus OS Large menu.
- A **Victron Modbus node** also exists (needs `node-red-contrib-modbus`) for direct Modbus TCP read/write — not currently used by this project but an option if a device needs control this project doesn't yet support.

### [Community archive: Node-RED](https://communityarchive.victronenergy.com/smart-spaces/71/node-red.html)
Read-only archive now — active discussion moved to `community.victronenergy.com`. Historical topics: battery charge/discharge automation, MultiPlus/MPPT/ESS control, feeding data into Victron's own DESS optimizer, Cerbo GX vs. PC as the Node-RED host, D-Bus serial troubleshooting.

---

## Venus OS development
**Not currently used by this project** (no direct on-device scripting/driver work) — kept for reference if that ever changes (e.g. a custom driver for a device VRM/Node-RED can't already see).

### [venus wiki](https://github.com/victronenergy/venus/wiki) + [open source intro](https://www.victronenergy.com/live/open_source:start)
- Core architecture is **D-Bus** — every service (device driver, GUI, VRM uploader) talks over D-Bus, not a monolithic app. `dbus-api`/`dbus` wiki pages are the interface spec.
- Explicitly for developers only ("normal end-users... do not need this information").
- **Mixed license model** — "some parts are open source, some are not." Check before assuming a component can be modified/redistributed.
- Victron's own guidance: post your intent on their community forum *before* building, to avoid duplicating existing work.
- Running Venus OS on unsupported hardware (e.g. bare Raspberry Pi outside their supported path) voids official support.

### [CCGX / root access](https://www.victronenergy.com/live/ccgx:root_access)
Only relevant if this project ever needs SSH/root onto a customer's GX device directly (not currently the case — all data access today is via VRM API or Node-RED flows the customer/installer sets up themselves):
- Settings → General → Access Level → "User and installer" (password `ZZZ`), then hold the right button for Superuser.
- Root password is **temporary** — stored on the rootfs, wiped on every firmware update. For persistent access, install an SSH public key under `/data/.ssh/authorized_keys` (the `/data` partition survives image updates; the rootfs does not).
- Custom scripts/startup hooks belong in `/data/rc.local` or `/data/rcS.local` for the same reason.
- Security note if this is ever relevant to a customer conversation: physical access to the serial console (115200 baud) bypasses all network-level security entirely.

---

## MQTT development
**Not currently used by this project.**

### [dbus-flashmq](https://github.com/victronenergy/dbus-flashmq)
Bridges D-Bus ↔ MQTT on-device (runs inside FlashMQ, the broker Venus OS ships). Relevant if this project ever needs to read live values directly from a device over MQTT instead of via VRM API polling:
- Topic shape: `N/<portal ID>/<service_type>/<device instance>/<D-Bus path>` for notifications, `W/...` to write a value, `R/...` to force a re-read.
- **No retained messages** (unlike the old Python bridge it replaced) — a client must publish to `R/<portal ID>/keepalive` to get the current full state; completion is signaled by `N/<portal ID>/full_publish_completed`.
- Local ports 1883/8883; can also forward to Victron's cloud MQTT over TLS.
- Internet-facing MQTT only allows subscribing to your own installation's topics (`N/<portal ID>/#`), not a system-wide wildcard.

---

## Grafana development
**Not currently used by this project** (Fleet Health's own charts are custom-built, not Grafana).

### [venus-grafana](https://github.com/victronenergy/venus-grafana)
An explicitly **unofficial** alternative to VRM Portal's own dashboards, for offline/self-hosted monitoring at 2-second granularity:
- Stack: GX device → MQTT → **Venus Influx Loader** (:8088) → **InfluxDB** (:8086) → **Grafana** (:3000), wired via Docker networking.
- Requires MQTT plaintext enabled on the Venus OS device.
- Known friction points: Docker containers start in random order (expect transient connection warnings), Docker volume permissions are fiddly (bind mounts are more debuggable), and custom dashboards live in Grafana's SQLite store — they're lost on container rebuild unless exported to JSON and committed to the repo.

---

## Configuration and commissioning automation
No links populated in the source doc yet — nothing to digest. Worth re-checking this doc periodically if Victron adds content here, since it's the one section that could plausibly overlap with future work (e.g. scripting the initial setup of a new installation).

---

## Not digested (video content)
Referenced in the source doc but not fetchable as text — listed here only as pointers, titles as given:
- Node-RED: [Part 1/3: Getting Started](https://www.youtube.com/watch?v=i_iaciqn_Fg), [Part 2/3: Basic building blocks and the Dashboard](https://www.youtube.com/watch?v=_J2rVNLrDIg), [Part 3/3: Complex flows and dashboard example](https://www.youtube.com/watch?v=8ceMtBo3orM)
- Grafana: [youtube.com/watch?v=IkNuadRbANA](https://www.youtube.com/watch?v=IkNuadRbANA), [youtube.com/watch?v=B-sGH0etieM](https://www.youtube.com/watch?v=B-sGH0etieM)
