from __future__ import annotations
"""
The daily AI summaries (`vrm_api/insights_service.py`).

  GET  /v1/insights/site?site_id=&lang=      one site's summary (cached; made on demand when stale)
  GET  /v1/insights/fleet?lang=[&customer_id=]  a customer's fleet, or every site when no customer_id
  POST /v1/insights/generate-daily           refresh everything in the background (for the scheduler)

Authorization follows the rest of this service: the web app has already checked
who the caller is and which site / customer they may see, and passes the ids it
took from the session; this router only trusts the shared pipeline key.
`{"enabled": false}` means summaries are switched off (INSIGHTS_AI) — callers
render nothing.
"""
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

from vrm_api import insights_service
from vrm_api.deps import require_pipeline_key

router = APIRouter(prefix="/v1/insights", tags=["insights"], dependencies=[Depends(require_pipeline_key)])


class SummaryOut(BaseModel):
    enabled: bool
    headline: str | None = None
    points: list[str] = []
    suggestion: str | None = None
    source: Literal["ai", "template"] | None = None
    date: str | None = None
    generated_at: str | None = None


class DailyOut(BaseModel):
    mode: str
    started: bool


@router.get("/site", response_model=SummaryOut)
def get_site_summary(site_id: str = Query(...), lang: Literal["en", "es"] = Query("en")) -> SummaryOut:
    result = insights_service.site_summary(site_id, lang)
    if result is None:
        raise HTTPException(status_code=404, detail={"code": "site_not_found"})
    return SummaryOut(**result)


@router.get("/fleet", response_model=SummaryOut)
def get_fleet_summary(lang: Literal["en", "es"] = Query("en"), customer_id: str | None = Query(None)) -> SummaryOut:
    return SummaryOut(**insights_service.fleet_summary(customer_id, lang))


@router.post("/generate-daily", response_model=DailyOut)
def post_generate_daily(background_tasks: BackgroundTasks) -> DailyOut:
    """Refreshes every site and fleet summary. Runs in the background and
    answers at once: a full pass is dozens of model calls, far longer than the
    ~30 seconds an external scheduler waits for a response."""
    mode = insights_service.insights_mode()
    if mode == "off":
        return DailyOut(mode=mode, started=False)
    background_tasks.add_task(_run_daily)
    return DailyOut(mode=mode, started=True)


def _run_daily() -> None:
    try:
        insights_service.logger.info("insights: daily generation %s", insights_service.generate_daily())
    except Exception:  # noqa: BLE001 — a background task has nobody to raise to
        insights_service.logger.exception("insights: daily generation failed")
