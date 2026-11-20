"""Verification suite for Ablate's Reverse-Saga Auto-Rollback Engine.

Verifies:
1. With `aegis_enabled=True` and `fail_billing_409=True`, a multi-system transaction across
   ERP, WMS, and Billing that faults on step 3 automatically rolls back in LIFO order,
   restoring `hashes_match == True` across all 3 live databases (`ROLLED_BACK_CLEANLY`) in <400ms.
2. With `aegis_enabled=False` and `fail_billing_409=True`, the identical failure leaves ERP and WMS
   mutated while Billing fails (`hashes_match == False` / `PARTIAL_CORRUPTION`).
"""

from __future__ import annotations

import httpx


def test_reverse_saga_restores_exact_hashes_when_aegis_enabled(api_client: httpx.Client) -> None:
    """When Billing throws HTTP 409 mid-commit with Ablate ON, Reverse-Saga compensation must
    restore ERP, WMS, and Billing to their exact pre-transaction SHA-256 hashes.
    """
    pre_state = api_client.get("/state").json()
    pre_hashes = {
        "erp": pre_state["erp"]["hash"],
        "wms": pre_state["wms"]["hash"],
        "billing": pre_state["billing"]["hash"],
    }

    demo_resp = api_client.post("/demo/run/act2_rollback")
    assert demo_resp.status_code == 200
    payload = demo_resp.json()
    receipt = payload["receipt"]
    post_state = payload["state"]

    assert receipt["status"] == "ROLLED_BACK_CLEANLY"
    assert receipt["hashes_match"] is True
    assert receipt["pre_tx_hashes"] == receipt["post_tx_hashes"]
    assert receipt["rollback_ms"] < 400.0
    assert len(receipt["compensations"]) >= 2

    assert post_state["erp"]["hash"] == pre_hashes["erp"]
    assert post_state["wms"]["hash"] == pre_hashes["wms"]
    assert post_state["billing"]["hash"] == pre_hashes["billing"]


def test_unprotected_execution_causes_partial_corruption_when_aegis_disabled(
    api_client: httpx.Client,
) -> None:
    """When Ablate is OFF (`aegis_enabled=False`) and Billing fails with HTTP 409,
    ERP and WMS remain permanently mutated (`hashes_match == False`).
    """
    pre_state = api_client.get("/state").json()
    pre_hashes = {
        "erp": pre_state["erp"]["hash"],
        "wms": pre_state["wms"]["hash"],
        "billing": pre_state["billing"]["hash"],
    }

    demo_resp = api_client.post("/demo/run/act1_corruption")
    assert demo_resp.status_code == 200
    payload = demo_resp.json()
    receipt = payload["receipt"]
    post_state = payload["state"]

    assert receipt["status"] == "PARTIAL_CORRUPTION"
    assert receipt["hashes_match"] is False
    # ERP and WMS were mutated while Billing failed
    assert (
        post_state["erp"]["hash"] != pre_hashes["erp"]
        or post_state["wms"]["hash"] != pre_hashes["wms"]
    )
