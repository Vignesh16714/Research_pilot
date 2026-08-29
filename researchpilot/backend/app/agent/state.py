"""
State schema for the ResearchPilot agent graph.

Everything the graph reads or writes lives on this single TypedDict, per
LangGraph convention. Nodes return partial dicts that get merged into
this state by the reducers defined below (list fields append, scalar
fields overwrite).
"""
from __future__ import annotations

import operator
from typing import Annotated, Any, Literal, TypedDict


class ScratchpadEntry(TypedDict):
    node: str
    thought: str
    tool_call: str | None
    tool_result: str | None
    timestamp: str


class EvidenceItem(TypedDict):
    step_index: int
    source_type: Literal["web", "pdf"]
    title: str
    url: str | None          # for web evidence
    filename: str | None     # for pdf evidence
    page: int | None         # for pdf evidence
    snippet: str


class DocumentRecord(TypedDict):
    document_id: str
    filename: str
    pages: list[str]  # extracted text, one entry per page


def _append(a: list, b: list) -> list:
    return a + b


class AgentState(TypedDict):
    # Input
    goal: str
    documents: Annotated[list[DocumentRecord], _append]

    # Planning
    plan: list[str]
    current_step: int

    # Working memory
    scratchpad: Annotated[list[ScratchpadEntry], _append]
    evidence: Annotated[list[EvidenceItem], _append]

    # Router bookkeeping (per sub-task loop guard)
    loops_this_step: int
    last_action: Literal["web_search", "read_pdf", "synthesize", "reflect", ""] | None
    pending_query: str | None  # search/retrieval query the router just decided on

    # Output
    final_answer: str | None
    goal_type: Literal["comparison", "lit_review", "general"] | None
    status: Literal["running", "done", "error"]
    error: str | None
