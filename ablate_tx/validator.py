"""3-Layer Pre-Flight Validator. Pure code: zero LLM tokens.

Layer 1  deterministic business invariants over the shadow end-state
Layer 2  provenance taint check (untrusted EDI text steering money/IBAN fields)
Layer 3  native dry-run against live APIs that support it
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

from services.common import ToolError

from .registry import get_spec

PASS, FAIL, ESCALATE = "PASS", "FAIL", "ESCALATE_HITL"

INJECTION_PATTERNS = [
    r"system\s+override",
    r"ignore\s+(all\s+|any\s+)?(previous|prior|above)\s+instructions",
    r"disregard\s+(the\s+)?(previous|above|policy)",
    r"you\s+are\s+now",
    r"\bwire\s+\$?\s?[\d,]{4,}",
    r"new\s+(bank|iban|account)\s+(details|number)",
]
_INJ = [re.compile(p, re.I) for p in INJECTION_PATTERNS]
PROTECTED_FIELDS = ("vendor_iban", "amount_usd")
EXPOSURE_TOOLS = {"billing.issue_credit_note", "billing.send_wire_payout"}


@dataclass
class Check:
    name: str
    layer: int
    result: str
    detail: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


def _strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _strings(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _strings(v)


def layer1(tx, twin, services, config) -> list[Check]:
    checks: list[Check] = []
    # ledger_balance: every GL entry in the shadow end-state balances
    gl = twin.snapshot(tx, "erp")["gl_entries"] if any(s.tool.startswith("erp.") for s in tx.staged) else []
    bad = [g for g in gl if round(g["debit"], 2) != round(g["credit"], 2)]
    checks.append(Check("ledger_balance", 1, FAIL if bad else PASS, {"unbalanced": bad}))

    # inventory_non_negative
    inv = twin.snapshot(tx, "wms")["inventory"] if any(s.tool.startswith("wms.") for s in tx.staged) else []
    neg = [i for i in inv if i["on_hand"] - i["reserved"] < 0 or i["reserved"] < 0]
    checks.append(Check("inventory_non_negative", 1, FAIL if neg else PASS, {"violations": neg}))

    # dollar_cap: each money argument, and the total exposure the tx moves to the vendor
    # (credit notes + wires). GL adjustments are internal bookkeeping, not exposure.
    cap = float(config.get("max_auto_usd", 5000.0))
    over, total = [], 0.0
    for s in tx.staged:
        for a in get_spec(s.tool).money_args:
            if a in s.args:
                v = float(s.args[a])
                if s.tool in EXPOSURE_TOOLS:
                    total += v
                if v > cap:
                    over.append({"tool": s.tool, "arg": a, "value": v})
    if total > cap and not over:
        over.append({"tool": "total_exposure", "arg": "sum", "value": total})
    checks.append(Check("dollar_cap", 1, ESCALATE if over else PASS,
                        {"max_auto_usd": cap, "total_exposure_usd": total, "over": over}))

    # iban_integrity: no call may introduce an IBAN differing from vendor master data
    viol = []
    for s in tx.staged:
        if "vendor_iban" in s.args:
            inv_id = s.args.get("invoice_id")
            master = services["billing"].get_row("invoices", inv_id) if inv_id else None
            if not master or master["vendor_iban"] != s.args["vendor_iban"]:
                viol.append({"tool": s.tool, "requested": s.args["vendor_iban"],
                             "master": master["vendor_iban"] if master else None})
    checks.append(Check("iban_integrity", 1, FAIL if viol else PASS, {"violations": viol}))
    return checks


def call_findings(tool: str, args: dict, tainted_fields: list[str], untrusted: str) -> list[dict]:
    """Taint findings for ONE call. Used at call time (immediate feedback to the agent)
    and again at commit over every staged call."""
    findings = []
    for f in tainted_fields:
        if f in PROTECTED_FIELDS or f in args:
            findings.append({"tool": tool, "field": f, "reason": "declared tainted"})
    for text in _strings(args):
        for rx in _INJ:
            if rx.search(text):
                findings.append({"tool": tool, "reason": "injection pattern", "pattern": rx.pattern,
                                 "text": text[:160]})
    # provenance: money/IBAN values on a payout that appear only in untrusted EDI text
    if untrusted and tool == "billing.send_wire_payout":
        for f in PROTECTED_FIELDS:
            if f in args:
                v = args[f]
                variants = {str(v)}
                if isinstance(v, (int, float)):
                    variants |= {f"{v:,.0f}", f"{int(v)}", f"{v:,.2f}"}
                if any(x and x in untrusted for x in variants):
                    findings.append({"tool": tool, "field": f, "value": v,
                                     "reason": "value originates from untrusted EDI memo"})
    return findings


def layer2(tx) -> list[Check]:
    untrusted = " ".join(tx.untrusted_context)
    findings = []
    for s in tx.staged:
        findings += call_findings(s.tool, s.args, s.tainted_fields, untrusted)
    return [Check("provenance_taint", 2, FAIL if findings else PASS, {"findings": findings})]


def layer3(tx, services) -> list[Check]:
    out = []
    for s in tx.staged:
        spec = get_spec(s.tool)
        if not spec.supports_dry_run:
            continue
        try:
            res = services[spec.service].call(spec.method, {**s.args, "dry_run": True}, live=True)
            out.append(Check(f"dry_run:{s.tool}", 3, PASS, {"response": res}))
        except ToolError as e:
            out.append(Check(f"dry_run:{s.tool}", 3, FAIL, e.to_dict()))
    if not out:
        out.append(Check("dry_run", 3, PASS, {"note": "no staged tool supports dry_run"}))
    return out


def validate(tx, twin, services, config) -> tuple[str, list[dict]]:
    """Returns (verdict, checks). verdict: PASS | ABORT | TAINT | ESCALATE."""
    l1 = layer1(tx, twin, services, config)
    l2 = layer2(tx)
    checks = l1 + l2
    if any(c.result == FAIL for c in l2):
        return "TAINT", [c.to_dict() for c in checks]
    if any(c.result == FAIL for c in l1):
        return "ABORT", [c.to_dict() for c in checks]
    if any(c.result == ESCALATE for c in l1):
        return "ESCALATE", [c.to_dict() for c in checks]
    l3 = layer3(tx, services)
    checks += l3
    if any(c.result == FAIL for c in l3):
        return "ABORT", [c.to_dict() for c in checks]
    return "PASS", [c.to_dict() for c in checks]
