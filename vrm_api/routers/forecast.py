from __future__ import annotations
"""
`GET /v1/forecast/site?site_id=` — the tonight / tomorrow forecast
(`vrm_api/forecast_service.py`). Cached for an hour per site; built on demand
when stale. `{"available": false, "reason": ...}` when there is none to show
(switched off, no coordinates, weather unreachable) — callers render nothing.

Authorization follows the rest of this service: the web app has already checked
which site the caller may see; this router only trusts the shared pipeline key.
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from vrm_api import forecast_service
from vrm_api.deps import require_pipeline_key

router = APIRouter(prefix="/v1/forecast", tags=["forecast"], dependencies=[Depends(require_pipeline_key)])


@router.get("/site")
def get_site_forecast(site_id: str = Query(...)) -> dict:
    result = forecast_service.get_forecast(site_id)
    if result is None:
        raise HTTPException(status_code=404, detail={"code": "site_not_found"})
    return result
