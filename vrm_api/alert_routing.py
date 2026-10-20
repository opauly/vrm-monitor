"""Who hears about what, by property.

An account's alerts go to its own email address and to the phones registered to it (`alerts_delivery`). A property adds two
things on top, so a fleet owner and the owner of one of its properties can each hear about what concerns them:

  * **Email recipients** (`vrm.property_recipients`): extra addresses that get every alert and notice about the sites in that
    property, whatever the account's own email choices are. The fleet owner can switch email off for the account and still have
    the property's owner get theirs.
  * **Phone scope** (`vrm.push_subscriptions.property_ids`): a phone receives either everything the account does (no list, the
    default) or only the alerts of the listed properties. A site that is in no property is, to a scoped phone, nothing.

Everything here is tolerant of the SQL (`vrm_property_routing.sql`) not having been run: the lookups return "nothing" and the
behaviour is exactly what it was before this existed.
"""
from __future__ import annotations

import logging

from database.supabase_client import get_client

logger = logging.getLogger("vrm_api.alert_routing")


def _t(name: str):
    return get_client().schema("vrm").table(name)


def site_properties(site_ids: list[str]) -> dict[str, str]:
    """`{site_id: property_id}` for the sites that are in a property."""
    if not site_ids:
        return {}
    try:
        rows = _t("sites").select("site_id, property_id").in_("site_id", site_ids).not_.is_("property_id", "null").execute().data or []
    except Exception:  # noqa: BLE001 — the properties SQL has not been run
        return {}
    return {r["site_id"]: r["property_id"] for r in rows if r.get("property_id")}


def property_emails(property_ids: list[str]) -> dict[str, list[str]]:
    """`{property_id: [email, ...]}`: the extra recipients of each property."""
    if not property_ids:
        return {}
    try:
        rows = _t("property_recipients").select("property_id, email").in_("property_id", property_ids).execute().data or []
    except Exception:  # noqa: BLE001 — the routing SQL has not been run
        return {}
    out: dict[str, list[str]] = {}
    for r in rows:
        if r.get("email"):
            out.setdefault(r["property_id"], []).append(str(r["email"]).strip().lower())
    return out


def property_names(property_ids: list[str]) -> dict[str, str]:
    """`{property_id: name}`, for telling a recipient which property they were added for."""
    if not property_ids:
        return {}
    try:
        return {r["id"]: r["name"] for r in _t("properties").select("id, name").in_("id", property_ids).execute().data or []}
    except Exception:  # noqa: BLE001
        return {}


def device_receives(device: dict, property_id: str | None) -> bool:
    """Does this phone get an alert about a site in `property_id` (None = a site in no property)?"""
    scope = device.get("property_ids")
    if not scope:
        return True               # no list: everything the account gets
    return property_id in scope
