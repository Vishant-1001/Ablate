"""Declarative Tool Compensation Registry.

Every tool the proxy exposes is classified up front. The saga coordinator never
guesses how to undo something: it reads it from here.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Callable, Optional

READ_ONLY = "READ_ONLY"
COMPENSABLE = "COMPENSABLE"
PIVOT = "PIVOT"
RETRYABLE = "RETRYABLE"

DELTA = "DELTA"
ETAG_RESTORE = "ETAG_RESTORE"
VOID_BY_ID = "VOID_BY_ID"
NONE = "NONE"


@dataclass(frozen=True)
class ToolSpec:
    name: str                       # fully-qualified, e.g. "erp.update_po_qty"
    kind: str                       # READ_ONLY | COMPENSABLE | PIVOT | RETRYABLE
    undo_strategy: str = NONE       # DELTA | ETAG_RESTORE | VOID_BY_ID | NONE
    compensator: Optional[str] = None
    # (table, arg name holding the primary key) of the entity whose pre-image is captured
    entity: Optional[tuple[str, str]] = None
    supports_dry_run: bool = False
    money_args: tuple[str, ...] = ()
    internal: bool = False          # compensators: not callable by agents via /mcp/call
    void_id_field: Optional[str] = None  # result field holding the id to void

    @property
    def service(self) -> str:
        return self.name.split(".", 1)[0]

    @property
    def method(self) -> str:
        return self.name.split(".", 1)[1]

    @property
    def mutating(self) -> bool:
        return self.kind != READ_ONLY

    def to_dict(self) -> dict:
        return asdict(self)


_SPECS = [
    ToolSpec("erp.get_po", READ_ONLY),
    ToolSpec("erp.update_po_qty", COMPENSABLE, ETAG_RESTORE, "erp.restore_po",
             entity=("purchase_orders", "po_id")),
    ToolSpec("erp.post_gl_adjustment", COMPENSABLE, VOID_BY_ID, "erp.reverse_gl_adjustment",
             entity=("purchase_orders", "po_id"), money_args=("debit",), void_id_field="entry_id"),
    ToolSpec("erp.reverse_gl_adjustment", RETRYABLE, internal=True),
    ToolSpec("erp.restore_po", RETRYABLE, internal=True),
    ToolSpec("wms.get_inventory", READ_ONLY),
    ToolSpec("wms.adjust_reservation", COMPENSABLE, DELTA, "wms.adjust_reservation",
             entity=("inventory", "sku")),
    ToolSpec("billing.get_invoice", READ_ONLY),
    ToolSpec("billing.issue_credit_note", COMPENSABLE, VOID_BY_ID, "billing.void_credit_note",
             entity=("invoices", "invoice_id"), supports_dry_run=True, money_args=("amount_usd",),
             void_id_field="credit_id"),
    ToolSpec("billing.void_credit_note", RETRYABLE, internal=True),
    ToolSpec("billing.send_wire_payout", PIVOT, NONE, entity=("invoices", "invoice_id"),
             money_args=("amount_usd",)),
]

REGISTRY: dict[str, ToolSpec] = {s.name: s for s in _SPECS}


def get_spec(tool: str) -> ToolSpec:
    spec = REGISTRY.get(tool)
    if spec is None:
        from services.common import ToolError
        raise ToolError(404, f"tool '{tool}' is not registered", {"known": sorted(REGISTRY)})
    return spec


def public_tools() -> list[dict]:
    return [s.to_dict() for s in _SPECS if not s.internal]
