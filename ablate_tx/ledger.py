"""SHA-256 hash-chained TxReceipt store."""
from __future__ import annotations

import threading

from services.common import canonical_json, sha256_hex

GENESIS = "0" * 64


class Ledger:
    def __init__(self) -> None:
        self._receipts: list[dict] = []
        self._lock = threading.Lock()

    def append(self, receipt: dict) -> dict:
        with self._lock:
            prev = self._receipts[-1]["receipt_hash"] if self._receipts else GENESIS
            body = {k: v for k, v in receipt.items() if k not in ("receipt_hash", "prev_hash")}
            body["prev_hash"] = prev
            body["receipt_hash"] = sha256_hex(prev + canonical_json(
                {k: v for k, v in body.items() if k != "receipt_hash"}))
            self._receipts.append(body)
            return body

    def all(self) -> list[dict]:
        with self._lock:
            return list(self._receipts)

    def verify(self) -> bool:
        prev = GENESIS
        for r in self.all():
            body = {k: v for k, v in r.items() if k != "receipt_hash"}
            if r["prev_hash"] != prev or sha256_hex(prev + canonical_json(body)) != r["receipt_hash"]:
                return False
            prev = r["receipt_hash"]
        return True
