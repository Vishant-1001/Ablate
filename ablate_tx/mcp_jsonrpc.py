"""MCP JSON-RPC 2.0 front door for the Ablate proxy (POST /mcp).

Implements the MCP methods an agent needs to discover and call tools:
  initialize, notifications/initialized, ping, tools/list, tools/call
plus two Ablate extensions for transaction control:
  ablate/begin_tx  -> {"tx_id"}           (params: {"untrusted_context"?: [str]})
  ablate/commit_tx -> TxReceipt            (params: {"tx_id"})

Transaction binding for tools/call: the `Mcp-Session-Id` header carries the tx_id
(or params._meta["ablate/tx_id"]). With no tx, calls behave exactly like /mcp/call
without a tx_id. Untrusted-provenance fields go in params._meta["ablate/tainted_fields"].

Tool failures (HTTP 409 from billing, a PIVOT_LIMIT_EXCEEDED rejection, ...) are
returned as a tool result with isError=true, per MCP; JSON-RPC errors are reserved
for protocol problems (bad JSON, unknown method, bad params).
"""
from __future__ import annotations

import json
from typing import Any

from services.common import ToolError

from .registry import REGISTRY

PROTOCOL_VERSION = "2025-06-18"
SERVER_INFO = {"name": "ablate-transactional-proxy", "version": "0.2.0"}

PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR = -32700, -32600, -32601, -32602, -32603

_S, _I, _N = {"type": "string"}, {"type": "integer"}, {"type": "number"}

# JSON Schemas for the agent-callable tools (idempotency keys are assigned by the proxy).
INPUT_SCHEMAS: dict[str, dict] = {
    "erp.get_po": {"po_id": _S},
    "erp.update_po_qty": {"po_id": _S, "new_qty": _I},
    "erp.post_gl_adjustment": {"po_id": _S, "debit": _N, "credit": _N, "memo": _S},
    "wms.get_inventory": {"sku": _S},
    "wms.adjust_reservation": {"sku": _S, "delta_qty": _I},
    "billing.get_invoice": {"invoice_id": _S},
    "billing.issue_credit_note": {"invoice_id": _S, "amount_usd": _N, "dry_run": {"type": "boolean"}},
    "billing.send_wire_payout": {"invoice_id": _S, "vendor_iban": _S, "amount_usd": _N},
}
_OPTIONAL = {"memo", "dry_run"}

DESCRIPTIONS = {
    "erp.get_po": "Read a purchase order.",
    "erp.update_po_qty": "Set the ordered quantity on a purchase order.",
    "erp.post_gl_adjustment": "Post a general-ledger adjustment against a PO; debit must equal credit.",
    "wms.get_inventory": "Read on_hand / reserved units for a SKU.",
    "wms.adjust_reservation": "Change reserved units by delta_qty (negative releases units).",
    "billing.get_invoice": "Read an invoice.",
    "billing.issue_credit_note": "Issue a credit note against an invoice.",
    "billing.send_wire_payout": "Wire money to a vendor IBAN. Irreversible.",
}


def tool_list() -> list[dict]:
    out = []
    for name, props in INPUT_SCHEMAS.items():
        spec = REGISTRY[name]
        out.append({
            "name": name,
            "description": DESCRIPTIONS[name],
            "inputSchema": {"type": "object", "properties": props,
                            "required": [k for k in props if k not in _OPTIONAL]},
            "annotations": {
                "readOnlyHint": spec.kind == "READ_ONLY",
                "destructiveHint": spec.kind == "PIVOT",
                "idempotentHint": spec.kind in ("READ_ONLY", "RETRYABLE"),
            },
            "_meta": {"ablate/tool_class": spec.kind, "ablate/undo_strategy": spec.undo_strategy},
        })
    return out


def _ok(id_: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "result": result}


def _err(id_: Any, code: int, message: str, data: Any = None) -> dict:
    e: dict = {"code": code, "message": message}
    if data is not None:
        e["data"] = data
    return {"jsonrpc": "2.0", "id": id_, "error": e}


def _tool_result(payload: dict, is_error: bool) -> dict:
    return {
        "content": [{"type": "text", "text": json.dumps(payload, default=str)}],
        "structuredContent": payload,
        "isError": is_error,
    }


def handle(engine, msg: Any, session_tx: str | None) -> dict | None:
    """Handle one JSON-RPC message. Returns the response, or None for a notification."""
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
        return _err(msg.get("id") if isinstance(msg, dict) else None, INVALID_REQUEST, "Invalid Request")
    id_, method = msg.get("id"), msg["method"]
    params = msg.get("params") or {}
    is_notification = "id" not in msg
    if not isinstance(params, dict):
        return None if is_notification else _err(id_, INVALID_PARAMS, "params must be an object")

    try:
        if method == "initialize":
            result: Any = {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": SERVER_INFO,
                "instructions": "Mutating tools are staged in a shadow twin when called inside an Ablate "
                                "transaction (ablate/begin_tx), validated, and committed atomically with "
                                "reverse-saga rollback on ablate/commit_tx.",
            }
        elif method.startswith("notifications/"):
            return None
        elif method == "ping":
            result = {}
        elif method == "tools/list":
            result = {"tools": tool_list()}
        elif method == "tools/call":
            name, arguments = params.get("name"), params.get("arguments") or {}
            if name not in INPUT_SCHEMAS:
                return _err(id_, INVALID_PARAMS, f"unknown tool: {name}", {"tools": sorted(INPUT_SCHEMAS)})
            if not isinstance(arguments, dict):
                return _err(id_, INVALID_PARAMS, "arguments must be an object")
            meta = params.get("_meta") or {}
            tx_id = meta.get("ablate/tx_id") or session_tx
            tainted = meta.get("ablate/tainted_fields") or []
            try:
                result = _tool_result(engine.call(tx_id, name, arguments, tainted), False)
            except ToolError as e:
                result = _tool_result({"ok": False, "error": e.to_dict()}, True)
        elif method == "ablate/begin_tx":
            result = {"tx_id": engine.begin(params.get("untrusted_context"))}
        elif method == "ablate/commit_tx":
            tx_id = params.get("tx_id") or session_tx
            if not tx_id:
                return _err(id_, INVALID_PARAMS, "tx_id required (params.tx_id or Mcp-Session-Id header)")
            result = engine.commit(tx_id)
        else:
            return None if is_notification else _err(id_, METHOD_NOT_FOUND, f"Method not found: {method}")
    except ToolError as e:  # tx-level problems (unknown/closed tx) outside a tool result
        return None if is_notification else _err(id_, INVALID_PARAMS, e.message, e.to_dict())
    except Exception as e:  # pragma: no cover - defensive
        return None if is_notification else _err(id_, INTERNAL_ERROR, f"{type(e).__name__}: {e}")
    return None if is_notification else _ok(id_, result)
