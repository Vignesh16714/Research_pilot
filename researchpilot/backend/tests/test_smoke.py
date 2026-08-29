"""
Smoke tests only: prove the graph compiles and the API wires up correctly.
These deliberately do NOT call any real LLM/search API (so they run
without credentials/network in CI) — they check structure, not agent
quality. Delete/extend once you're wiring in real free-tier keys.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient


def test_graph_compiles():
    from app.agent.graph import build_graph

    graph = build_graph()
    assert graph is not None
    # A compiled LangGraph exposes get_graph() for introspection/visualization.
    node_names = set(graph.get_graph().nodes.keys())
    for expected in {"planner", "router", "web_search_tool", "pdf_reader_tool", "reflect", "synthesizer"}:
        assert expected in node_names


def test_initial_state_shape():
    from app.agent.graph import initial_state

    state = initial_state("test goal", documents=[])
    assert state["goal"] == "test goal"
    assert state["status"] == "running"
    assert state["plan"] == []
    assert state["scratchpad"] == []


def test_health_endpoint():
    from app.main import app

    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_upload_rejects_non_pdf():
    from app.main import app

    client = TestClient(app)
    resp = client.post(
        "/api/upload",
        files={"files": ("notes.txt", b"hello world", "text/plain")},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["kind"] == "bad_request"


def test_run_requires_goal():
    from app.main import app

    client = TestClient(app)
    resp = client.post("/api/agent/run", data={"goal": ""})
    assert resp.status_code == 400


def test_stream_unknown_run_id_404():
    from app.main import app

    client = TestClient(app)
    resp = client.get("/api/agent/stream/does-not-exist")
    assert resp.status_code == 404


def test_result_unknown_run_id_404():
    from app.main import app

    client = TestClient(app)
    resp = client.get("/api/agent/result/does-not-exist")
    assert resp.status_code == 404


def test_pdf_chunk_and_retrieve_roundtrip():
    from app.agent.tools.pdf_reader import chunk_pages, retrieve_passages

    pages = [
        "Transformers use self-attention to model long-range dependencies in text.",
        "Convolutional networks use local receptive fields and are efficient on images.",
    ]
    chunks = chunk_pages("doc1", "paper.pdf", pages)
    assert len(chunks) == 2

    top = retrieve_passages(chunks, "self-attention transformers", top_k=1)
    assert len(top) == 1
    assert "attention" in top[0].text.lower()


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
