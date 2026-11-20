"""Pivot Transaction Rule + commit ordering.

At most one PIVOT (irreversible) action per transaction. Commit order is
COMPENSABLE -> PIVOT -> RETRYABLE, preserving call order within each class, so
every reversible step has landed (and can still be undone) before the point of
no return, and anything after the pivot is safe to retry forward.
"""
from __future__ import annotations

from services.common import ToolError

from .registry import COMPENSABLE, PIVOT, RETRYABLE, get_spec

_RANK = {COMPENSABLE: 0, PIVOT: 1, RETRYABLE: 2}


def check_pivot_limit(tools: list[str]) -> None:
    pivots = [t for t in tools if get_spec(t).kind == PIVOT]
    if len(pivots) > 1:
        raise ToolError(409, "PIVOT_LIMIT_EXCEEDED", {"pivots": pivots, "max": 1})


def plan(staged: list) -> list:
    check_pivot_limit([s.tool for s in staged])
    return sorted(staged, key=lambda s: (_RANK.get(get_spec(s.tool).kind, 9), s.seq))
