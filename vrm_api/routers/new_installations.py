from __future__ import annotations
"""
`/v1/new-installations` — systems found in a VRM account that have no site yet (`vrm_api/site_discovery.py`).

  POST /check          look now (the admin's "Check VRM now"); the 15-minute sweep also looks about once an hour
  POST /{id}/add       the new-site wizard's last step: create the site and start its first import (returns a job)
  POST /{id}/dismiss   "not one to monitor"

The list itself is read by the web app straight from `vrm.new_installations`. Authorization is the web app's, as for
every router here: it passes `acting_customer_id` for a customer session (who may only act on rows found in their
own account) and leaves it out for the admin.
"""
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from victron import ingest as victron_ingest
from vrm_api import jobs, site_discovery, tenancy
from vrm_api.deps import require_pipeline_key
from vrm_api.routers.vrm_sync import _do_sync
from vrm_api.schemas import NewInstallationActRequest, NewInstallationAddRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/new-installations", tags=["new-installations"], dependencies=[Depends(require_pipeline_key)])


@router.post("/check")
def post_check() -> dict:
    found = site_discovery.run_pass()
    told = site_discovery.deliver()
    return {"found": found, "told": told}


def _open_row(row_id: str, acting_customer_id: str | None) -> dict:
    try:
        return site_discovery.get_open(row_id, customer_id=acting_customer_id)
    except site_discovery.NotFound:
        raise HTTPException(status_code=404, detail={"code": "not_found"}) from None


@router.post("/{row_id}/dismiss")
def post_dismiss(row_id: str, body: NewInstallationActRequest) -> dict:
    _open_row(row_id, body.acting_customer_id)
    site_discovery.dismiss(row_id, customer_id=body.acting_customer_id)
    return {"ok": True}


@router.post("/{row_id}/add")
def post_add(row_id: str, body: NewInstallationAddRequest, background_tasks: BackgroundTasks) -> dict:
    row = _open_row(row_id, body.acting_customer_id)
    if body.acting_customer_id:
        customer = tenancy.get_customer(body.acting_customer_id)       # a customer's site always goes under them
    elif bool(body.customer_id) == bool((body.new_customer_name or "").strip()):
        raise HTTPException(status_code=400, detail={"code": "exactly_one_customer_field_required"})
    elif body.customer_id:
        customer = tenancy.get_customer(body.customer_id)
    else:
        customer = victron_ingest.upsert_customer(body.new_customer_name.strip())

    shared = bool(tenancy.installations_registered_elsewhere(customer["id"], [int(row["vrm_installation_id"])]))
    fields = body.site_fields.model_dump(exclude_none=True)
    try:
        site = site_discovery.create_site(row, customer=customer, site_fields=fields, shared=shared)
    except Exception as exc:  # noqa: BLE001 — the one expected conflict: this customer already has a site for it
        if "vrm_installation_id" in str(exc).lower() or "idx_vrm_sites_customer_installation" in str(exc).lower():
            raise HTTPException(status_code=409, detail={"code": "installation_already_linked_to_customer"}) from None
        raise

    # The first import: daily totals and 15-minute readings from the day the system was created. A system found in
    # the admin's account is read with the admin token; one found in a customer's, with theirs.
    start, end = site_discovery.first_import_window(row, site.get("timezone"), datetime.now(timezone.utc))
    token = os.environ.get("VRM_ADMIN_TOKEN") if row.get("customer_id") is None else None
    job = jobs.create_job("vrm_sync", customer_id=customer["id"], site_id=site["site_id"],
                          params={"site_id": site["site_id"], "start": start, "end": end})
    background_tasks.add_task(jobs.run_job, job["id"],
                              lambda: _do_sync(customer["id"], site, start, end, triggered_by="admin" if token else "customer", token=token))
    return {"site_id": site["site_id"], "customer_id": customer["id"], "job_id": job["id"], "shared": shared}
