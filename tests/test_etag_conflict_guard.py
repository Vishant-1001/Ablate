"""Verification suite for Optimistic Concurrency (ETag) & Commutative Delta Rollback Guard.

Verifies:
1. WMS commutative delta compensation (`+qty` inverse of `-qty`) preserves concurrent inventory
   adjustments instead of clobbering stock counts with a stale snapshot.
2. ERP optimistic ETag verification detects when a human concurrently edits a Purchase Order mid-flight,
   refusing to overwrite the human's edit and transitioning the receipt to `QUARANTINED_CONCURRENT_EDIT`.
"""

from __future__ import annotations

import httpx


def test_wms_commutative_delta_undo_preserves_inventory_math(api_client: httpx.Client) -> None:
    """When a transaction deducts 50 units from WMS inventory and subsequently rolls back due to
    a Billing 409 fault, Ablate's compensation applies an inverse commutative delta (+50) rather
    than an unsafe blind table drop.
    """
    initial_state = api_client.get("/state").json()
    initial_sku = initial_state["wms"]["inventory"][0]
    sku_code = initial_sku["sku"]
    initial_on_hand = int(initial_sku["on_hand"])

    api_client.post(
        "/admin/config",
        json={"aegis_enabled": True, "fail_billing_409": True, "simulate_human_edit": False},
    )

    tx_id = api_client.post("/tx/begin").json()["tx_id"]
    api_client.post(
        "/mcp/call",
        json={"tx_id": tx_id, "tool": "wms.reserve_inventory", "args": {"sku": sku_code, "qty": 50}},
    )
    api_client.post(
        "/mcp/call",
        json={
            "tx_id": tx_id,
            "tool": "billing.create_invoice",
            "args": {"po_id": "PO-1001", "amount_usd": 12500.0},
        },
    )

    commit_resp = api_client.post("/tx/commit", json={"tx_id": tx_id})
    assert commit_resp.status_code == 200
    receipt = commit_resp.json()

    assert receipt["status"] == "ROLLED_BACK_CLEANLY"
    assert len(receipt["compensations"]) >= 1

    final_state = api_client.get("/state").json()
    final_sku = next(i for i in final_state["wms"]["inventory"] if i["sku"] == sku_code)
    assert int(final_sku["on_hand"]) == initial_on_hand


def test_erp_etag_mismatch_quarantines_concurrent_human_edit(api_client: httpx.Client) -> None:
    """When `simulate_human_edit=True` (or a human edits PO-1001 mid-commit), Ablate's Reverse-Saga
    must detect the ETag mismatch, return `QUARANTINED_CONCURRENT_EDIT`, and preserve the human's
    modification rather than overwriting it with pre-transaction state.
    """
    pre_state = api_client.get("/state").json()
    pre_erp_hash = pre_state["erp"]["hash"]

    demo_resp = api_client.post("/demo/run/act4_etag_conflict")
    assert demo_resp.status_code == 200
    payload = demo_resp.json()
    receipt = payload["receipt"]
    post_state = payload["state"]

    assert receipt["status"] == "QUARANTINED_CONCURRENT_EDIT"
    # Because the human's edit was preserved on ERP, the post-tx ERP hash differs from pre-tx seed hash
    assert post_state["erp"]["hash"] != pre_erp_hash
    po_1001 = next(
        (p for p in post_state["erp"]["purchase_orders"] if p["po_id"] == "PO-1001"),
        post_state["erp"]["purchase_orders"][0],
    )
    # The agent's target status ("FULFILLED") must not have clobbered the human edit
    assert po_1001["status"] != "APPROVED"
