"""Shared plumbing for the three stateful SQLite microservices.

Each service owns one SQLite file. Business tables are hashed with
SHA-256(canonical_json(all_rows)). Bookkeeping tables (prefixed with ``_``:
idempotency records, audit log) and ``version`` columns (ETag metadata) are
excluded from the state hash so that a clean compensation is provably
byte-identical at the business-data level.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
from typing import Any, Callable

DATA_DIR = os.environ.get(
    "ABLATE_DATA_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
)

# Process-wide lock: all live + shadow DB access is serialized through it.
DB_LOCK = threading.RLock()

HASH_EXCLUDED_COLUMNS = {"version"}


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class ToolError(Exception):
    """A tool-level failure with an HTTP-like status code."""

    def __init__(self, status: int, message: str, data: dict | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.data = data or {}

    def to_dict(self) -> dict:
        return {"status": self.status, "message": self.message, "data": self.data}


class BaseService:
    """A stateful microservice backed by its own SQLite DB.

    Tools are methods named ``tool_<name>(conn, args, live)``. The same code runs
    against the live file connection or against an in-memory shadow copy; fault
    injection and human-edit simulation only ever fire when ``live`` is True.
    """

    name: str = ""
    db_file: str = ""
    schema: str = ""
    # table -> primary key column (business tables included in the hash)
    tables: dict[str, str] = {}

    def __init__(self, config: dict):
        self.config = config
        os.makedirs(DATA_DIR, exist_ok=True)
        self.db_path = os.path.join(DATA_DIR, self.db_file)
        self.conn = self._open(self.db_path)
        if not self._initialized():
            self.reset()

    # -- connections --------------------------------------------------
    @staticmethod
    def _open(path: str) -> sqlite3.Connection:
        conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        return conn

    def _initialized(self) -> bool:
        cur = self.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        names = {r[0] for r in cur.fetchall()}
        return all(t in names for t in self.tables)

    def shadow_copy(self) -> sqlite3.Connection:
        """Snapshot the live DB into a private in-memory connection (shadow twin)."""
        with DB_LOCK:
            mem = self._open(":memory:")
            self.conn.backup(mem)
            return mem

    # -- lifecycle ----------------------------------------------------
    def reset(self) -> None:
        with DB_LOCK:
            cur = self.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
            for (name,) in cur.fetchall():
                if not name.startswith("sqlite_"):
                    self.conn.execute(f'DROP TABLE IF EXISTS "{name}"')
            self.conn.executescript(self.schema)
            self.conn.executescript(
                """
                CREATE TABLE _idempotency (key TEXT PRIMARY KEY, tool TEXT, result TEXT);
                CREATE TABLE _audit (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, payload TEXT);
                """
            )
            self.seed(self.conn)

    def seed(self, conn: sqlite3.Connection) -> None:  # pragma: no cover - abstract
        raise NotImplementedError

    # -- state --------------------------------------------------------
    def rows(self, table: str, conn: sqlite3.Connection | None = None) -> list[dict]:
        conn = conn or self.conn
        pk = self.tables[table]
        with DB_LOCK:
            return [dict(r) for r in conn.execute(f'SELECT * FROM "{table}" ORDER BY "{pk}"')]

    def get_row(self, table: str, pk_value: Any, conn: sqlite3.Connection | None = None) -> dict | None:
        conn = conn or self.conn
        pk = self.tables[table]
        with DB_LOCK:
            r = conn.execute(f'SELECT * FROM "{table}" WHERE "{pk}"=?', (pk_value,)).fetchone()
            return dict(r) if r else None

    def state_hash(self, conn: sqlite3.Connection | None = None) -> str:
        payload = {
            t: [{k: v for k, v in row.items() if k not in HASH_EXCLUDED_COLUMNS} for row in self.rows(t, conn)]
            for t in sorted(self.tables)
        }
        return sha256_hex(canonical_json(payload))

    def snapshot(self, conn: sqlite3.Connection | None = None) -> dict:
        out: dict[str, Any] = {t: self.rows(t, conn) for t in self.tables}
        out["hash"] = self.state_hash(conn)
        return out

    def audit(self, conn: sqlite3.Connection, kind: str, payload: dict) -> None:
        conn.execute("INSERT INTO _audit(kind, payload) VALUES (?,?)", (kind, canonical_json(payload)))

    # -- tool dispatch ------------------------------------------------
    def has_tool(self, tool: str) -> bool:
        return callable(getattr(self, f"tool_{tool}", None))

    def call(self, tool: str, args: dict, conn: sqlite3.Connection | None = None, live: bool = True) -> dict:
        fn: Callable | None = getattr(self, f"tool_{tool}", None)
        if fn is None:
            raise ToolError(404, f"unknown tool {self.name}.{tool}")
        conn = conn or self.conn
        key = args.get("idempotency_key")
        dry = bool(args.get("dry_run"))
        with DB_LOCK:
            if key and not dry:
                hit = conn.execute("SELECT result FROM _idempotency WHERE key=?", (key,)).fetchone()
                if hit:
                    res = json.loads(hit[0])
                    res["idempotent_replay"] = True
                    return res
            conn.execute("BEGIN")
            try:
                result = fn(conn, args, live)
                if key and not dry:
                    conn.execute(
                        "INSERT INTO _idempotency(key, tool, result) VALUES (?,?,?)",
                        (key, tool, canonical_json(result)),
                    )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
            # post-commit hooks (e.g. simulated concurrent human edit) run in their own txn
            hook = getattr(self, f"after_{tool}", None)
            if hook and live and not dry:
                hook(conn, args, result)
            return result


def require(args: dict, *names: str) -> None:
    missing = [n for n in names if args.get(n) is None]
    if missing:
        raise ToolError(400, f"missing required args: {', '.join(missing)}")
