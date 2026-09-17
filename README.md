# VRM Monitor

Fleet monitoring for Victron Energy installations — a live dashboard, weekly AI-narrated PDF reports, and a customer-facing SaaS product (signup, billing, per-site branding) built on top of the same report pipeline.

Split out of [`github.com/opauly/dimensionador-fv`](https://github.com/opauly/dimensionador-fv) (the Pauly&Co Solar Design Tool repo) on 2026-09-16 — this was originally one product living alongside that tool, sharing its Supabase project. It's now an independent repo with its own history, deploy targets, and roadmap. The two repos still share one Supabase project, isolated by schema (`vrm` and `monitoring` here, `public` there) — see Dimensionador's `ARCHITECTURE.md` for how the pieces still connect.

## What's here

| Path | What it is |
|---|---|
| `victron/` | The ingestion/report pipeline — CSV upload, VRM API sync, health scoring, anomaly detection, weekly PDF report rendering (WeasyPrint + Jinja2). `victron/vrm_shared/` is a deliberate, literal fork of four small Dimensionador modules (`tariffs_db`, `tariff_calculator`, `pvgis`, `assets:get_logo_b64`) this pipeline needs — Dimensionador keeps its own originals; these are independent copies, not a shared package. |
| `vrm_api/` | The FastAPI service wrapping that pipeline — auth, billing (ONVO), scheduled reports, VRM Fleet sync. Never called from a browser; only `victron-monitor/web`'s Next.js server calls it. See `vrm_api/README.md`. |
| `vrm_portal/` | Backend for a separate Streamlit-based portal (`victron-monitor/portal/app.py`) — login/auth/strings for that surface. |
| `victron-monitor/web/` | The Next.js app — marketing site, customer portal, admin dashboard. Deployed on Vercel. See `victron-monitor/web/README.md`. |
| `victron-monitor/node-red/`, `victron-monitor/apps-script/` | Deployment artifacts for the original telemetry ingestion path — a Node-RED flow (imported into a Cerbo GX's own Node-RED instance) and a Google Apps Script (pasted into a Sheet's script editor). Not run from this repo; these are config to import/paste elsewhere. |
| `database/` | Only what `victron/`/`vrm_api` actually need: `vrm_report_db.py`, `supabase_client.py`. Not a full copy of Dimensionador's `database/` — everything else there is Dimensionador-only. |
| `config.py`, `utils/`, `requirements.txt` | Shared with Dimensionador by duplication (each repo keeps its own copy), not by reference. |
| `Dockerfile.api`, `requirements-api.txt` | Builds the `vrm_api` image, deployed on Render. |
| `.github/workflows/` | `billing-reconcile.yml` (daily) and `scheduled-reports.yml` (hourly) — GitHub Actions cron, HTTP-only calls into the deployed `vrm_api`. A third job, live snapshot refreshing, runs on `cron-job.org` instead (not GitHub Actions) — see `vrm_api/README.md` if adding a new scheduled job, so it doesn't end up duplicated across both schedulers. |

## Deploy targets

- **`vrm_api`** → Render (Docker), built from `Dockerfile.api` at repo root. Health check: `GET /health` (the one unauthenticated route).
- **`victron-monitor/web`** → Vercel, Root Directory `victron-monitor/web`.
- Both read `PIPELINE_API_KEY`/`PIPELINE_API_URL` (Render's own service URL) — see `victron-monitor/web/README.md` and `vrm_api/README.md` for the full env var lists.

## Run locally

`vrm_api` and `victron-monitor/web` are two separate local processes:

```bash
# Terminal 1 — vrm_api (FastAPI, port 8000). From the REPO ROOT — it
# imports victron.* and database.* as top-level packages.
python3 -m venv .venv && source .venv/bin/activate
.venv/bin/python -m pip install -r requirements-api.txt
.venv/bin/python -m uvicorn vrm_api.main:app --reload
```

```bash
# Terminal 2 — the web app (Next.js, port 3000).
cd victron-monitor/web
source "$HOME/.nvm/nvm.sh" && nvm use   # pins Node via .nvmrc
npm install                             # first time, or after a dependency change
npm run dev
```

Both need real environment variables — see `vrm_api/README.md#env-vars` and `victron-monitor/web/README.md#environment-variables`. At minimum, the web app needs `PIPELINE_API_URL=http://localhost:8000` and a `PIPELINE_API_KEY` matching the value in `vrm_api`'s own `.env`.

## History note

This repo's first commit (`d23b8cc`) is a clean-slate export of Dimensionador's tracked files at the time of the split — not a history rewrite. Dimensionador keeps the full original history for everything that moved here; this repo starts fresh rather than inheriting it, since the blame/bisect value wasn't judged worth the execution risk of a history rewrite for a project this young.
