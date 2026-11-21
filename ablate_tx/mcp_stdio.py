"""Ablate MCP stdio bridge — connects any local MCP client (Claude Desktop, Cursor, Windsurf)
directly to your live Ablate MCP HTTP endpoint (local or deployed on Render/Cloud Run).

Usage:
  python -m ablate_tx.mcp_stdio
  ABLATE_URL=https://ablate-324699159359.asia-south1.run.app python -m ablate_tx.mcp_stdio
"""
from __future__ import annotations

import json
import os
import sys
import httpx

ABLATE_URL = os.environ.get("ABLATE_URL", "http://127.0.0.1:8000").rstrip("/")
MCP_ENDPOINT = f"{ABLATE_URL}/mcp"


def main() -> None:
    session_id: str | None = None
    with httpx.Client(timeout=30.0) as client:
        for raw_line in sys.stdin:
            line = raw_line.strip()
            if not line:
                continue
            headers = {"Content-Type": "application/json"}
            if session_id:
                headers["Mcp-Session-Id"] = session_id
            try:
                resp = client.post(MCP_ENDPOINT, content=line, headers=headers)
                if "Mcp-Session-Id" in resp.headers:
                    session_id = resp.headers["Mcp-Session-Id"]
                if resp.status_code != 202 and resp.text.strip():
                    sys.stdout.write(resp.text.strip() + "\n")
                    sys.stdout.flush()
            except Exception as exc:
                try:
                    req = json.loads(line)
                    req_id = req.get("id")
                except Exception:
                    req_id = None
                err = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32000, "message": f"Ablate bridge error: {exc}"},
                }
                sys.stdout.write(json.dumps(err) + "\n")
                sys.stdout.flush()


if __name__ == "__main__":
    main()
