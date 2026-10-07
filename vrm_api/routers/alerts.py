from __future__ import annotations
"""
Alert endpoints the web app calls on a user's behalf (fleet alerts, Phase 4).

Today just `POST /v1/alerts/push-test`: the "Send a test notification" button on
`/app/alerts` (a customer's own devices) and on `/admin/fleet` (the admin's
devices). It sends ONE harmless notification to the caller's own registered
devices only — never to anyone else's, and never through the alert engine — so a
person can check their phone works before relying on it.

Authorization follows the rest of this service: the web app has already
authenticated the user and passes the customer id / admin email it took from the
session; this router only trusts the shared pipeline key (`require_pipeline_key`).
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from victron import email_i18n
from vrm_api import admin_alerts, alerts_push
from vrm_api.deps import require_pipeline_key

router = APIRouter(prefix="/v1/alerts", tags=["alerts"], dependencies=[Depends(require_pipeline_key)])


class PushTestRequest(BaseModel):
    customer_id: str | None = None
    admin_email: str | None = None
    lang: Literal["en", "es"] = "en"


class PushTestOut(BaseModel):
    devices: int
    delivered: int
    removed: int
    failed: int


@router.post("/push-test", response_model=PushTestOut)
def post_push_test(body: PushTestRequest) -> PushTestOut:
    if (body.customer_id is None) == (body.admin_email is None):
        raise HTTPException(status_code=400, detail={"code": "exactly_one_owner_required"})
    if alerts_push.vapid_config() is None:
        raise HTTPException(status_code=503, detail={"code": "push_not_configured"})

    devices = alerts_push.destinations(customer_id=body.customer_id, admin_email=body.admin_email)
    if not devices:
        return PushTestOut(devices=0, delivered=0, removed=0, failed=0)

    strings = email_i18n.get(body.lang)
    payload = {
        "title": strings["alert_push_test_title"],
        "body": strings["alert_push_test_body"],
        "url": "/admin/fleet" if body.admin_email else "/app/alerts",
        "tag": "alert-test",
        "severity": "warning",
    }
    return PushTestOut(**alerts_push.deliver(devices, [payload]))


class AdminCheckOut(BaseModel):
    mode: str
    checks: dict
    notifications: dict | None = None


@router.post("/admin-check", response_model=AdminCheckOut)
def post_admin_check() -> AdminCheckOut:
    """The admin fleet-health watchdog (`vrm_api/admin_alerts.py`): is snapshot
    data still arriving, is the daily history still advancing, are many sites
    silent at once. Meant for a scheduler job every ~15 minutes, separate from
    the snapshot sweep on purpose — a sweep that has died cannot report itself.
    Does nothing (and says so) unless ALERTS_ADMIN is on or dry_run."""
    mode = admin_alerts.admin_mode()
    if mode == "off":
        return AdminCheckOut(mode=mode, checks={})
    checks = admin_alerts.run_watchdog_pass()
    notifications = admin_alerts.deliver_pending() if mode == "on" else None
    return AdminCheckOut(mode=mode, checks=checks, notifications=notifications)
