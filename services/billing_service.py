"""Billing microservice: invoices, credit notes, wire payouts (billing.db)."""
from __future__ import annotations

import sqlite3

from .common import BaseService, ToolError, require, sha256_hex


class BillingService(BaseService):
    name = "billing"
    db_file = "billing.db"
    tables = {"invoices": "invoice_id", "credit_notes": "credit_id"}
    schema = """
    CREATE TABLE invoices (
        invoice_id TEXT PRIMARY KEY, po_id TEXT NOT NULL, amount_usd REAL NOT NULL,
        status TEXT NOT NULL, vendor_iban TEXT NOT NULL, version INTEGER NOT NULL
    );
    CREATE TABLE credit_notes (
        credit_id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, amount_usd REAL NOT NULL,
        status TEXT NOT NULL
    );
    """

    def seed(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            "INSERT INTO invoices VALUES (?,?,?,?,?,?)",
            ("INV-88", "PO-1042", 50000.0, "OPEN", "DE89370400440532013000", 1),
        )

    def _inv(self, conn, invoice_id) -> dict:
        r = conn.execute("SELECT * FROM invoices WHERE invoice_id=?", (invoice_id,)).fetchone()
        if not r:
            raise ToolError(404, f"invoice {invoice_id} not found")
        return dict(r)

    def tool_get_invoice(self, conn, args, live):
        require(args, "invoice_id")
        return self._inv(conn, args["invoice_id"])

    def tool_issue_credit_note(self, conn, args, live):
        require(args, "invoice_id", "amount_usd")
        inv = self._inv(conn, args["invoice_id"])
        amount = float(args["amount_usd"])
        if amount <= 0 or amount > inv["amount_usd"]:
            raise ToolError(422, "credit amount out of range", {"invoice_amount": inv["amount_usd"]})
        if inv["status"] != "OPEN":
            raise ToolError(409, f"invoice status is {inv['status']}")
        if args.get("dry_run"):
            return {"dry_run": True, "ok": True, "invoice_id": inv["invoice_id"], "amount_usd": amount}
        if live and self.config.get("fail_billing_409"):
            raise ToolError(409, "Invoice locked by nightly batch", {"invoice_id": inv["invoice_id"]})
        require(args, "idempotency_key")
        credit_id = "CN-" + sha256_hex(args["idempotency_key"])[:10].upper()
        row = {"credit_id": credit_id, "invoice_id": inv["invoice_id"], "amount_usd": amount, "status": "ISSUED"}
        conn.execute("INSERT INTO credit_notes VALUES (:credit_id,:invoice_id,:amount_usd,:status)", row)
        return row

    def tool_void_credit_note(self, conn, args, live):
        require(args, "credit_id")
        r = conn.execute("SELECT * FROM credit_notes WHERE credit_id=?", (args["credit_id"],)).fetchone()
        if not r:
            raise ToolError(404, f"credit note {args['credit_id']} not found")
        conn.execute("DELETE FROM credit_notes WHERE credit_id=?", (args["credit_id"],))
        self.audit(conn, "CREDIT_VOIDED", dict(r))
        return {"credit_id": args["credit_id"], "voided": True}

    def tool_send_wire_payout(self, conn, args, live):
        """PIVOT: money leaves the building. Irreversible."""
        require(args, "invoice_id", "vendor_iban", "amount_usd")
        # Like a real payment rail, this pays whatever IBAN it is given: guarding the
        # IBAN against vendor master data is the proxy's job (validator.iban_integrity).
        inv = self._inv(conn, args["invoice_id"])
        if args.get("dry_run"):
            return {"dry_run": True, "ok": True}
        conn.execute("UPDATE invoices SET status='PAID', version=version+1 WHERE invoice_id=?", (inv["invoice_id"],))
        self.audit(conn, "WIRE_SENT", {"invoice_id": inv["invoice_id"], "amount_usd": float(args["amount_usd"])})
        return {"invoice_id": inv["invoice_id"], "wired_usd": float(args["amount_usd"]), "status": "PAID"}
