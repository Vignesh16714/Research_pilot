from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from sse_starlette.sse import EventSourceResponse

from app.api.schemas import (
    ApiError,
    EvidenceItemOut,
    RunResultResponse,
    RunStartResponse,
    ScratchpadEntryOut,
    UploadedDocument,
    UploadResponse,
)
from app.api.store import document_store, run_manager
from app.llm.provider import LLMConfigError

router = APIRouter(prefix="/api")


@router.post("/upload", response_model=UploadResponse)
async def upload_documents(files: list[UploadFile] = File(...)) -> UploadResponse:
    if not files:
        raise HTTPException(status_code=400, detail=ApiError(kind="bad_request", message="No files provided.").model_dump())

    out: list[UploadedDocument] = []
    for f in files:
        if not f.filename or not f.filename.lower().endswith(".pdf"):
            raise HTTPException(
                status_code=400,
                detail=ApiError(kind="bad_request", message=f"'{f.filename}' is not a PDF.").model_dump(),
            )
        content = await f.read()
        try:
            doc = document_store.add(f.filename, content)
        except Exception as exc:  # noqa: BLE001 - pypdf can raise on malformed PDFs
            raise HTTPException(
                status_code=400,
                detail=ApiError(kind="bad_request", message=f"Could not read '{f.filename}': {exc}").model_dump(),
            ) from exc
        out.append(UploadedDocument(document_id=doc.document_id, filename=doc.filename, num_pages=len(doc.pages)))

    return UploadResponse(documents=out)


@router.post("/agent/run", response_model=RunStartResponse)
async def start_run(
    goal: str = Form(...),
    document_ids: str = Form(default=""),
    files: list[UploadFile] = File(default=None),
) -> RunStartResponse:
    """Starts an agent run. Accepts multipart/form-data so a single call can
    both reference previously-uploaded documents (`document_ids`, comma-
    separated) and/or attach fresh PDFs (`files`) in the same request."""
    if not goal or not goal.strip():
        raise HTTPException(status_code=400, detail=ApiError(kind="bad_request", message="`goal` is required.").model_dump())

    ids = [d.strip() for d in document_ids.split(",") if d.strip()]

    if files:
        for f in files:
            if not f.filename or not f.filename.lower().endswith(".pdf"):
                continue
            content = await f.read()
            doc = document_store.add(f.filename, content)
            ids.append(doc.document_id)

    try:
        record = run_manager.create(goal.strip(), ids)
    except LLMConfigError as exc:
        raise HTTPException(status_code=500, detail=ApiError(kind="config_error", message=str(exc)).model_dump()) from exc

    return RunStartResponse(run_id=record.run_id)


@router.get("/agent/stream/{run_id}")
async def stream_agent(run_id: str):
    record = run_manager.get(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail=ApiError(kind="not_found", message="Unknown run_id.").model_dump())

    async def event_generator():
        while True:
            item = await record.queue.get()
            if item["type"] == "update":
                yield {"event": "update", "data": json.dumps({"node": item["node"], **item["data"]}, default=str)}
            elif item["type"] == "error":
                yield {"event": "error", "data": json.dumps({"message": item["message"]})}
            elif item["type"] == "done":
                yield {"event": "done", "data": json.dumps({"status": record.status})}
                break
            await asyncio.sleep(0)

    return EventSourceResponse(event_generator())


@router.get("/agent/result/{run_id}", response_model=RunResultResponse)
async def get_result(run_id: str) -> RunResultResponse:
    record = run_manager.get(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail=ApiError(kind="not_found", message="Unknown run_id.").model_dump())

    return RunResultResponse(
        run_id=record.run_id,
        status=record.status,  # type: ignore[arg-type]
        goal=record.goal,
        goal_type=record.goal_type,
        plan=record.plan,
        final_answer=record.final_answer,
        evidence=[EvidenceItemOut(**e) for e in record.evidence],
        scratchpad=[ScratchpadEntryOut(**s) for s in record.scratchpad],
        error=record.error,
        steps_used=record.steps_used,
        retries=record.retries,
    )
