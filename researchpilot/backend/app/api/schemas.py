from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class UploadedDocument(BaseModel):
    document_id: str
    filename: str
    num_pages: int


class UploadResponse(BaseModel):
    documents: list[UploadedDocument]


class RunStartResponse(BaseModel):
    run_id: str


class ScratchpadEntryOut(BaseModel):
    node: str
    thought: str
    tool_call: str | None = None
    tool_result: str | None = None
    timestamp: str


class EvidenceItemOut(BaseModel):
    step_index: int
    source_type: Literal["web", "pdf"]
    title: str
    url: str | None = None
    filename: str | None = None
    page: int | None = None
    snippet: str


class RunResultResponse(BaseModel):
    run_id: str
    status: Literal["pending", "running", "done", "error"]
    goal: str
    goal_type: str | None = None
    plan: list[str] = []
    final_answer: str | None = None
    evidence: list[EvidenceItemOut] = []
    scratchpad: list[ScratchpadEntryOut] = []
    error: str | None = None
    steps_used: int = 0
    retries: int = 0


class ApiError(BaseModel):
    """Typed error body — the frontend renders `kind` distinctly from a
    generic 500 (e.g. a quota banner vs. a toast)."""

    kind: Literal["quota_exceeded", "config_error", "not_found", "bad_request", "internal_error"]
    message: str


class SpeakRequest(BaseModel):
    text: str
    voice: str | None = None


class TranscribeResponse(BaseModel):
    text: str
