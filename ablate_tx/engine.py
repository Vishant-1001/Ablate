"""Ablate transaction engine: ties registry, shadow twin, validator, planner,
saga and ledger together. The HTTP layer and the ADK agent both call into this."""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

from services import BillingService, ERPService, WMSService
from services.common import DB_LOCK, ToolError

from .ledger import Ledger
from .registry import PIVOT, get_spec
from .saga import SagaCoordinator, all_hashes, idem_key
from .shadow_twin import ShadowTwin, Transaction, new_tx_id
from .validator import validate

DEFAULT_CONFIG = {
    "aegis_enabled": True,
    "fail_billing_409": False,
    "simulate_human_edit": False,
    "max_auto_usd": 5000.0,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class Engine:
    def __init__(self) -> None:
        self.config: dict = dict(DEFAULT_CONFIG)
        self.services = {
            "erp": ERPService(self.config),
            "wms": WMSService(self.config),
            "billing": BillingService(self.config),
        }
        self.twin = ShadowTwin(self.services)
        self.saga = SagaCoordinator(self.services, self.emit)
        self.ledger = Ledger()
        self.events: list[dict] = []
        self._ev_lock = threading.Lock()
        self.txs: dict[str, Transaction] = {}

    # -- events / config / state --------------------------------------
    def emit(self, tx_id: str, phase: str, type_: str, message: str, data: dict | None = None) -> None:
        with self._ev_lock:
            self.events.append({"ts": _now(), "tx_id": tx_id or "", "phase": phase, "type": type_,
                                "message": message, "data": data or {}})

    def update_config(self, patch: dict) -> dict:
        for k in DEFAULT_CONFIG:
            if k in patch and patch[k] is not None:
                self.config[k] = float(patch[k]) if k == "max_auto_usd" else bool(patch[k])
        self.emit("", "ADMIN", "CONFIG", "config updated", dict(self.config))
        return dict(self.config)

    def state(self) -> dict:
        with DB_LOCK:
            return {
                "erp": self.services["erp"].snapshot(),
                "wms": self.services["wms"].snapshot(),
                "billing": self.services["billing"].snapshot(),
                "config": dict(self.config),
            }

    def reset(self) -> dict:
        with DB_LOCK:
            for s in self.services.values():
                s.reset()
            for tx in self.txs.values():
                self.twin.discard(tx)
            self.txs.clear()
        with self._ev_lock:
            self.events.clear()
        self.emit("", "ADMIN", "RESET", "all services reset to seed state", all_hashes(self.services))
        return self.state()

    # -- transactions -------------------------------------------------
    def begin(self, untrusted_context: list[str] | None = None) -> str:
        tx = Transaction(new_tx_id(), aegis=bool(self.config["aegis_enabled"]))
        tx.pre_tx_hashes = all_hashes(self.services)
        tx.untrusted_context = list(untrusted_context or [])
        self.txs[tx.tx_id] = tx
        self.emit(tx.tx_id, "BEGIN", "TX_BEGIN",
                  f"transaction opened ({'AEGIS shadow mode' if tx.aegis else 'AEGIS OFF: live passthrough'})",
                  {"pre_tx_hashes": tx.pre_tx_hashes})
        return tx.tx_id

    def _tx(self, tx_id: str) -> Transaction:
        tx = self.txs.get(tx_id)
        if tx is None:
            raise ToolError(404, f"unknown tx_id {tx_id}")
        if tx.closed:
            raise ToolError(409, f"transaction {tx_id} already closed")
        return tx

    def call(self, tx_id: str | None, tool: str, args: dict, tainted_fields: list[str] | None = None) -> dict:
        spec = get_spec(tool)
        if spec.internal:
            raise ToolError(403, f"{tool} is an internal compensator and cannot be called directly")
        args = dict(args or {})
        tainted = list(tainted_fields or [])

        if not tx_id:
            if spec.mutating and self.config["aegis_enabled"]:
                # implicit single-call transaction so the guarantees still hold
                tid = self.begin()
                staged = self.call(tid, tool, args, tainted)
                receipt = self.commit(tid)
                return {"ok": receipt["status"] == "COMMITTED", "mode": "implicit_tx", "tx_id": tid,
                        "result": staged.get("result"), "receipt": receipt}
            res = self.services[spec.service].call(spec.method, args, live=True)
            self.emit("", "LIVE", "LIVE_CALL", f"{tool} executed live (no tx)", {"args": args, "result": res})
            return {"ok": True, "mode": "live", "tx_id": None, "result": res}

        tx = self._tx(tx_id)
        if not tx.aegis:
            # AEGIS OFF: straight to production, exactly like an unguarded agent
            if spec.mutating:
                args.setdefault("idempotency_key", idem_key(tx.tx_id, len(tx.live_steps), tool, args))
            try:
                res = self.services[spec.service].call(spec.method, args, live=True)
            except ToolError as e:
                if spec.mutating:
                    tx.live_failure = tx.live_failure or {"tool": tool, **e.to_dict()}
                    tx.live_steps.append({"tool": tool, "args": args, "status": "FAILED", "error": e.to_dict()})
                self.emit(tx.tx_id, "LIVE", "LIVE_FAILED", f"{tool} failed live: HTTP {e.status} {e.message}",
                          e.to_dict())
                raise
            if spec.mutating:
                tx.live_steps.append({"tool": tool, "args": args, "status": "APPLIED", "result": res})
                self.emit(tx.tx_id, "LIVE", "LIVE_WRITE", f"{tool} wrote directly to production",
                          {"args": args, "result": res})
            return {"ok": True, "mode": "live", "tx_id": tx.tx_id, "result": res}

        # AEGIS ON: stage in the shadow twin
        if spec.kind == PIVOT and any(get_spec(s.tool).kind == PIVOT for s in tx.staged):
            self.emit(tx.tx_id, "STAGE", "PIVOT_LIMIT_EXCEEDED", f"rejected second PIVOT {tool}", {"args": args})
            raise ToolError(409, "PIVOT_LIMIT_EXCEEDED", {"tool": tool, "max_pivots": 1})
        if spec.mutating:
            args.setdefault("idempotency_key", idem_key(tx.tx_id, len(tx.staged), tool, args))
        try:
            res = self.twin.execute(tx, spec, args, tainted)
        except ToolError as e:
            self.emit(tx.tx_id, "STAGE", "SHADOW_REJECTED", f"{tool} rejected in shadow: {e.message}", e.to_dict())
            raise
        if spec.mutating:
            self.emit(tx.tx_id, "STAGE", "SHADOW_WRITE", f"{tool} staged in shadow twin (0 live writes)",
                      {"args": args, "shadow_result": res, "tainted_fields": tainted})
        return {"ok": True, "mode": "shadow" if spec.mutating else "shadow_read", "tx_id": tx.tx_id,
                "result": res, "staged": spec.mutating}

    def commit(self, tx_id: str) -> dict:
        tx = self._tx(tx_id)
        t_start = time.perf_counter()
        receipt: dict = {
            "tx_id": tx.tx_id, "ts": _now(), "aegis_enabled": tx.aegis, "status": None,
            "invariants": [], "pre_tx_hashes": tx.pre_tx_hashes, "post_tx_hashes": {},
            "hashes_match": None, "rollback_ms": None, "compensations": [], "steps": [],
            "failure": None, "quarantine": [],
        }
        with DB_LOCK:
            try:
                if not tx.aegis:
                    receipt["steps"] = tx.live_steps
                    receipt["failure"] = tx.live_failure
                    receipt["status"] = "PARTIAL_CORRUPTION" if tx.live_failure else "COMMITTED"
                    receipt["invariants"] = [{"name": "aegis_disabled", "layer": 0, "result": "SKIPPED", "detail": {}}]
                else:
                    self._commit_aegis(tx, receipt)
            finally:
                tx.closed = True
                self.twin.discard(tx)
            receipt["post_tx_hashes"] = all_hashes(self.services)
        receipt["hashes_match"] = receipt["post_tx_hashes"] == receipt["pre_tx_hashes"]
        if receipt["status"] == "ROLLED_BACK_CLEANLY" and not receipt["hashes_match"]:
            receipt["status"] = "PARTIAL_CORRUPTION"
        receipt["commit_ms"] = round((time.perf_counter() - t_start) * 1000, 3)
        sealed = self.ledger.append(receipt)
        self.emit(tx.tx_id, "RECEIPT", receipt["status"],
                  f"tx {receipt['status']} (hashes_match={receipt['hashes_match']}, rollback_ms={receipt['rollback_ms']})",
                  {"receipt_hash": sealed["receipt_hash"], "pre_tx_hashes": receipt["pre_tx_hashes"],
                   "post_tx_hashes": receipt["post_tx_hashes"]})
        return sealed

    def _commit_aegis(self, tx: Transaction, receipt: dict) -> None:
        if not tx.staged:
            receipt["status"] = "COMMITTED"
            return
        try:
            verdict, checks = validate(tx, self.twin, self.services, self.config)
        except ToolError as e:  # e.g. PIVOT_LIMIT_EXCEEDED from the planner
            receipt["status"] = "ABORTED_IN_SHADOW"
            receipt["failure"] = e.to_dict()
            return
        receipt["invariants"] = checks
        for c in checks:
            self.emit(tx.tx_id, "VALIDATE", c["result"], f"L{c['layer']} {c['name']}: {c['result']}", c["detail"])
        if verdict == "TAINT":
            receipt["status"] = "ABORTED_IN_SHADOW"
            receipt["failure"] = {"reason": "TAINT_VIOLATION"}
            return
        if verdict == "ABORT":
            receipt["status"] = "ABORTED_IN_SHADOW"
            receipt["failure"] = {"reason": "INVARIANT_VIOLATION",
                                  "checks": [c["name"] for c in checks if c["result"] == "FAIL"]}
            return
        if verdict == "ESCALATE":
            receipt["status"] = "ESCALATED_HITL"
            receipt["failure"] = {"reason": "DOLLAR_CAP_EXCEEDED", "max_auto_usd": self.config["max_auto_usd"]}
            return
        self.emit(tx.tx_id, "FLUSH", "FLUSH_START", f"flushing {len(tx.staged)} staged call(s) to live services", {})
        out = self.saga.flush(tx)
        receipt.update({k: out[k] for k in ("steps", "compensations", "failure", "quarantine", "rollback_ms")})
        if out["failure"] is None:
            receipt["status"] = "COMMITTED"
        elif out["quarantine"]:
            receipt["status"] = "QUARANTINED_CONCURRENT_EDIT"
        elif all(c["status"] == "COMPENSATED" for c in out["compensations"]):
            receipt["status"] = "ROLLED_BACK_CLEANLY"
        else:
            receipt["status"] = "PARTIAL_CORRUPTION"


ENGINE: Engine | None = None


def get_engine() -> Engine:
    global ENGINE
    if ENGINE is None:
        ENGINE = Engine()
    return ENGINE
