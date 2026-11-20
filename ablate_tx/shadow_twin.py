"""Copy-on-Write Shadow State Twin.

On first touch of a service inside a transaction, the live SQLite DB is
snapshotted into a private in-memory connection. Every call in the transaction
(reads and writes) then executes against that shadow, so the agent sees its own
writes, while the live DBs receive zero writes until commit. On first touch of
an entity we also capture the live ``pre_image`` + ``version`` for ETag-guarded
compensation later.
"""
from __future__ import annotations

import copy
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from .registry import ToolSpec


@dataclass
class StagedCall:
    seq: int
    tool: str
    args: dict
    shadow_result: dict
    tainted_fields: list[str] = field(default_factory=list)
    pre_image: dict | None = None


@dataclass
class Transaction:
    tx_id: str
    aegis: bool
    created: float = field(default_factory=time.time)
    shadow_conns: dict[str, sqlite3.Connection] = field(default_factory=dict)
    staged: list[StagedCall] = field(default_factory=list)
    pre_images: dict[str, dict] = field(default_factory=dict)  # "svc:table:pk" -> row
    untrusted_context: list[str] = field(default_factory=list)  # raw untrusted text (EDI memos)
    live_steps: list[dict] = field(default_factory=list)       # aegis OFF passthrough log
    live_failure: dict | None = None
    pre_tx_hashes: dict[str, str] = field(default_factory=dict)
    closed: bool = False
    agent: dict | None = None  # who drove the tx: {mode, model}, from the latest AGENT_MODE event


def new_tx_id() -> str:
    return "tx_" + uuid.uuid4().hex[:12]


class ShadowTwin:
    def __init__(self, services: dict):
        self.services = services

    def conn(self, tx: Transaction, svc: str) -> sqlite3.Connection:
        if svc not in tx.shadow_conns:
            tx.shadow_conns[svc] = self.services[svc].shadow_copy()
        return tx.shadow_conns[svc]

    def capture_pre_image(self, tx: Transaction, spec: ToolSpec, args: dict) -> dict | None:
        if not spec.entity:
            return None
        table, arg = spec.entity
        pk = args.get(arg)
        if pk is None:
            return None
        key = f"{spec.service}:{table}:{pk}"
        if key not in tx.pre_images:
            row = self.services[spec.service].get_row(table, pk)  # LIVE read
            tx.pre_images[key] = copy.deepcopy(row) if row else {}
        return tx.pre_images[key]

    def execute(self, tx: Transaction, spec: ToolSpec, args: dict, tainted: list[str]) -> dict:
        svc = self.services[spec.service]
        pre = self.capture_pre_image(tx, spec, args) if spec.mutating else None
        result = svc.call(spec.method, args, conn=self.conn(tx, spec.service), live=False)
        if spec.mutating:
            tx.staged.append(StagedCall(len(tx.staged), spec.name, dict(args), result, list(tainted), pre))
        return result

    def snapshot(self, tx: Transaction, svc: str) -> dict[str, Any]:
        return self.services[svc].snapshot(self.conn(tx, svc))

    def discard(self, tx: Transaction) -> None:
        for c in tx.shadow_conns.values():
            try:
                c.close()
            except Exception:
                pass
        tx.shadow_conns.clear()
