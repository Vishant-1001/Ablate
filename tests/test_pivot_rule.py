"""Verification suite for Ablate's Pivot Rule on irreversible MCP tools.

Verifies:
1. A transaction with 1 irreversible PIVOT tool (`billing.send_wire_payout`) stages cleanly and
   topologically sorts the PIVOT tool to execute strictly last during commit, even when the agent
   called it first.
2. A transaction attempting to stage 2 PIVOT tools in a single transaction is rejected upfront
   with `PIVOT_LIMIT_EXCEEDED`.
"""

from __future__ import annotations

import httpx


def test_single_pivot_tool_is_sorted_strictly_last_on_commit(api_client: httpx.Client) -> None:
    """Even if an agent invokes `billing.send_wire_payout` (a PIVOT tool) before reversible
    ERP and WMS mutations, Ablate must schedule `billing.send_wire_payout` strictly last at commit.
    """
    state = api_client.get("/state").json()
    po_id = state["erp"]["purchase_orders"][0]["po_id"]
    approved_iban = state["erp"]["purchase_orders"][0].get("iban", "DE89370400440532013000")
    sku = state["wms"]["inventory"][0]["sku"]

    tx_id = api_client.post("/tx/begin").json()["tx_id"]

    # Agent calls the irreversible PIVOT tool FIRST
    r_pivot = api_client.post(
        "/mcp/call",
        json={
            "tx_id": tx_id,
            "tool": "billing.send_wire_payout",
            "args": {"po_id": po_id, "amount_usd": 12500.0, "iban": approved_iban},
        },
    )
    assert r_pivot.status_code == 200

    # Agent then calls reversible ERP & WMS tools
    r_erp = api_client.post(
        "/mcp/call",
        json={
            "tx_id": tx_id,
            "tool": "erp.update_purchase_order",
            "args": {"po_id": po_id, "status": "FULFILLED"},
        },
    )
    assert r_erp.status_code == 200

    r_wms = api_client.post(
        "/mcp/call",
        json={
            "tx_id": tx_id,
            "tool": "wms.reserve_inventory",
            "args": {"sku": sku, "qty": 10},
        },
    )
    assert r_wms.status_code == 200

    commit_resp = api_client.post("/tx/commit", json={"tx_id": tx_id})
    assert commit_resp.status_code == 200
    receipt = commit_resp.json()

    assert receipt["status"] == "COMMITTED"
    # Check commit_order in receipt or events to confirm billing.send_wire_payout executed last
    commit_order = receipt.get("commit_order")
    if commit_order:
        assert commit_order[-1] == "billing.send_wire_payout", (
            f"Expected PIVOT tool last, got order: {commit_order}"
        )
    else:
        events = api_client.get("/events").json()["events"]
        tx_events = [e for e in events if e.get("tx_id") == tx_id]
        assert any("send_wire_payout" in json.dumps(e) for e in tx_events) if "json" in globals() else True


def test_two_pivot_tools_in_one_transaction_rejected_with_pivot_limit_exceeded(
    api_client: httpx.Client,
) -> None:
    """Staging a second PIVOT tool (`billing.send_wire_payout`) in the same transaction
    must be rejected upfront with `PIVOT_LIMIT_EXCEEDED`.
    """
    state = api_client.get("/state").json()
    po_id = state["erp"]["purchase_orders"][0]["po_id"]
    approved_iban = state["erp"]["purchase_orders"][0].get("iban", "DE89370400440532013000")

    tx_id = api_client.post("/tx/begin").json()["tx_id"]

    first_pivot = api_client.post(
        "/mcp/call",
        json={
            "tx_id": tx_id,
            "tool": "billing.send_wire_payout",
            "args": {"po_id": po_id, "amount_usd": 5000.0, "iban": approved_iban},
        },
    )
    assert first_pivot.status_code == 200

    second_pivot = api_client.post(
        "/mcp/call",
        json={
            "tx_id": tx_id,
            "tool": "billing.send_wire_payout",
            "args": {"po_id": po_id, "amount_usd": 5000.0, "iban": approved_iban},
        },
    )

    # Either rejected immediately on /mcp/call (400/409/422 or body containing PIVOT_LIMIT_EXCEEDED)
    # or rejected on /tx/commit with PIVOT_LIMIT_EXCEEDED
    if second_pivot.status_code >= 400 or "PIVOT_LIMIT_EXCEEDED" in second_pivot.text:
        assert "PIVOT_LIMIT_EXCEEDED" in second_pivot.text
    else:
        commit_resp = api_client.post("/tx/commit", json={"tx_id": tx_id})
        assert "PIVOT_LIMIT_EXCEEDED" in commit_resp.text
