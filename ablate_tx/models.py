"""Pydantic models for the proxy's public data: invariant results, compensation
records and the sealed TxReceipt. The ledger validates every receipt against
TxReceipt before sealing it, so a malformed receipt fails loudly at the source."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

TxStatus = Literal[
    "COMMITTED", "ROLLED_BACK_CLEANLY", "ABORTED_IN_SHADOW", "ESCALATED_HITL",
    "QUARANTINED_CONCURRENT_EDIT", "PARTIAL_CORRUPTION",
]


class InvariantResult(BaseModel):
    name: str
    layer: int
    result: Literal["PASS", "FAIL", "ESCALATE_HITL", "SKIPPED"]
    detail: dict[str, Any] = Field(default_factory=dict)


class CompensationRecord(BaseModel):
    model_config = ConfigDict(extra="allow")
    step: int
    tool: str
    strategy: Literal["DELTA", "ETAG_RESTORE", "VOID_BY_ID", "NONE"]
    status: Literal["COMPENSATED", "QUARANTINED_CONCURRENT_EDIT", "COMPENSATION_FAILED", "NOT_COMPENSABLE"]


class TxReceipt(BaseModel):
    model_config = ConfigDict(extra="allow")
    tx_id: str
    ts: str
    status: TxStatus
    aegis_enabled: bool
    invariants: dict[str, bool]
    invariant_checks: list[InvariantResult]
    pre_tx_hashes: dict[str, str]
    post_tx_hashes: dict[str, str]
    hashes_match: bool
    rollback_ms: Optional[float]
    compensations: list[CompensationRecord]
    commit_order: list[str]
    steps: list[dict[str, Any]]
    failure: Optional[dict[str, Any]]
    quarantine: list[dict[str, Any]]
    prev_hash: str = Field(min_length=64, max_length=64)
    receipt_hash: str = Field(min_length=64, max_length=64)
