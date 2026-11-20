"""SHA-256 hash-chained TxReceipt store."""
from __future__ import annotations

import threading

from services.common import canonical_json, sha256_hex

from .models import TxReceipt

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
            TxReceipt.model_validate(body)  # shape check before sealing
            self._receipts.append(body)
            return body

    def all(self) -> list[dict]:
        with self._lock:
            return list(self._receipts)

    def verify(self) -> bool:
        return self.verify_report()["chain_valid"]

    def verify_report(self) -> dict:
        """Re-hash every receipt from genesis. Reports the first break: a prev_hash that
        does not link to the previous receipt, or contents that no longer hash to
        receipt_hash (i.e. the receipt was edited after sealing)."""
        receipts = self.all()
        prev = GENESIS
        for i, r in enumerate(receipts):
            body = {k: v for k, v in r.items() if k != "receipt_hash"}
            reason = None
            if r.get("prev_hash") != prev:
                reason = "prev_hash does not match the previous receipt's hash"
            elif sha256_hex(prev + canonical_json(body)) != r.get("receipt_hash"):
                reason = "contents changed after sealing: recomputed hash != receipt_hash"
            if reason:
                return {"chain_valid": False, "receipts": len(receipts), "verified": i,
                        "first_broken": {"index": i, "tx_id": r.get("tx_id"), "reason": reason}}
            prev = r["receipt_hash"]
        return {"chain_valid": True, "receipts": len(receipts), "verified": len(receipts),
                "first_broken": None, "head_hash": prev}
