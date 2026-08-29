from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from app.api.routes import router as agent_router  # noqa: E402
from app.api.voice import router as voice_router  # noqa: E402
from app.api.schemas import ApiError  # noqa: E402

app = FastAPI(
    title="ResearchPilot API",
    description="Multi-step LangGraph research agent: plans, searches, reads PDFs, and synthesizes a cited answer.",
    version="1.0.0",
)

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agent_router)
app.include_router(voice_router)


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    """Keep error bodies typed (`ApiError` shape) even when a route raises
    a plain HTTPException somewhere, so the frontend never has to guess."""
    detail = exc.detail
    if not isinstance(detail, dict):
        detail = ApiError(kind="internal_error", message=str(detail)).model_dump()
    return JSONResponse(status_code=exc.status_code, content=detail)


@app.get("/api/health")
async def health():
    return {"status": "ok", "llm_provider": os.getenv("LLM_PROVIDER", "groq")}
