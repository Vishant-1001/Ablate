"""Central runtime configuration: ports, policy defaults and agent settings.

Everything is overridable through environment variables so the same image runs
locally, under docker-compose and on Cloud Run.
"""
from __future__ import annotations

import os

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))

# Policy defaults; /admin/config changes them at runtime.
DEFAULT_POLICY = {
    "aegis_enabled": os.environ.get("ABLATE_AEGIS_ENABLED", "1") == "1",
    "fail_billing_409": False,
    "simulate_human_edit": False,
    "max_auto_usd": float(os.environ.get("ABLATE_MAX_AUTO_USD", "5000")),
}

# Agent
GEMINI_MODELS = [m for m in os.environ.get(
    "ABLATE_MODELS", "gemini-3.5-flash-lite,gemini-3.5-flash,gemini-flash-latest").split(",") if m]
GEMINI_TIMEOUT_S = float(os.environ.get("ABLATE_GEMINI_TIMEOUT_S", "30"))
MCP_URL = os.environ.get("ABLATE_MCP_URL", f"http://127.0.0.1:{PORT}/mcp")
HAS_GEMINI_KEY = bool(os.environ.get("GOOGLE_API_KEY"))
