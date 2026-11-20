"""ERP microservice: purchase orders + general ledger (erp.db)."""
from __future__ import annotations

import sqlite3

from .common import BaseService, ToolError, require, sha256_hex


class ERPService(BaseService):
    name = "erp"
    db_file = "erp.db"
    tables = {"purchase_orders": "po_id", "gl_entries": "entry_id"}
    schema = """
    CREATE TABLE purchase_orders (
        po_id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL, sku TEXT NOT NULL,
        qty INTEGER NOT NULL, unit_price REAL NOT NULL, status TEXT NOT NULL,
        version INTEGER NOT NULL
    );
    CREATE TABLE gl_entries (
        entry_id TEXT PRIMARY KEY, po_id TEXT NOT NULL, debit REAL NOT NULL,
        credit REAL NOT NULL, memo TEXT
    );
    """

    def seed(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            "INSERT INTO purchase_orders VALUES (?,?,?,?,?,?,?)",
            ("PO-1042", "V-ACME", "SKU-900", 500, 100.0, "OPEN", 1),
        )

    def _po(self, conn, po_id) -> dict:
        r = conn.execute("SELECT * FROM purchase_orders WHERE po_id=?", (po_id,)).fetchone()
        if not r:
            raise ToolError(404, f"PO {po_id} not found")
        return dict(r)

    # -- tools ----------------------------------------------------------
    def tool_get_po(self, conn, args, live):
        require(args, "po_id")
        return self._po(conn, args["po_id"])

    def tool_update_po_qty(self, conn, args, live):
        require(args, "po_id", "new_qty")
        po = self._po(conn, args["po_id"])
        new_qty = int(args["new_qty"])
        if new_qty < 0:
            raise ToolError(422, "qty must be non-negative")
        expected = args.get("expected_version")
        if expected is not None and int(expected) != po["version"]:
            raise ToolError(412, "ETag mismatch", {"expected": expected, "actual": po["version"]})
        conn.execute(
            "UPDATE purchase_orders SET qty=?, version=version+1 WHERE po_id=?", (new_qty, po["po_id"])
        )
        return {"po_id": po["po_id"], "old_qty": po["qty"], "new_qty": new_qty, "version": po["version"] + 1}

    def after_update_po_qty(self, conn, args, result):
        """simulate_human_edit: a planner edits the PO in the ERP UI mid-flush."""
        if not self.config.get("simulate_human_edit"):
            return
        conn.execute("BEGIN")
        conn.execute(
            "UPDATE purchase_orders SET qty=?, version=version+1 WHERE po_id=?",
            (int(result["new_qty"]) + 25, result["po_id"]),
        )
        self.audit(conn, "HUMAN_EDIT", {"po_id": result["po_id"], "qty": int(result["new_qty"]) + 25})
        conn.execute("COMMIT")

    def tool_post_gl_adjustment(self, conn, args, live):
        require(args, "po_id", "debit", "credit", "idempotency_key")
        self._po(conn, args["po_id"])
        entry_id = "GL-" + sha256_hex(args["idempotency_key"])[:10].upper()
        row = {
            "entry_id": entry_id,
            "po_id": args["po_id"],
            "debit": float(args["debit"]),
            "credit": float(args["credit"]),
            "memo": str(args.get("memo") or ""),
        }
        conn.execute("INSERT INTO gl_entries VALUES (:entry_id,:po_id,:debit,:credit,:memo)", row)
        return row

    def tool_reverse_gl_adjustment(self, conn, args, live):
        require(args, "entry_id")
        r = conn.execute("SELECT * FROM gl_entries WHERE entry_id=?", (args["entry_id"],)).fetchone()
        if not r:
            raise ToolError(404, f"GL entry {args['entry_id']} not found")
        conn.execute("DELETE FROM gl_entries WHERE entry_id=?", (args["entry_id"],))
        self.audit(conn, "GL_REVERSED", dict(r))
        return {"entry_id": args["entry_id"], "reversed": True}

    def tool_restore_po(self, conn, args, live):
        """Compensator for ETAG_RESTORE: conditional write guarded by version."""
        require(args, "po_id", "pre_image", "expected_version")
        po = self._po(conn, args["po_id"])
        if po["version"] != int(args["expected_version"]):
            raise ToolError(
                412, "ETag mismatch: concurrent edit detected",
                {"expected_version": args["expected_version"], "live": po},
            )
        pre = args["pre_image"]
        conn.execute(
            "UPDATE purchase_orders SET vendor_id=?, sku=?, qty=?, unit_price=?, status=?, version=version+1 "
            "WHERE po_id=?",
            (pre["vendor_id"], pre["sku"], pre["qty"], pre["unit_price"], pre["status"], po["po_id"]),
        )
        self.audit(conn, "PO_RESTORED", {"po_id": po["po_id"], "pre_image": pre})
        return {"po_id": po["po_id"], "restored": True, "version": po["version"] + 1}
