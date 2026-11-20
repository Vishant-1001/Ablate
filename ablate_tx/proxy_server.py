"""Ablate proxy HTTP API (frozen contract, port 8000)."""
from __future__ import annotations

from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from services.common import ToolError

from .engine import get_engine
from .registry import public_tools

app = FastAPI(title="Ablate Transactional MCP Proxy", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

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


@app.post("/demo/run/{act}")
async def demo_run(act: str):
    if act not in ACTS:
        return JSONResponse(status_code=404, content={"ok": False, "error": {"status": 404,
                            "message": f"unknown act {act}", "data": {"acts": list(ACTS)}}})
    from agent.scenarios import run_act
    return await run_act(act)
