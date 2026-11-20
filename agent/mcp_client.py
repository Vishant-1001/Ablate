"""Minimal MCP JSON-RPC client the ADK agent uses to reach the Ablate proxy over HTTP.

The transaction is bound with the `Mcp-Session-Id` header, so every tools/call made
through one client lands in the same shadow-twin transaction.
"""
from __future__ import annotations

import itertools

import httpx

from ablate_tx.config import MCP_URL as DEFAULT_URL


class MCPError(RuntimeError):
    pass


class AblateMCPClient:
    def __init__(self, tx_id: str | None, url: str = DEFAULT_URL, timeout: float = 30.0):
        self.url = url
        self.tx_id = tx_id
        self._ids = itertools.count(1)
        headers = {"Mcp-Session-Id": tx_id} if tx_id else {}
        self._http = httpx.AsyncClient(timeout=timeout, headers=headers)

    async def _rpc(self, method: str, params: dict | None = None) -> dict:
        msg = {"jsonrpc": "2.0", "id": next(self._ids), "method": method, "params": params or {}}
        r = await self._http.post(self.url, json=msg)
        body = r.json()
        if "error" in body:
            raise MCPError(f"{method}: {body['error'].get('code')} {body['error'].get('message')}")
        return body["result"]

    async def initialize(self) -> dict:
        res = await self._rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                             "clientInfo": {"name": "ablate-adk-agent", "version": "0.2.0"}})
        await self._http.post(self.url, json={"jsonrpc": "2.0", "method": "notifications/initialized"})
        return res

    async def list_tools(self) -> list[dict]:
        return (await self._rpc("tools/list"))["tools"]

    async def call_tool(self, name: str, arguments: dict, tainted_fields: list[str] | None = None) -> dict:
        params: dict = {"name": name, "arguments": arguments}
        if tainted_fields:
            params["_meta"] = {"ablate/tainted_fields": tainted_fields}
        res = await self._rpc("tools/call", params)
        return res.get("structuredContent") or {"content": res.get("content"), "isError": res.get("isError")}

    async def commit_tx(self) -> dict:
        """ablate/commit_tx for the bound transaction; returns the sealed TxReceipt."""
        return await self._rpc("ablate/commit_tx", {"tx_id": self.tx_id})

    async def aclose(self) -> None:
        await self._http.aclose()
