"""
In-memory state for the demo: uploaded documents and in-flight agent runs.

No DB required per the project brief (run-history sidebar is in-memory on
the frontend too). Everything here resets when the backend restarts,
which is fine for a portfolio/demo app; swapping this for Redis or a real
DB later would only touch this file.
"""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.agent.graph import stream_run
from app.agent.tools.pdf_reader import extract_text_by_page

# --- Documents -------------------------------------------------------------


@dataclass
class StoredDocument:
    document_id: str
    filename: str
    pages: list[str]


class DocumentStore:
    def __init__(self) -> None:
        self._docs: dict[str, StoredDocument] = {}

    def add(self, filename: str, file_bytes: bytes) -> StoredDocument:
        pages = extract_text_by_page(file_bytes)
        doc = StoredDocument(document_id=str(uuid.uuid4()), filename=filename, pages=pages)
        self._docs[doc.document_id] = doc
        return doc

    def get_many(self, document_ids: list[str]) -> list[StoredDocument]:
        return [self._docs[d] for d in document_ids if d in self._docs]

    def as_graph_documents(self, document_ids: list[str]) -> list[dict[str, Any]]:
        return [
            {"document_id": d.document_id, "filename": d.filename, "pages": d.pages}
            for d in self.get_many(document_ids)
        ]


document_store = DocumentStore()


# --- Runs --------------------------------------------------------------------


@dataclass
class RunRecord:
    run_id: str
    goal: str
    status: str = "pending"  # pending | running | done | error
    plan: list[str] = field(default_factory=list)
    goal_type: str | None = None
    current_step: int = 0
    scratchpad: list[dict] = field(default_factory=list)
    evidence: list[dict] = field(default_factory=list)
    final_answer: str | None = None
    error: str | None = None
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    steps_used: int = 0
    retries: int = 0


class RunManager:
    def __init__(self) -> None:
        self._runs: dict[str, RunRecord] = {}

    def get(self, run_id: str) -> RunRecord | None:
        return self._runs.get(run_id)

    def create(self, goal: str, document_ids: list[str]) -> RunRecord:
        run_id = str(uuid.uuid4())
        record = RunRecord(run_id=run_id, goal=goal)
        self._runs[run_id] = record
        graph_documents = document_store.as_graph_documents(document_ids)
        asyncio.create_task(self._execute(record, graph_documents))
        return record

    async def _execute(self, record: RunRecord, documents: list[dict]) -> None:
        record.status = "running"
        try:
            async for event in stream_run(record.goal, documents):
                self._merge(record, event["update"])
                record.steps_used += 1
                await record.queue.put({"type": "update", "node": event["node"], "data": event["update"]})
        except Exception as exc:  # noqa: BLE001 - surface any unexpected failure to the client
            record.status = "error"
            record.error = str(exc)
            await record.queue.put({"type": "error", "message": str(exc)})
        else:
            if record.status != "error":
                record.status = record.status or "done"
        finally:
            await record.queue.put({"type": "done"})

    @staticmethod
    def _merge(record: RunRecord, partial: dict[str, Any]) -> None:
        for key, value in partial.items():
            if key == "scratchpad":
                record.scratchpad.extend(value)
            elif key == "evidence":
                record.evidence.extend(value)
                # rough "retries" signal for the UI's quota-pressure counter:
                # more than one evidence-producing pass for the same step index.
            elif key == "plan":
                record.plan = value
            elif key == "goal_type":
                record.goal_type = value
            elif key == "current_step":
                record.current_step = value
            elif key == "final_answer":
                record.final_answer = value
            elif key == "status":
                record.status = value
            elif key == "error":
                record.error = value
            elif key == "loops_this_step" and value:
                record.retries += 1


run_manager = RunManager()
