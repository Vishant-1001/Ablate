"""WMS microservice: inventory reservations (wms.db)."""
from __future__ import annotations

import sqlite3

from .common import BaseService, ToolError, require


class WMSService(BaseService):
    name = "wms"
    db_file = "wms.db"
    tables = {"inventory": "sku"}
    schema = """
    CREATE TABLE inventory (
        sku TEXT PRIMARY KEY, on_hand INTEGER NOT NULL, reserved INTEGER NOT NULL,
        version INTEGER NOT NULL
    );
    """

    def seed(self, conn: sqlite3.Connection) -> None:
        conn.execute("INSERT INTO inventory VALUES (?,?,?,?)", ("SKU-900", 1000, 500, 1))

    def _inv(self, conn, sku) -> dict:
        r = conn.execute("SELECT * FROM inventory WHERE sku=?", (sku,)).fetchone()
        if not r:
            raise ToolError(404, f"SKU {sku} not found")
        return dict(r)

    def tool_get_inventory(self, conn, args, live):
        require(args, "sku")
        return self._inv(conn, args["sku"])

    def tool_adjust_reservation(self, conn, args, live):
        """Commutative delta on `reserved`; the inverse is simply -delta_qty."""
        require(args, "sku", "delta_qty")
        inv = self._inv(conn, args["sku"])
        delta = int(args["delta_qty"])
        new_reserved = inv["reserved"] + delta
        if new_reserved < 0:
            raise ToolError(422, "reserved would go negative", {"reserved": inv["reserved"], "delta": delta})
        conn.execute(
            "UPDATE inventory SET reserved=?, version=version+1 WHERE sku=?", (new_reserved, inv["sku"])
        )
        return {
            "sku": inv["sku"], "delta_qty": delta, "old_reserved": inv["reserved"],
            "reserved": new_reserved, "on_hand": inv["on_hand"], "version": inv["version"] + 1,
        }
