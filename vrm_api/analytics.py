from __future__ import annotations
"""
vrm_api's own half of the analytics setup (2026-09-19) — mirrors
`victron-monitor/web/lib/server/analytics.ts` on the Next.js side, same
project, same PostHog key, just the Python SDK instead of posthog-node.

Exists for exactly one event this app fires: `subscription_started`, from
`billing.py:apply_entitlements()`, at the one place `provisioning_state`
is promoted from `'pending_subscription'` to `'active'` — see that call
site's own comment for why THAT specific transition is safe to treat as
"fires exactly once, ever, per customer" (PLAN_PHASE16.md §4.5 rule 8:
promotion is one-way and never reverts), unlike almost anything else in
`reconcile_customer()`, which re-reads and rewrites the mirror wholesale
on every call — a webhook retry, the daily reconcile-due sweep, and a
customer's own subscribe/cancel/change action all funnel through it, so
naively firing an event anywhere else in that function would double- or
triple-count the same real-world event.

The `trial_started`/`signup_request_submitted`/`subscription_cancelled`
events all live on the Next.js side instead — this file is not a general
analytics module for vrm_api, just this one funnel step.
"""
import logging
import os

logger = logging.getLogger("vrm_api.analytics")

_client = None
_client_initialized = False


def _get_client():
    """Lazy, module-level singleton — mirrors analytics.ts's own reasoning:
    constructed once per process, not once per call, but never at import
    time either (importing this module must never require the env var to
    already be set, e.g. in a test run)."""
    global _client, _client_initialized
    if _client_initialized:
        return _client
    _client_initialized = True

    key = os.environ.get("NEXT_PUBLIC_POSTHOG_KEY")
    if not key:
        _client = None
        return None

    try:
        from posthog import Posthog
        _client = Posthog(
            key,
            host=os.environ.get("NEXT_PUBLIC_POSTHOG_HOST") or "https://us.i.posthog.com",
        )
    except Exception:  # noqa: BLE001 — analytics must never break billing
        logger.exception("analytics: failed to construct PostHog client")
        _client = None
    return _client


def capture_server_event(distinct_id: str, event: str, properties: dict | None = None) -> None:
    """Fire-and-forget — every call site is on a billing success path that
    must never fail, slow down, or roll back over an unreachable analytics
    endpoint. `distinct_id` should be the customer's email where available
    (the same identity `vrm.customers.auth_email` / the Next.js side's own
    events use), falling back to `customer_id` only when no email is on
    hand at the call site."""
    client = _get_client()
    if client is None:
        return
    try:
        client.capture(distinct_id=distinct_id, event=event, properties=properties or {})
    except Exception:  # noqa: BLE001 — see module/function docstrings
        logger.exception("analytics: failed to capture %r", event)
