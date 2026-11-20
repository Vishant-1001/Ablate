"""Verification suite for Ablate Shadow Twin isolation and 3-Layer Deterministic Invariant Gate.

Verifies:
1. Read-your-own-writes isolation inside the Shadow Twin.
2. Zero live writes during staging (live ERP/WMS/Billing SHA-256 hashes remain invariant prior to commit).
3. Layer-1 Accounting: Ledger balance violation (unbalanced debit vs credit) aborts in shadow.
4. Layer-1 Conservation: Negative inventory block (reserving more stock than available) aborts in shadow.
5. Layer-2 Policy: Dollar cap escalation (> max_auto_usd) transitions to ESCALATED_HITL with 0 live writes.
6. Layer-3 Security: Prompt-injection taint & unapproved IBAN swap aborts in shadow (ABORTED_IN_SHADOW).
"""

from __future__ import annotations

import httpx


def _get_live_hashes(client: httpx.Client) -> dict[str, str]:
    state = client.get("/state").json()
    return {
        "erp": state["erp"]["hash"],
        "wms": state["wms"]["hash"],
        "billing": state["billing"]["hash"],
    }


def test_read_your_own_writes_and_zero_live_writes_during_staging(api_client: httpx.Client) -> None:
    """Staging mutations in a Shadow Twin must be visible to subsequent reads in the same tx_id
    while leaving all 3 live production databases 100% untouched before commit.
    """
    pre_hashes = _get_live_hashes(api_client)
    pre_state = api_client.get("/state").json()
    initial_po_qty = pre_state["erp"]["purchase_orders"][0]["qty"]
    po_id = pre_state["erp"]["purchase_orders"][0]["po_id"]

    tx_id = api_client.post("/tx/begin").json()["tx_id"]

    # Mutate PO status inside the Shadow Twin
    stage_resp = api_client.post(
        "/mcp/call",
        json={
            "tx_id": tx_id,
            "tool": "erp.update_po_qty",
            "args": {"po_id": po_id, "new_qty": 450},
        },
    )
    assert stage_resp.status_code == 200

    # Read back within the same transaction (Read-Your-Own-Writes)
    read_resp = api_client.post(
        "/mcp/call",
        json={
            "tx_id": tx_id,
            "tool": "erp.get_po",
            "args": {"po_id": po_id},
        },
    )
    assert read_resp.status_code == 200
    read_body = read_resp.json()
    assert read_body["result"]["qty"] == 450

    # Verify zero live writes occurred during staging
    mid_hashes = _get_live_hashes(api_client)
    mid_state = api_client.get("/state").json()
    assert mid_hashes == pre_hashes, "Live DB hashes must not change during Shadow Twin staging"
    assert mid_state["erp"]["purchase_orders"][0]["qty"] == initial_po_qty


def test_layer1_ledger_balance_violation_aborts_in_shadow(api_client: httpx.Client) -> None:
    """An unbalanced General Ledger entry (debit != credit) must fail ledger_balance
    and abort in shadow with zero live writes.
    """
    pre_hashes = _get_live_hashes(api_client)
    tx_id = api_client.post("/tx/begin").json()["tx_id"]

    api_client.post(
        "/mcp/call",
        json={
            "tx_id": tx_id,
            "tool": "erp.post_gl_adjustment",
            "args": {
                "po_id": "PO-1042",
                "debit": 15000.0,
                "credit": 9500.0,  # Intentional 5500 USD imbalance
                "memo": "Unbalanced hallucinated GL posting",
            },
        },
    )

    commit_resp = api_client.post("/tx/commit", json={"tx_id": tx_id})
    assert commit_resp.status_code == 200
    receipt = commit_resp.json()

    assert receipt["status"] == "ABORTED_IN_SHADOW"
    assert receipt["invariants"]["ledger_balance"] is False
    assert receipt["hashes_match"] is True
    assert _get_live_hashes(api_client) == pre_hashes


def test_layer1_negative_inventory_violation_aborts_in_shadow(api_client: httpx.Client) -> None:
    """Attempting to deduct more inventory than available must fail inventory_non_negative
    and abort in shadow with zero live writes.
    """
    pre_hashes = _get_live_hashes(api_client)
    state = api_client.get("/state").json()
    sku = state["wms"]["inventory"][0]["sku"]

    tx_id = api_client.post("/tx/begin").json()["tx_id"]
    api_client.post(
        "/mcp/call",
        json={
            "tx_id": tx_id,
            "tool": "wms.adjust_reservation",
            "args": {"sku": sku, "delta_qty": 999999},
        },
    )

    commit_resp = api_client.post("/tx/commit", json={"tx_id": tx_id})
    assert commit_resp.status_code == 200
    receipt = commit_resp.json()

    assert receipt["status"] == "ABORTED_IN_SHADOW"
    assert receipt["invariants"]["inventory_non_negative"] is False
    assert receipt["hashes_match"] is True
    assert _get_live_hashes(api_client) == pre_hashes


def test_layer2_dollar_cap_exceeded_escalates_to_hitl(api_client: httpx.Client) -> None:
    """A transaction exceeding max_auto_usd ($25,000) must deterministically halt and return
    ESCALATED_HITL with zero live writes.
    """
    api_client.post("/admin/config", json={"max_auto_usd": 25000.0})
    pre_hashes = _get_live_hashes(api_client)
    tx_id = api_client.post("/tx/begin").json()["tx_id"]

    api_client.post(
        "/mcp/call",
        json={
            "tx_id": tx_id,
            "tool": "billing.issue_credit_note",
            "args": {"invoice_id": "INV-88", "amount_usd": 30000.0},
        },
    )

    commit_resp = api_client.post("/tx/commit", json={"tx_id": tx_id})
    assert commit_resp.status_code == 200
    receipt = commit_resp.json()

    assert receipt["status"] == "ESCALATED_HITL"
    assert receipt["invariants"]["dollar_cap"] is False
    assert receipt["hashes_match"] is True
    assert _get_live_hashes(api_client) == pre_hashes


def test_layer3_prompt_injection_taint_and_iban_integrity_abort(api_client: httpx.Client) -> None:
    """When untrusted external context taints a sensitive argument (e.g., IBAN hijacked via
    indirect prompt injection), Ablate must fail taint_check / iban_integrity and abort in shadow.
    """
    pre_hashes = _get_live_hashes(api_client)
    tx_id = api_client.post("/tx/begin").json()["tx_id"]

    api_client.post(
        "/mcp/call",
        json={
            "tx_id": tx_id,
            "tool": "billing.send_wire_payout",
            "args": {"invoice_id": "INV-88", "vendor_iban": "RU00999988887777666655", "amount_usd": 5000.0},
            "tainted_fields": ["vendor_iban"],
        },
    )

    commit_resp = api_client.post("/tx/commit", json={"tx_id": tx_id})
    assert commit_resp.status_code == 200
    receipt = commit_resp.json()

    assert receipt["status"] == "ABORTED_IN_SHADOW"
    assert (
        receipt["invariants"]["taint_check"] is False
        or receipt["invariants"]["iban_integrity"] is False
    )
    assert receipt["hashes_match"] is True
    assert _get_live_hashes(api_client) == pre_hashes
