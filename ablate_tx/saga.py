"""Idempotent Flush Coordinator + Reverse-Saga Compensator."""
from __future__ import annotations

import time

from services.common import ToolError, canonical_json, sha256_hex

from .planner import plan
from .registry import DELTA, ETAG_RESTORE, VOID_BY_ID, get_spec


def idem_key(tx_id: str, seq: int, tool: str, args: dict) -> str:
    clean = {k: v for k, v in args.items() if k not in ("idempotency_key", "dry_run")}
    return "ik_" + sha256_hex(f"{tx_id}|{seq}|{tool}|{canonical_json(clean)}")[:24]


def all_hashes(services) -> dict[str, str]:
    return {name: svc.state_hash() for name, svc in services.items()}


def _diff3(base: dict, ours: dict, theirs: dict) -> dict:
    keys = sorted(set(base) | set(ours) | set(theirs))
    return {k: {"base": base.get(k), "ours": ours.get(k), "theirs": theirs.get(k)}
            for k in keys if not (base.get(k) == ours.get(k) == theirs.get(k))}


class SagaCoordinator:
    def __init__(self, services, emit):
        self.services = services
        self.emit = emit

    def _live(self, tool: str, args: dict) -> dict:
        spec = get_spec(tool)
        return self.services[spec.service].call(spec.method, args, live=True)

    def flush(self, tx) -> dict:
        """Apply staged calls to live services; on fault, reverse-compensate."""
        ordered = plan(tx.staged)
        done: list[dict] = []
        out = {"steps": [], "compensations": [], "failure": None, "quarantine": [], "rollback_ms": None}
        for i, s in enumerate(ordered):
            args = {**s.args}
            args.pop("dry_run", None)
            args["idempotency_key"] = args.get("idempotency_key") or idem_key(tx.tx_id, s.seq, s.tool, s.args)
            try:
                res = self._live(s.tool, args)
                step = {"step": i, "tool": s.tool, "args": args, "result": res, "pre_image": s.pre_image}
                done.append(step)
                out["steps"].append({"step": i, "tool": s.tool, "status": "APPLIED", "result": res})
                self.emit(tx.tx_id, "FLUSH", "STEP_APPLIED", f"{s.tool} applied live", {"step": i, "result": res})
            except ToolError as e:
                out["failure"] = {"step": i, "tool": s.tool, **e.to_dict()}
                out["steps"].append({"step": i, "tool": s.tool, "status": "FAILED", "error": e.to_dict()})
                self.emit(tx.tx_id, "FLUSH", "STEP_FAILED", f"{s.tool} failed: HTTP {e.status} {e.message}",
                          out["failure"])
                t0 = time.perf_counter()
                self._compensate(tx, done, out)
                out["rollback_ms"] = round((time.perf_counter() - t0) * 1000, 3)
                break
        return out

    def _compensate(self, tx, done: list[dict], out: dict) -> None:
        self.emit(tx.tx_id, "ROLLBACK", "SAGA_START", f"Reverse-Saga over {len(done)} applied step(s)",
                  {"steps": [d["tool"] for d in done]})
        for step in reversed(done):
            spec = get_spec(step["tool"])
            key = step["args"]["idempotency_key"] + ":undo"
            rec = {"step": step["step"], "tool": spec.name, "strategy": spec.undo_strategy}
            try:
                if spec.undo_strategy == DELTA:
                    a = {"sku": step["args"]["sku"], "delta_qty": -int(step["args"]["delta_qty"]),
                         "idempotency_key": key}
                    rec["call"] = {"tool": spec.compensator, "args": a}
                    rec["result"] = self._live(spec.compensator, a)
                    rec["status"] = "COMPENSATED"
                elif spec.undo_strategy == VOID_BY_ID:
                    a = {spec.void_id_field: step["result"][spec.void_id_field], "idempotency_key": key}
                    rec["call"] = {"tool": spec.compensator, "args": a}
                    rec["result"] = self._live(spec.compensator, a)
                    rec["status"] = "COMPENSATED"
                elif spec.undo_strategy == ETAG_RESTORE:
                    self._etag_restore(tx, step, spec, key, rec, out)
                else:
                    rec["status"] = "NOT_COMPENSABLE"
            except ToolError as e:
                rec["status"] = "COMPENSATION_FAILED"
                rec["error"] = e.to_dict()
            out["compensations"].append(rec)
            self.emit(tx.tx_id, "ROLLBACK", rec["status"], f"{spec.undo_strategy} undo of {spec.name}: {rec['status']}",
                      rec)

    def _etag_restore(self, tx, step, spec, key, rec, out) -> None:
        table, arg = spec.entity
        svc = self.services[spec.service]
        pk = step["args"][arg]
        post_version = step["result"]["version"]
        live = svc.get_row(table, pk) or {}
        rec["post_step_version"] = post_version
        rec["live_version"] = live.get("version")
        if live.get("version") != post_version:
            ours = {**(step["pre_image"] or {}), "qty": step["result"].get("new_qty"), "version": post_version}
            diff = _diff3(step["pre_image"] or {}, ours, live)
            rec["status"] = "QUARANTINED_CONCURRENT_EDIT"
            rec["three_way_diff"] = diff
            out["quarantine"].append({"entity": f"{spec.service}.{table}.{pk}", "three_way_diff": diff})
            self.emit(tx.tx_id, "ROLLBACK", "ETAG_CONFLICT",
                      f"{pk}: live version {live.get('version')} != post-step {post_version}; "
                      "refusing blind overwrite of human edit", {"three_way_diff": diff})
            return
        a = {"po_id": pk, "pre_image": step["pre_image"], "expected_version": post_version, "idempotency_key": key}
        rec["call"] = {"tool": spec.compensator, "args": a}
        rec["result"] = self._live(spec.compensator, a)
        rec["status"] = "COMPENSATED"
