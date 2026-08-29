# ResearchPilot 🛰️

> **Zero-Cost Multi-Step AI Research Agent** powered by **LangGraph**, **FastAPI**, **React**, and **Tailwind CSS**.

ResearchPilot is an autonomous research assistant designed to turn complex research goals and uploaded PDF literature into detailed, fully-cited research syntheses. Built with a zero-cost philosophy, it leverages free LLM tiers (Google Gemini 2.5 Flash / Groq Llama 3.3 70B) and free web search tools (DuckDuckGo Search, no API key required).

---

## 🌟 Key Features

- **Autonomous Agentic Workflow**: Multi-step planning, dynamic routing, tool execution, reflection loops, and final report synthesis using **LangGraph**.
- **Dual Source Research**: Combines real-time web search (DuckDuckGo) with uploaded PDF literature (in-memory passage chunking and similarity search).
- **Free-Tier Stack**: Built ground-up for free LLM API keys (Gemini 2.5 Flash via `google-genai` or Groq Llama 3.3 70B). No paid vector database or paid search APIs needed!
- **Real-Time SSE Streaming**: Live step-by-step progress, active tool badges, reflection logs, and streaming report delivery.
- **Modern Interactive UI**: Dark-mode design system with glassmorphism, step progress timelines, tabbed source citations, markdown rendering, and Web Speech API voice interaction (speech-to-text input & text-to-speech reading).
- **Offline Smoke Testing**: Suite of mock-free structural tests for backend agent compilation and API endpoints.

---

## 🏗️ Architecture & Agent Flow

```
                     ┌──────────────────┐
                     │   User Request   │
                     └────────┬─────────┘
                              │
                     ┌────────▼─────────┐
                     │     Planner      │
                     └────────┬─────────┘
                              │
                     ┌────────▼─────────┐
      ┌─────────────►│      Router      │◄─────────────┐
      │              └────┬─────────┬───┘              │
      │                   │         │                  │
      │         ┌─────────▼─┐     ┌─▼───────────┐      │
      │         │ Web Search│     │ PDF Reader  │      │
      │         └─────────┬─┘     └─┬───────────┘      │
      │                   │         │                  │
      │              ┌────▼─────────▼───┐              │
      └──────────────┤     Reflect      ├──────────────┘
    (Need more info) └────────┬─────────┘ (Info sufficient)
                              │
                     ┌────────▼─────────┐
                     │   Synthesizer    │
                     └────────┬─────────┘
                              │
                     ┌────────▼─────────┐
                     │ Final Report &   │
                     │   Citations      │
                     └──────────────────┘
```

1. **Planner**: Breaks the user's research goal into structured sub-tasks.
2. **Router**: Determines which tool (`web_search` or `pdf_reader`) to execute for the current task step.
3. **Tools**:
   - **Web Search**: Fetches recent articles, news, and technical summaries via DuckDuckGo.
   - **PDF Reader**: Extracts text from user-uploaded PDFs, chunks passages, and retrieves relevant excerpts.
4. **Reflect**: Evaluates gathered evidence against sub-task requirements. If incomplete, loops back to **Router** for further research (bounded by `MAX_LOOPS_PER_STEP`).
5. **Synthesizer**: Assembles all findings into a structured markdown report with full inline citations (`[1]`, `[2]`).

---

## 📁 Repository Structure

```
researchpilot/
├── backend/
│   ├── app/
│   │   ├── agent/
│   │   │   ├── graph.py             # LangGraph state machine definition
│   │   │   ├── nodes.py             # Planner, Router, Reflect, Synthesizer nodes
│   │   │   ├── state.py             # AgentState TypedDict schema
│   │   │   └── tools/
│   │   │       ├── web_search.py    # DuckDuckGo search integration
│   │   │       └── pdf_reader.py    # PDF parsing & TF-IDF passage retriever
│   │   ├── api/
│   │   │   ├── routes.py            # FastAPI endpoints (/api/agent/run, /api/agent/stream, etc.)
│   │   │   ├── schemas.py           # Pydantic request/response schemas
│   │   │   └── voice.py             # Voice transcription/synthesis routes
│   │   ├── llm/
│   │   │   └── provider.py          # Unified LLM provider interface (Gemini / Groq)
│   │   └── main.py                  # FastAPI app entry point & CORS configuration
│   ├── tests/
│   │   └── test_smoke.py            # Offline graph structure & API tests
│   ├── .env.example                 # Environment variables template
│   └── requirements.txt             # Python dependencies
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── Header.tsx           # Navigation & model status header
    │   │   ├── ResearchForm.tsx     # Goal input & PDF upload dropzone
    │   │   ├── AgentProgress.tsx    # Live step progress timeline & logs
    │   │   ├── ReportView.tsx       # Markdown report viewer & citation inspector
    │   │   └── VoiceControls.tsx    # Voice input & text-to-speech audio reader
    │   ├── hooks/
    │   │   └── useResearchAgent.ts  # SSE streaming custom hook
    │   ├── App.tsx                  # Main app layout & state management
    │   ├── index.css                # Custom CSS design system & Tailwind directives
    │   └── types.ts                 # TypeScript interface definitions
    ├── package.json
    ├── tailwind.config.js
    ├── tsconfig.json
    └── vite.config.ts
```

---

## ⚙️ Environment Configuration

Copy `backend/.env.example` to `backend/.env` and update your keys:

```bash
cd backend
cp .env.example .env
```

### Supported Settings (`backend/.env`)

```env
# Selected provider: "gemini" or "groq"
LLM_PROVIDER=gemini

# Google Gemini (https://ai.google.dev - free tier, no credit card required)
GOOGLE_API_KEY=your-google-api-key-here
GEMINI_MODEL=gemini-2.0-flash

# Groq (https://console.groq.com - free tier)
GROQ_API_KEY=your-groq-api-key-here
GROQ_MODEL=llama-3.3-70b-versatile

# CORS & Execution settings
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
MAX_LOOPS_PER_STEP=3
```

---

## 🚀 Quick Start Guide

### 1. Backend Setup (FastAPI & LangGraph)

```bash
# Navigate to backend directory
cd backend

# Create and activate virtual environment
python -m venv venv

# Windows:
venv\Scripts\activate
# macOS/Linux:
# source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start FastAPI development server
uvicorn app.main:app --reload --port 8000
```
The API server will run at `http://localhost:8000`. You can inspect the interactive OpenAPI documentation at `http://localhost:8000/docs`.

### 2. Frontend Setup (React & Vite)

```bash
# Navigate to frontend directory
cd frontend

# Install Node dependencies
npm install

# Start Vite development server
npm run dev
```
Open your browser and navigate to `http://localhost:5173`.

---

## 🧪 Testing & Verification

Run backend offline smoke tests without requiring live API keys or network access:

```bash
cd backend
pytest tests/test_smoke.py -v
```

Verify frontend TypeScript compilation and build:

```bash
cd frontend
npm run build
```

---

## 📜 License

MIT License. Free for open-source research and educational use.
