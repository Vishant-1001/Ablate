"""Ablate proxy HTTP API (frozen contract, port 8000)."""
from __future__ import annotations

import asyncio
import json
from typing import Any, Optional

from fastapi import FastAPI, Header, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from services.common import ToolError

from . import mcp_jsonrpc as mcp
from .engine import get_engine
from .registry import public_tools

app = FastAPI(title="Ablate Transactional MCP Proxy", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["Mcp-Session-Id"])

ACTS = ("act1_corruption", "act2_rollback", "act3_injection", "act4_etag_conflict")


class ConfigBody(BaseModel):
    aegis_enabled: Optional[bool] = None
    fail_billing_409: Optional[bool] = None
    simulate_human_edit: Optional[bool] = None
    max_auto_usd: Optional[float] = None


class McpCall(BaseModel):
    tx_id: Optional[str] = None
    tool: str
    args: dict = {}
    tainted_fields: Optional[list[str]] = None


class TxBody(BaseModel):
    tx_id: str


class BeginBody(BaseModel):
    untrusted_context: Optional[list[str]] = None


@app.exception_handler(ToolError)
async def _tool_error(_, exc: ToolError):
    return JSONResponse(status_code=exc.status, content={"ok": False, "error": exc.to_dict()})


@app.get("/health")
def health():
    return {"status": "ok", "aegis_enabled": bool(get_engine().config["aegis_enabled"])}


@app.post("/admin/config")
def admin_config(body: ConfigBody):
    return get_engine().update_config(body.model_dump(exclude_none=True))


@app.post("/admin/reset")
def admin_reset():
    return get_engine().reset()


@app.get("/state")
def state():
    return get_engine().state()


@app.get("/events")
def events():
    return {"events": list(get_engine().events)}


@app.get("/ledger")
def ledger():
    return {"receipts": get_engine().ledger.all()}


@app.get("/tools")
def tools():
    return {"tools": public_tools()}


@app.post("/tx/begin")
def tx_begin(body: Optional[BeginBody] = None):
    return {"tx_id": get_engine().begin(body.untrusted_context if body else None)}


@app.post("/mcp/call")
def mcp_call(body: McpCall):
    return get_engine().call(body.tx_id, body.tool, body.args, body.tainted_fields)


@app.post("/tx/commit")
def tx_commit(body: TxBody):
    return get_engine().commit(body.tx_id)


@app.post("/mcp")
async def mcp_jsonrpc(request: Request, mcp_session_id: Optional[str] = Header(None)):
    """MCP JSON-RPC 2.0 endpoint (single message or batch). Mcp-Session-Id = tx_id."""
    eng = get_engine()
    try:
        body: Any = json.loads(await request.body())
    except ValueError:
        return JSONResponse(status_code=400, content=mcp._err(None, mcp.PARSE_ERROR, "Parse error"))

    def run() -> Any:
        if isinstance(body, list):
            if not body:
                return mcp._err(None, mcp.INVALID_REQUEST, "empty batch")
            return [r for r in (mcp.handle(eng, m, mcp_session_id) for m in body) if r is not None] or None
        return mcp.handle(eng, body, mcp_session_id)

    resp = await run_in_threadpool(run)  # engine + SQLite are blocking; keep the event loop free
    return Response(status_code=202) if resp is None else JSONResponse(content=resp)


@app.get("/events/stream")
async def events_stream(request: Request):
    """Server-Sent Events: replays the current event log, then pushes each new event as it
    is emitted. Sends `event: reset` when the log is cleared by /admin/reset."""
    eng = get_engine()

    async def gen():
        sent, idle = 0, 0.0
        yield "retry: 2000\n\n"
        while not await request.is_disconnected():
            evs = eng.events
            if len(evs) < sent:  # log was cleared by a reset
                sent = 0
                yield "event: reset\ndata: {}\n\n"
            if len(evs) > sent:
                for e in list(evs[sent:]):
                    yield f"event: proxy\ndata: {json.dumps(e, default=str)}\n\n"
                sent, idle = len(evs), 0.0
            elif idle >= 15:
                yield ": keep-alive\n\n"
                idle = 0.0
            await asyncio.sleep(0.15)
            idle += 0.15

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/bench/run")
async def bench_run():
    """Run the 10-case AegisBench-MCP (deterministic, no LLM). Resets the DBs when done."""
    from agent.scenarios import bench_table, run_bench
    report = await run_in_threadpool(run_bench)
    return {**report, "markdown": bench_table(report)}


@app.post("/demo/run/{act}")
async def demo_run(act: str):
    if act not in ACTS:
        return JSONResponse(status_code=404, content={"ok": False, "error": {"status": 404,
                            "message": f"unknown act {act}", "data": {"acts": list(ACTS)}}})
    from agent.scenarios import run_act
    return await run_act(act)
