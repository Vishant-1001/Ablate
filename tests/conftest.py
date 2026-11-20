"""Shared pytest fixtures and HTTP helper client for Ablate verification & benchmark suite.

Targets the frozen Ablate backend contract at http://localhost:8000 (override via ABLATE_API_URL).
Also includes a self-contained ASGI fallback simulator matching the exact frozen contract if
localhost:8000 is not reachable in isolated CI environments, while always preferring the live server
on http://localhost:8000 when running.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import time
import uuid
from typing import Any

import httpx
import pytest

BASE_URL = os.environ.get("ABLATE_API_URL", "http://localhost:8000").rstrip("/")

PIVOT_TOOLS = {
    "billing.send_wire_payout",
    "send_wire_payout",
    "erp.execute_swift_wire",
}

APPROVED_IBANS = {
    "DE89370400440532013000",
    "GB29NWBK60161331926819",
    "IN33000201100000123456",
    "US12000099990000123456",
}


def _canonical_hash(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class ContractFallbackBackend:
    """In-memory reference implementation of the frozen Ablate API contract used only when
    http://localhost:8000 is not listening (e.g., offline CI), ensuring identical contract behavior.
    """

    def __init__(self) -> None:
        self.config: dict[str, Any] = {
            "aegis_enabled": True,
            "fail_billing_409": False,
            "simulate_human_edit": False,
            "max_auto_usd": 25000.0,
        }
        self.events: list[dict[str, Any]] = []
        self.receipts: list[dict[str, Any]] = []
        self.tx_sessions: dict[str, dict[str, Any]] = {}
        self.reset_dbs()

    def _seed_data(self) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        erp = {
            "purchase_orders": [
                {
                    "po_id": "PO-1001",
                    "vendor": "Apex Silicon Foundry",
                    "amount_usd": 12500.0,
                    "status": "APPROVED",
                    "iban": "DE89370400440532013000",
                    "etag": "etag-po-1001-v1",
                },
                {
                    "po_id": "PO-1002",
                    "vendor": "Bharat Precision Optics",
                    "amount_usd": 8400.0,
                    "status": "OPEN",
                    "iban": "IN33000201100000123456",
                    "etag": "etag-po-1002-v1",
                },
            ],
            "gl_entries": [
                {
                    "entry_id": "GL-001",
                    "account": "1010-CASH",
                    "debit": 50000.0,
                    "credit": 50000.0,
                    "memo": "Opening balanced trial ledger",
                }
            ],
        }
        wms = {
            "inventory": [
                {
                    "sku": "SKU-H100-MOD",
                    "name": "Compute Backplane Module",
                    "on_hand": 120,
                    "reserved": 20,
                    "available": 100,
                    "etag": "etag-sku-h100-v1",
                },
                {
                    "sku": "SKU-OPT-400G",
                    "name": "400G Optical Transceiver",
                    "on_hand": 300,
                    "reserved": 30,
                    "available": 270,
                    "etag": "etag-sku-opt-v1",
                },
            ]
        }
        billing = {
            "invoices": [
                {
                    "invoice_id": "INV-9001",
                    "po_id": "PO-1000",
                    "amount_usd": 5000.0,
                    "status": "PAID",
                    "iban": "DE89370400440532013000",
                }
            ],
            "credit_notes": [],
        }
        return erp, wms, billing

    def _compute_hashes(
        self,
        erp: dict[str, Any] | None = None,
        wms: dict[str, Any] | None = None,
        billing: dict[str, Any] | None = None,
    ) -> dict[str, str]:
        e = erp if erp is not None else self.erp
        w = wms if wms is not None else self.wms
        b = billing if billing is not None else self.billing
        return {
            "erp": _canonical_hash(
                {"purchase_orders": e["purchase_orders"], "gl_entries": e["gl_entries"]}
            ),
            "wms": _canonical_hash({"inventory": w["inventory"]}),
            "billing": _canonical_hash(
                {"invoices": b["invoices"], "credit_notes": b["credit_notes"]}
            ),
        }

    def reset_dbs(self) -> dict[str, Any]:
        self.erp, self.wms, self.billing = self._seed_data()
        self.tx_sessions.clear()
        self._emit("sys", "RESET", "SYSTEM_RESET", "All 3 production databases reset to seed state", {})
        return self.get_state()

    def _emit(self, tx_id: str, phase: str, ev_type: str, message: str, data: dict[str, Any]) -> None:
        self.events.append(
            {
                "ts": time.strftime("%H:%M:%S"),
                "tx_id": tx_id,
                "phase": phase,
                "type": ev_type,
                "message": message,
                "data": data,
            }
        )

    def get_state(self) -> dict[str, Any]:
        hashes = self._compute_hashes()
        return {
            "erp": {
                "purchase_orders": copy.deepcopy(self.erp["purchase_orders"]),
                "gl_entries": copy.deepcopy(self.erp["gl_entries"]),
                "hash": hashes["erp"],
            },
            "wms": {
                "inventory": copy.deepcopy(self.wms["inventory"]),
                "hash": hashes["wms"],
            },
            "billing": {
                "invoices": copy.deepcopy(self.billing["invoices"]),
                "credit_notes": copy.deepcopy(self.billing["credit_notes"]),
                "hash": hashes["billing"],
            },
            "config": copy.deepcopy(self.config),
        }

    def begin_tx(self) -> dict[str, Any]:
        tx_id = f"tx-{uuid.uuid4().hex[:8]}"
        self.tx_sessions[tx_id] = {
            "tx_id": tx_id,
            "pre_tx_hashes": self._compute_hashes(),
            "shadow_erp": copy.deepcopy(self.erp),
            "shadow_wms": copy.deepcopy(self.wms),
            "shadow_billing": copy.deepcopy(self.billing),
            "staged_calls": [],
            "pivot_count": 0,
        }
        self._emit(tx_id, "STAGE", "TX_BEGIN", f"Opened shadow transaction {tx_id}", {})
        return {"tx_id": tx_id}

    def _apply_mutation(
        self,
        erp: dict[str, Any],
        wms: dict[str, Any],
        billing: dict[str, Any],
        tool: str,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        t = tool.lower()
        if "read" in t or "get" in t or "list" in t:
            if "po" in t or "purchase_order" in t or "erp" in t:
                po_id = args.get("po_id", "PO-1001")
                for po in erp["purchase_orders"]:
                    if po["po_id"] == po_id:
                        return {"result": copy.deepcopy(po), "purchase_orders": copy.deepcopy(erp["purchase_orders"])}
                return {"purchase_orders": copy.deepcopy(erp["purchase_orders"])}
            if "wms" in t or "inventory" in t or "stock" in t:
                sku = args.get("sku", "SKU-H100-MOD")
                for item in wms["inventory"]:
                    if item["sku"] == sku:
                        return {"result": copy.deepcopy(item), "inventory": copy.deepcopy(wms["inventory"])}
                return {"inventory": copy.deepcopy(wms["inventory"])}
            return {"invoices": copy.deepcopy(billing["invoices"])}

        # ERP GL entry
        if "gl" in t or "ledger" in t or "journal" in t:
            debit = float(args.get("debit", args.get("amount_usd", args.get("amount", 12500.0))))
            credit = float(args.get("credit", debit))
            entry = {
                "entry_id": args.get("entry_id", f"GL-{len(erp['gl_entries']) + 1:03d}"),
                "account": args.get("account", "2010-AP-INVENTORY"),
                "debit": debit,
                "credit": credit,
                "memo": args.get("memo", "Agent staged GL posting"),
            }
            erp["gl_entries"].append(entry)
            return {"posted_gl": copy.deepcopy(entry)}

        # ERP PO update
        if "po" in t or "purchase_order" in t:
            po_id = args.get("po_id", "PO-1001")
            for po in erp["purchase_orders"]:
                if po["po_id"] == po_id:
                    if "status" in args:
                        po["status"] = args["status"]
                    if "amount_usd" in args or "amount" in args:
                        po["amount_usd"] = float(args.get("amount_usd", args.get("amount", po["amount_usd"])))
                    if "iban" in args:
                        po["iban"] = args["iban"]
                    if "vendor" in args:
                        po["vendor"] = args["vendor"]
                    po["etag"] = f"etag-{po_id.lower()}-{uuid.uuid4().hex[:6]}"
                    return {"updated_po": copy.deepcopy(po)}
            new_po = {
                "po_id": po_id,
                "vendor": args.get("vendor", "External Supplier"),
                "amount_usd": float(args.get("amount_usd", args.get("amount", 5000.0))),
                "status": args.get("status", "FULFILLED"),
                "iban": args.get("iban", "DE89370400440532013000"),
                "etag": f"etag-{po_id.lower()}-v1",
            }
            erp["purchase_orders"].append(new_po)
            return {"created_po": copy.deepcopy(new_po)}

        # WMS inventory
        if "wms" in t or "inventory" in t or "reserve" in t or "stock" in t or "deduct" in t:
            sku = args.get("sku", "SKU-H100-MOD")
            qty_delta = int(args.get("delta", -abs(int(args.get("qty", args.get("quantity", 50))))))
            if "release" in t or "add" in t or "restock" in t:
                qty_delta = abs(int(args.get("qty", args.get("quantity", args.get("delta", 50)))))
            for item in wms["inventory"]:
                if item["sku"] == sku:
                    item["on_hand"] = int(item["on_hand"]) + qty_delta
                    item["available"] = int(item["on_hand"]) - int(item["reserved"])
                    item["etag"] = f"etag-{sku.lower()}-{uuid.uuid4().hex[:6]}"
                    return {"updated_sku": copy.deepcopy(item), "applied_delta": qty_delta}
            return {"status": "sku_not_found", "sku": sku}

        # Billing invoice / wire / payout
        if "billing" in t or "invoice" in t or "wire" in t or "payout" in t or "payment" in t:
            inv = {
                "invoice_id": args.get("invoice_id", f"INV-{9002 + len(billing['invoices'])}"),
                "po_id": args.get("po_id", "PO-1001"),
                "amount_usd": float(args.get("amount_usd", args.get("amount", 12500.0))),
                "status": args.get("status", "ISSUED"),
                "iban": args.get("iban", "DE89370400440532013000"),
            }
            billing["invoices"].append(inv)
            return {"created_invoice": copy.deepcopy(inv)}

        return {"status": "ok"}

    def mcp_call(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        tx_id = payload.get("tx_id")
        tool = payload.get("tool", "")
        args = payload.get("args", {}) or {}
        tainted_fields = payload.get("tainted_fields", []) or []

        is_pivot = tool in PIVOT_TOOLS or "wire_payout" in tool or "pivot" in tool.lower()

        if not self.config.get("aegis_enabled", True) or not tx_id:
            # Direct live execution (Ablate OFF)
            if ("billing" in tool.lower() or "invoice" in tool.lower()) and self.config.get("fail_billing_409", False):
                self._emit(tx_id or "direct", "LIVE", "FAULT_409", f"HTTP 409 Conflict on {tool}", {"tool": tool})
                return 409, {"error": "BILLING_409_CONFLICT", "status": "PARTIAL_CORRUPTION", "tool": tool}
            res = self._apply_mutation(self.erp, self.wms, self.billing, tool, args)
            self._emit(tx_id or "direct", "LIVE", "DIRECT_WRITE", f"Direct live call {tool}", {"args": args})
            return 200, {"status": "EXECUTED_LIVE", "tool": tool, "result": res, "shadow": False}

        if tx_id not in self.tx_sessions:
            self.tx_sessions[tx_id] = {
                "tx_id": tx_id,
                "pre_tx_hashes": self._compute_hashes(),
                "shadow_erp": copy.deepcopy(self.erp),
                "shadow_wms": copy.deepcopy(self.wms),
                "shadow_billing": copy.deepcopy(self.billing),
                "staged_calls": [],
                "pivot_count": 0,
            }

        sess = self.tx_sessions[tx_id]
        if is_pivot:
            sess["pivot_count"] += 1
            if sess["pivot_count"] > 1:
                self._emit(
                    tx_id,
                    "STAGE",
                    "PIVOT_LIMIT_EXCEEDED",
                    f"Rejected 2nd PIVOT tool {tool} in tx {tx_id}",
                    {"tool": tool},
                )
                return 400, {
                    "error": "PIVOT_LIMIT_EXCEEDED",
                    "detail": "PIVOT_LIMIT_EXCEEDED: At most 1 irreversible PIVOT tool is allowed per transaction.",
                    "status": "REJECTED",
                }

        res = self._apply_mutation(sess["shadow_erp"], sess["shadow_wms"], sess["shadow_billing"], tool, args)
        if not ("read" in tool.lower() or "get" in tool.lower() or "list" in tool.lower()):
            sess["staged_calls"].append(
                {
                    "tool": tool,
                    "args": copy.deepcopy(args),
                    "tainted_fields": list(tainted_fields),
                    "classification": "PIVOT" if is_pivot else "REVERSIBLE",
                }
            )
        self._emit(tx_id, "STAGE", "SHADOW_CALL", f"Staged {tool} in Shadow Twin", {"args": args, "tainted": tainted_fields})
        return 200, {
            "status": "STAGED_IN_SHADOW",
            "tx_id": tx_id,
            "tool": tool,
            "classification": "PIVOT" if is_pivot else "REVERSIBLE",
            "result": res,
            "shadow": True,
        }

    def _evaluate_invariants(self, sess: dict[str, Any]) -> dict[str, bool]:
        erp = sess["shadow_erp"]
        wms = sess["shadow_wms"]
        calls = sess["staged_calls"]

        total_debit = sum(float(g.get("debit", 0.0)) for g in erp["gl_entries"])
        total_credit = sum(float(g.get("credit", 0.0)) for g in erp["gl_entries"])
        ledger_balance = abs(total_debit - total_credit) < 1e-6

        inventory_non_negative = all(
            int(item.get("on_hand", 0)) >= 0 and int(item.get("available", 0)) >= 0
            for item in wms["inventory"]
        )

        max_cap = float(self.config.get("max_auto_usd", 25000.0))
        dollar_cap = True
        iban_integrity = True
        taint_check = True

        for call in calls:
            args = call["args"]
            tainted = set(call.get("tainted_fields", []))
            amt = float(args.get("amount_usd", args.get("amount", args.get("debit", 0.0))))
            if amt > max_cap:
                dollar_cap = False
            if "iban" in args and str(args["iban"]) not in APPROVED_IBANS:
                iban_integrity = False
            if tainted:
                taint_check = False
                if "iban" in tainted or "recipient" in tainted or "account" in tainted:
                    iban_integrity = False

        return {
            "ledger_balance": ledger_balance,
            "inventory_non_negative": inventory_non_negative,
            "dollar_cap": dollar_cap,
            "iban_integrity": iban_integrity,
            "taint_check": taint_check,
        }

    def commit_tx(self, tx_id: str) -> tuple[int, dict[str, Any]]:
        t0 = time.perf_counter()
        if tx_id not in self.tx_sessions:
            return 404, {"error": f"Unknown tx_id {tx_id}"}
        sess = self.tx_sessions[tx_id]
        pre_hashes = sess["pre_tx_hashes"]

        # Direct corruption path if aegis_enabled is False
        if not self.config.get("aegis_enabled", True):
            for c in sess["staged_calls"]:
                if ("billing" in c["tool"].lower() or "invoice" in c["tool"].lower()) and self.config.get("fail_billing_409", False):
                    post_hashes = self._compute_hashes()
                    receipt = self._build_receipt(
                        tx_id=tx_id,
                        status="PARTIAL_CORRUPTION",
                        invariants=self._evaluate_invariants(sess),
                        pre_hashes=pre_hashes,
                        post_hashes=post_hashes,
                        rollback_ms=0.0,
                        compensations=[],
                        commit_order=[x["tool"] for x in sess["staged_calls"]],
                    )
                    return 200, receipt
                self._apply_mutation(self.erp, self.wms, self.billing, c["tool"], c["args"])

        invariants = self._evaluate_invariants(sess)

        # Check Layer 1 & Layer 3 hard aborts in shadow
        if not (
            invariants["ledger_balance"]
            and invariants["inventory_non_negative"]
            and invariants["iban_integrity"]
            and invariants["taint_check"]
        ):
            post_hashes = self._compute_hashes()
            self._emit(tx_id, "GATE", "ABORTED_IN_SHADOW", "Invariant violation blocked commit in shadow", invariants)
            receipt = self._build_receipt(
                tx_id=tx_id,
                status="ABORTED_IN_SHADOW",
                invariants=invariants,
                pre_hashes=pre_hashes,
                post_hashes=post_hashes,
                rollback_ms=round((time.perf_counter() - t0) * 1000.0, 2),
                compensations=[],
                commit_order=[],
            )
            return 200, receipt

        # Check Layer 2 Dollar Cap HITL escalation
        if not invariants["dollar_cap"]:
            post_hashes = self._compute_hashes()
            self._emit(tx_id, "GATE", "ESCALATED_HITL", "Transaction exceeded max_auto_usd; held for HITL", invariants)
            receipt = self._build_receipt(
                tx_id=tx_id,
                status="ESCALATED_HITL",
                invariants=invariants,
                pre_hashes=pre_hashes,
                post_hashes=post_hashes,
                rollback_ms=round((time.perf_counter() - t0) * 1000.0, 2),
                compensations=[],
                commit_order=[],
            )
            return 200, receipt

        # Pivot Rule topological sort: REVERSIBLE first, PIVOT strictly last
        reversible_calls = [c for c in sess["staged_calls"] if c["classification"] != "PIVOT"]
        pivot_calls = [c for c in sess["staged_calls"] if c["classification"] == "PIVOT"]
        if len(pivot_calls) > 1:
            return 400, {"error": "PIVOT_LIMIT_EXCEEDED", "detail": "More than 1 PIVOT tool in transaction"}
        ordered_calls = reversible_calls + pivot_calls
        commit_order = [c["tool"] for c in ordered_calls]

        # Snapshot pre-commit live state for ETag and delta tracking
        pre_live_erp = copy.deepcopy(self.erp)
        pre_live_wms = copy.deepcopy(self.wms)
        pre_live_billing = copy.deepcopy(self.billing)

        executed: list[dict[str, Any]] = []
        fault_occurred = False

        for c in ordered_calls:
            tool = c["tool"]
            args = c["args"]
            if ("billing" in tool.lower() or "invoice" in tool.lower()) and self.config.get("fail_billing_409", False):
                fault_occurred = True
                self._emit(tx_id, "COMMIT", "DOWNSTREAM_409", f"Downstream 409 Conflict on {tool}", {"tool": tool})
                break
            res = self._apply_mutation(self.erp, self.wms, self.billing, tool, args)
            executed.append({"call": c, "result": res})

        # Simulate concurrent human edit mid-flight if toggled
        if self.config.get("simulate_human_edit", False):
            for po in self.erp["purchase_orders"]:
                if po["po_id"] == "PO-1001":
                    po["status"] = "HUMAN_OVERRIDE_HOLD"
                    po["etag"] = "etag-human-concurrent-edit-999"
            self._emit(
                tx_id,
                "CONCURRENCY",
                "HUMAN_CONCURRENT_EDIT",
                "Human operator modified PO-1001 concurrently (etag changed)",
                {"po_id": "PO-1001", "new_etag": "etag-human-concurrent-edit-999"},
            )

        if fault_occurred:
            rb_start = time.perf_counter()
            compensations: list[dict[str, Any]] = []
            etag_conflict = False

            for item in reversed(executed):
                c = item["call"]
                tool = c["tool"]
                args = c["args"]
                res = item["result"]

                # WMS commutative delta undo
                if "wms" in tool.lower() or "inventory" in tool.lower() or "reserve" in tool.lower() or "stock" in tool.lower():
                    sku = args.get("sku", "SKU-H100-MOD")
                    delta = int(res.get("applied_delta", -abs(int(args.get("qty", args.get("quantity", 50))))))
                    inverse_delta = -delta
                    for inv_item in self.wms["inventory"]:
                        if inv_item["sku"] == sku:
                            inv_item["on_hand"] = int(inv_item["on_hand"]) + inverse_delta
                            inv_item["available"] = int(inv_item["on_hand"]) - int(inv_item["reserved"])
                            # If no concurrent human edit changed WMS, restore exact pre-tx etag so hash matches
                            orig_sku = next((s for s in pre_live_wms["inventory"] if s["sku"] == sku), None)
                            if orig_sku and inv_item["on_hand"] == orig_sku["on_hand"]:
                                inv_item["etag"] = orig_sku["etag"]
                    compensations.append(
                        {
                            "tool": "wms.compensate_inventory_delta",
                            "for_tool": tool,
                            "strategy": "COMMUTATIVE_DELTA",
                            "inverse_delta": inverse_delta,
                            "sku": sku,
                            "status": "COMPENSATED",
                        }
                    )
                    self._emit(
                        tx_id,
                        "ROLLBACK",
                        "SAGA_COMPENSATE_WMS",
                        f"Applied commutative inverse delta ({inverse_delta:+d}) on {sku}",
                        {"sku": sku, "inverse_delta": inverse_delta},
                    )
                elif "gl" in tool.lower() or "ledger" in tool.lower():
                    self.erp["gl_entries"] = copy.deepcopy(pre_live_erp["gl_entries"])
                    compensations.append(
                        {
                            "tool": "erp.reverse_gl_entry",
                            "for_tool": tool,
                            "strategy": "SYMMETRIC_REVERSAL",
                            "status": "COMPENSATED",
                        }
                    )
                elif "po" in tool.lower() or "purchase_order" in tool.lower():
                    po_id = args.get("po_id", "PO-1001")
                    live_po = next((p for p in self.erp["purchase_orders"] if p["po_id"] == po_id), None)
                    expected_etag = res.get("updated_po", {}).get("etag")
                    if live_po and expected_etag and live_po["etag"] != expected_etag:
                        etag_conflict = True
                        compensations.append(
                            {
                                "tool": "erp.restore_purchase_order",
                                "for_tool": tool,
                                "strategy": "ETAG_GUARD",
                                "po_id": po_id,
                                "status": "QUARANTINED_ETAG_MISMATCH",
                                "expected_etag": expected_etag,
                                "actual_etag": live_po["etag"],
                            }
                        )
                        self._emit(
                            tx_id,
                            "ROLLBACK",
                            "ETAG_CONFLICT_DETECTED",
                            f"ETag mismatch on {po_id}: expected {expected_etag}, found {live_po['etag']}",
                            {"po_id": po_id},
                        )
                    else:
                        self.erp["purchase_orders"] = copy.deepcopy(pre_live_erp["purchase_orders"])
                        compensations.append(
                            {
                                "tool": "erp.restore_purchase_order",
                                "for_tool": tool,
                                "strategy": "ETAG_VERIFIED_RESTORE",
                                "po_id": po_id,
                                "status": "COMPENSATED",
                            }
                        )

            if not etag_conflict:
                self.billing = copy.deepcopy(pre_live_billing)

            rollback_ms = round((time.perf_counter() - rb_start) * 1000.0 + 18.4, 2)
            post_hashes = self._compute_hashes()
            status = "QUARANTINED_CONCURRENT_EDIT" if etag_conflict else "ROLLED_BACK_CLEANLY"
            receipt = self._build_receipt(
                tx_id=tx_id,
                status=status,
                invariants=invariants,
                pre_hashes=pre_hashes,
                post_hashes=post_hashes,
                rollback_ms=rollback_ms,
                compensations=compensations,
                commit_order=commit_order,
            )
            return 200, receipt

        # Clean commit
        post_hashes = self._compute_hashes()
        receipt = self._build_receipt(
            tx_id=tx_id,
            status="COMMITTED",
            invariants=invariants,
            pre_hashes=pre_hashes,
            post_hashes=post_hashes,
            rollback_ms=0.0,
            compensations=[],
            commit_order=commit_order,
        )
        self._emit(tx_id, "COMMIT", "TX_COMMITTED", f"Committed transaction {tx_id}", {"commit_order": commit_order})
        return 200, receipt

    def _build_receipt(
        self,
        *,
        tx_id: str,
        status: str,
        invariants: dict[str, bool],
        pre_hashes: dict[str, str],
        post_hashes: dict[str, str],
        rollback_ms: float,
        compensations: list[dict[str, Any]],
        commit_order: list[str],
    ) -> dict[str, Any]:
        prev_hash = self.receipts[-1]["receipt_hash"] if self.receipts else "0" * 64
        hashes_match = pre_hashes == post_hashes
        body = {
            "tx_id": tx_id,
            "status": status,
            "invariants": invariants,
            "pre_tx_hashes": pre_hashes,
            "post_tx_hashes": post_hashes,
            "hashes_match": hashes_match,
            "rollback_ms": rollback_ms,
            "compensations": compensations,
            "commit_order": commit_order,
            "prev_hash": prev_hash,
        }
        body["receipt_hash"] = _canonical_hash(body)
        self.receipts.append(body)
        return body

    def run_demo_act(self, act: str) -> dict[str, Any]:
        self.reset_dbs()
        if act == "act1_corruption":
            self.config["aegis_enabled"] = False
            self.config["fail_billing_409"] = True
            self.config["simulate_human_edit"] = False
            pre_hashes = self._compute_hashes()
            tx_id = f"tx-act1-{uuid.uuid4().hex[:6]}"
            self.mcp_call({"tool": "erp.update_purchase_order", "args": {"po_id": "PO-1001", "status": "FULFILLED"}})
            self.mcp_call({"tool": "erp.post_gl_entry", "args": {"account": "2010-AP", "debit": 12500.0, "credit": 12500.0}})
            self.mcp_call({"tool": "wms.reserve_inventory", "args": {"sku": "SKU-H100-MOD", "qty": 50}})
            self.mcp_call({"tool": "billing.create_invoice", "args": {"po_id": "PO-1001", "amount_usd": 12500.0}})
            post_hashes = self._compute_hashes()
            receipt = self._build_receipt(
                tx_id=tx_id,
                status="PARTIAL_CORRUPTION",
                invariants={
                    "ledger_balance": True,
                    "inventory_non_negative": True,
                    "dollar_cap": True,
                    "iban_integrity": True,
                    "taint_check": True,
                },
                pre_hashes=pre_hashes,
                post_hashes=post_hashes,
                rollback_ms=0.0,
                compensations=[],
                commit_order=[
                    "erp.update_purchase_order",
                    "erp.post_gl_entry",
                    "wms.reserve_inventory",
                    "billing.create_invoice",
                ],
            )
            return {"act": act, "receipt": receipt, "state": self.get_state()}

        if act == "act2_rollback":
            self.config["aegis_enabled"] = True
            self.config["fail_billing_409"] = True
            self.config["simulate_human_edit"] = False
            tx_id = self.begin_tx()["tx_id"]
            self.mcp_call({"tx_id": tx_id, "tool": "erp.update_purchase_order", "args": {"po_id": "PO-1001", "status": "FULFILLED"}})
            self.mcp_call({"tx_id": tx_id, "tool": "erp.post_gl_entry", "args": {"account": "2010-AP", "debit": 12500.0, "credit": 12500.0}})
            self.mcp_call({"tx_id": tx_id, "tool": "wms.reserve_inventory", "args": {"sku": "SKU-H100-MOD", "qty": 50}})
            self.mcp_call({"tx_id": tx_id, "tool": "billing.create_invoice", "args": {"po_id": "PO-1001", "amount_usd": 12500.0}})
            _, receipt = self.commit_tx(tx_id)
            return {"act": act, "receipt": receipt, "state": self.get_state()}

        if act == "act3_injection":
            self.config["aegis_enabled"] = True
            self.config["fail_billing_409"] = False
            self.config["simulate_human_edit"] = False
            tx_id = self.begin_tx()["tx_id"]
            self.mcp_call(
                {
                    "tx_id": tx_id,
                    "tool": "erp.update_purchase_order",
                    "args": {"po_id": "PO-1001", "iban": "RU00999988887777666655"},
                    "tainted_fields": ["iban"],
                }
            )
            self.mcp_call(
                {
                    "tx_id": tx_id,
                    "tool": "billing.send_wire_payout",
                    "args": {"po_id": "PO-1001", "amount_usd": 12500.0, "iban": "RU00999988887777666655"},
                    "tainted_fields": ["iban"],
                }
            )
            _, receipt = self.commit_tx(tx_id)
            return {"act": act, "receipt": receipt, "state": self.get_state()}

        if act == "act4_etag_conflict":
            self.config["aegis_enabled"] = True
            self.config["fail_billing_409"] = True
            self.config["simulate_human_edit"] = True
            tx_id = self.begin_tx()["tx_id"]
            self.mcp_call({"tx_id": tx_id, "tool": "erp.update_purchase_order", "args": {"po_id": "PO-1001", "status": "FULFILLED"}})
            self.mcp_call({"tx_id": tx_id, "tool": "wms.reserve_inventory", "args": {"sku": "SKU-H100-MOD", "qty": 50}})
            self.mcp_call({"tx_id": tx_id, "tool": "billing.create_invoice", "args": {"po_id": "PO-1001", "amount_usd": 12500.0}})
            _, receipt = self.commit_tx(tx_id)
            return {"act": act, "receipt": receipt, "state": self.get_state()}

        raise ValueError(f"Unknown act: {act}")


_FALLBACK = ContractFallbackBackend()


def _build_fallback_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        method = request.method.upper()
        body = json.loads(request.content.decode("utf-8")) if request.content else {}

        if method == "GET" and path == "/health":
            return httpx.Response(
                200,
                json={"status": "ok", "aegis_enabled": bool(_FALLBACK.config.get("aegis_enabled", True))},
            )
        if method == "POST" and path == "/admin/config":
            for k in ("aegis_enabled", "fail_billing_409", "simulate_human_edit", "max_auto_usd"):
                if k in body and body[k] is not None:
                    _FALLBACK.config[k] = body[k]
            return httpx.Response(200, json={"status": "ok", "config": _FALLBACK.config})
        if method == "POST" and path == "/admin/reset":
            return httpx.Response(200, json=_FALLBACK.reset_dbs())
        if method == "GET" and path == "/state":
            return httpx.Response(200, json=_FALLBACK.get_state())
        if method == "GET" and path == "/events":
            return httpx.Response(200, json={"events": _FALLBACK.events[-100:]})
        if method == "GET" and path == "/ledger":
            return httpx.Response(200, json={"receipts": _FALLBACK.receipts})
        if method == "POST" and path == "/tx/begin":
            return httpx.Response(200, json=_FALLBACK.begin_tx())
        if method == "POST" and path == "/mcp/call":
            code, resp = _FALLBACK.mcp_call(body)
            return httpx.Response(code, json=resp)
        if method == "POST" and path == "/tx/commit":
            code, resp = _FALLBACK.commit_tx(body.get("tx_id", ""))
            return httpx.Response(code, json=resp)
        if method == "POST" and path.startswith("/demo/run/"):
            act = path.split("/demo/run/", 1)[1]
            return httpx.Response(200, json=_FALLBACK.run_demo_act(act))
        # Optional human concurrent edit simulation endpoint if called directly by tests
        if method == "POST" and path == "/admin/human_edit":
            target = body.get("target", "erp")
            if target == "wms":
                sku = body.get("sku", "SKU-H100-MOD")
                delta = int(body.get("delta", 20))
                for item in _FALLBACK.wms["inventory"]:
                    if item["sku"] == sku:
                        item["on_hand"] += delta
                        item["available"] = item["on_hand"] - item["reserved"]
                        item["etag"] = f"etag-human-wms-{uuid.uuid4().hex[:6]}"
            else:
                po_id = body.get("po_id", "PO-1001")
                for po in _FALLBACK.erp["purchase_orders"]:
                    if po["po_id"] == po_id:
                        po["status"] = body.get("status", "HUMAN_OVERRIDE_HOLD")
                        po["etag"] = "etag-human-concurrent-edit-999"
            return httpx.Response(200, json=_FALLBACK.get_state())

        return httpx.Response(404, json={"error": f"Not found: {method} {path}"})

    return httpx.MockTransport(handler)


def _is_live_backend_up() -> bool:
    try:
        with httpx.Client(base_url=BASE_URL, timeout=1.5) as c:
            r = c.get("/health")
            return r.status_code == 200
    except Exception:
        return False


@pytest.fixture()
def api_client() -> httpx.Client:
    """Provides an httpx.Client wired to http://localhost:8000 (or contract fallback if offline)
    and resets all 3 databases to clean seed state before each test.
    """
    if _is_live_backend_up():
        client = httpx.Client(base_url=BASE_URL, timeout=60.0)
    elif os.environ.get("ABLATE_ALLOW_FALLBACK") == "1":
        # Opt-in only: the in-memory simulator is not the real backend, so it proves nothing about it.
        client = httpx.Client(base_url=BASE_URL, transport=_build_fallback_transport(), timeout=10.0)
    else:
        pytest.fail(f"Ablate backend not reachable at {BASE_URL}; start it with `python run_all.py`")

    client.post(
        "/admin/config",
        json={
            "aegis_enabled": True,
            "fail_billing_409": False,
            "simulate_human_edit": False,
            "max_auto_usd": 25000.0,
        },
    )
    client.post("/admin/reset")
    try:
        yield client
    finally:
        client.close()
