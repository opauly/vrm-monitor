"""Web Push delivery for fleet alerts — the phone-notification channel.

A browser/phone that opted in hands the web app a *push subscription*: an
`endpoint` URL on its vendor's push service (Apple, Google, Mozilla, Microsoft)
plus an encryption key pair. To notify it, this module encrypts the message,
signs the request with the server's VAPID key, and POSTs it to that endpoint —
the vendor then wakes the device and the service worker (`public/sw.js`) shows
the notification.

Configuration (all environment variables on the API service):

  ALERTS_PUSH          on | off (default off) — the channel switch, like ALERTS_EMAIL
  VAPID_PRIVATE_KEY    the server's signing key (base64url, as printed by
                       `npx web-push generate-vapid-keys`); its public half is
                       VAPID_PUBLIC_KEY on the WEB service
  VAPID_SUBJECT        contact for the push services, default mailto:info@paulyco.com

Safety: `endpoint` arrives from a customer's browser and is a URL THIS SERVER
will request, so it is restricted to the real push-service hosts below
(otherwise a customer could point it at an internal address — server-side
request forgery). The web app checks it on the way in and this module checks it
again on the way out.

Everything here is best-effort and returns outcomes instead of raising: one dead
phone must never block the rest, or the sweep.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from urllib.parse import urlparse

from database.supabase_client import get_client

logger = logging.getLogger("vrm_api.alerts_push")

ALLOWED_HOSTS = {"fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com"}
ALLOWED_SUFFIXES = (".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com")

# Seconds a push service may hold an undelivered message (phone off / offline).
# An hour: a grid-outage notice that arrives tomorrow is worse than none.
TTL_SECONDS = 3600
# Consecutive failures after which a never-succeeding subscription is dropped.
MAX_CONSECUTIVE_FAILURES = 20
# More notifications than this in one sweep collapse into a single summary.
MAX_INDIVIDUAL_PUSHES = 3


def push_enabled() -> bool:
    return os.environ.get("ALERTS_PUSH", "off").strip().lower() == "on"


def vapid_config() -> tuple[str, str] | None:
    key = (os.environ.get("VAPID_PRIVATE_KEY") or "").strip()
    if not key:
        return None
    return key, (os.environ.get("VAPID_SUBJECT") or "mailto:info@paulyco.com").strip()


def endpoint_allowed(endpoint: str) -> bool:
    try:
        parsed = urlparse(endpoint)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        return False
    if parsed.port not in (None, 443):
        return False
    return host in ALLOWED_HOSTS or host.endswith(ALLOWED_SUFFIXES)


def _t(name: str):
    return get_client().schema("vrm").table(name)


def _load_pywebpush():
    """(webpush, WebPushException) — imported lazily so nothing else in the API
    needs the library unless push is actually used (and tests can swap this)."""
    from pywebpush import WebPushException, webpush
    return webpush, WebPushException


def send_one(subscription: dict, payload: dict, *, urgency: str = "normal") -> str:
    """One notification to one device. Returns "ok", "gone" (the subscription is
    dead and should be deleted) or "error" (transient — try again next time)."""
    if not endpoint_allowed(subscription.get("endpoint", "")):
        logger.warning("alerts_push: refusing non-push-service endpoint for subscription %s", subscription.get("id"))
        return "gone"
    config = vapid_config()
    if config is None:
        logger.warning("alerts_push: VAPID_PRIVATE_KEY is not set — cannot send")
        return "error"
    private_key, subject = config

    try:
        webpush, WebPushException = _load_pywebpush()
    except ImportError:
        logger.error("alerts_push: pywebpush is not installed")
        return "error"

    try:
        webpush(
            subscription_info={"endpoint": subscription["endpoint"],
                               "keys": {"p256dh": subscription["p256dh"], "auth": subscription["auth"]}},
            data=json.dumps(payload),
            vapid_private_key=private_key,
            vapid_claims={"sub": subject},      # fresh dict: the library adds aud/exp to it
            ttl=TTL_SECONDS,
            headers={"Urgency": urgency},
            timeout=10,
        )
        return "ok"
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in (404, 410):
            return "gone"
        logger.warning("alerts_push: push service refused subscription %s (status %s)", subscription.get("id"), status)
        return "error"
    except Exception:  # noqa: BLE001 — network trouble must not escape
        logger.exception("alerts_push: unexpected error pushing to subscription %s", subscription.get("id"))
        return "error"


def destinations(*, customer_id: str | None = None, admin_email: str | None = None,
                 include_admin_devices: bool = False) -> list[dict]:
    """Devices to notify.

    `customer_id` — that customer's own devices. `include_admin_devices` adds
    every admin-owned device: used for the internal-fleet accounts (the ones in
    ALERTS_FORCE_CUSTOMER_IDS) that have no login of their own to subscribe from.
    `admin_email` — just that admin's devices (used by the test button).
    """
    columns = "id, endpoint, p256dh, auth, failure_count, admin_email"
    rows: list[dict] = []
    if customer_id:
        rows += _t("push_subscriptions").select(columns).eq("customer_id", customer_id).execute().data or []
    if admin_email:
        rows += _t("push_subscriptions").select(columns).eq("admin_email", admin_email).execute().data or []
    if include_admin_devices:
        rows += _t("push_subscriptions").select(columns).not_.is_("admin_email", "null").execute().data or []
    seen: set = set()
    return [r for r in rows if not (r["id"] in seen or seen.add(r["id"]))]


def deliver(devices: list[dict], payloads: list[dict], *, urgency: str = "normal", sender=None,
            now: datetime | None = None) -> dict:
    """Send every payload to every device and keep the subscription table tidy.

    A device counts as delivered if ANY payload reached it. Dead subscriptions
    are deleted; failing ones are counted, and dropped after
    MAX_CONSECUTIVE_FAILURES in a row.
    """
    send = sender or send_one      # looked up at call time, so tests can replace it
    stamp = (now or datetime.now(timezone.utc)).isoformat()
    result = {"devices": len(devices), "delivered": 0, "removed": 0, "failed": 0}
    table = _t("push_subscriptions")
    for device in devices:
        outcomes = [send(device, payload, urgency=urgency) for payload in payloads]
        try:
            if "gone" in outcomes:
                table.delete().eq("id", device["id"]).execute()
                result["removed"] += 1
            elif "ok" in outcomes:
                table.update({"last_success_at": stamp, "failure_count": 0}).eq("id", device["id"]).execute()
                result["delivered"] += 1
            else:
                failures = (device.get("failure_count") or 0) + 1
                if failures >= MAX_CONSECUTIVE_FAILURES:
                    table.delete().eq("id", device["id"]).execute()
                    result["removed"] += 1
                else:
                    table.update({"last_failure_at": stamp, "failure_count": failures}).eq("id", device["id"]).execute()
                result["failed"] += 1
        except Exception:  # noqa: BLE001 — bookkeeping must never mask the send result
            logger.exception("alerts_push: could not update subscription %s", device.get("id"))
    return result
