"""
Node functions for the ResearchPilot StateGraph.

Each node takes the current AgentState and returns a *partial* dict that
LangGraph merges back in (list-typed fields append via the reducers in
state.py, scalar fields overwrite). Every node that "does something"
appends a ScratchpadEntry so the SSE layer has a full live trace.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Literal

from app.agent.state import AgentState, EvidenceItem, ScratchpadEntry
from app.agent.tools.pdf_reader import chunk_pages, retrieve_passages
from app.agent.tools.web_search import WebSearchError, web_search
from app.llm.provider import LLMQuotaError, get_llm

MAX_LOOPS_PER_STEP = int(os.getenv("MAX_LOOPS_PER_STEP", "3"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _entry(node: str, thought: str, tool_call: str | None = None, tool_result: str | None = None) -> ScratchpadEntry:
    return ScratchpadEntry(node=node, thought=thought, tool_call=tool_call, tool_result=tool_result, timestamp=_now())


def _current_subtask(state: AgentState) -> str:
    plan = state.get("plan") or []
    idx = state.get("current_step", 0)
    if 0 <= idx < len(plan):
        return plan[idx]
    return state["goal"]


# --------------------------------------------------------------------------
# 1. planner
# --------------------------------------------------------------------------

PLANNER_SYSTEM = """You are the planning module of an AI research assistant. Analyze the user's input.

Classify goal_type as:
- "conversational": for greetings, small talk, compliments, or simple direct questions (e.g. "hi", "hello", "who are you", "how are you", "thanks").
- "comparison": for side-by-side comparisons of items, tools, or options.
- "lit_review": ONLY if uploaded PDF documents are present.
- "general": for research queries.

If goal_type is "conversational", set plan to ["Respond to user"].

Return JSON: {"plan": ["sub-task 1"], "goal_type": "conversational" | "comparison" | "lit_review" | "general"}"""


def planner(state: AgentState) -> dict:
    goal = state["goal"]
    has_docs = len(state.get("documents", [])) > 0
    user_prompt = f"Goal: {goal}\nUploaded documents available: {has_docs}"

    # Fast Python fallback for simple greetings
    lower_goal = goal.strip().lower()
    if lower_goal in ("hi", "hello", "hey", "who are you", "how are you", "hi there", "thanks", "thank you", "good morning", "good evening"):
        return {
            "plan": ["Respond to user"],
            "goal_type": "conversational",
            "current_step": 0,
            "loops_this_step": 0,
            "scratchpad": [_entry("planner", "Recognized conversational prompt.")],
        }

    try:
        llm = get_llm()
        parsed = llm.complete_json(PLANNER_SYSTEM, user_prompt)
        plan = [str(s) for s in parsed.get("plan", [])][:8] or [goal]
        goal_type = parsed.get("goal_type", "general")
        if goal_type not in ("conversational", "comparison", "lit_review", "general"):
            goal_type = "general"
    except LLMQuotaError as exc:
        return {
            "status": "error",
            "error": str(exc),
            "scratchpad": [_entry("planner", f"Planning failed: {exc}")],
        }

    thought = "Decomposed the goal into {} sub-task(s): {}".format(len(plan), "; ".join(plan))
    return {
        "plan": plan,
        "goal_type": goal_type,
        "current_step": 0,
        "loops_this_step": 0,
        "scratchpad": [_entry("planner", thought)],
    }


# --------------------------------------------------------------------------
# 2. router (ReAct-style Thought -> Action decision)
# --------------------------------------------------------------------------

ROUTER_SYSTEM = """You are the routing module of a research agent. \
Given the overall goal and evidence gathered, decide the next action:
- "web_search": search the web for relevant information.
- "read_pdf": ONLY valid if uploaded PDF documents are available. If no documents were uploaded, NEVER choose "read_pdf".
- "synthesize": ready to write the final structured answer.

Return JSON: {"thought": "reasoning", "action": "web_search" | "read_pdf" | "synthesize", "query": "focused query"}"""


def router(state: AgentState) -> dict:
    plan = state.get("plan", [])
    current_step = state.get("current_step", 0)
    subtask = _current_subtask(state)
    has_docs = len(state.get("documents", [])) > 0
    recent_evidence = state.get("evidence", [])[-4:]
    evidence_summary = "\n".join(
        f"- ({e['source_type']}) {e['title']}: {e['snippet'][:140]}" for e in recent_evidence
    ) or "(none yet)"

    if state.get("goal_type") == "conversational" or current_step >= len(plan):
        return {
            "last_action": "synthesize",
            "scratchpad": [_entry("router", "Direct response; moving to synthesis.")],
        }

    user_prompt = (
        f"Overall goal: {state['goal']}\n"
        f"Full plan: {plan}\n"
        f"Current sub-task ({current_step + 1}/{len(plan)}): {subtask}\n"
        f"Documents uploaded: {has_docs}\n"
        f"Evidence gathered so far:\n{evidence_summary}"
    )

    try:
        llm = get_llm()
        parsed = llm.complete_json(ROUTER_SYSTEM, user_prompt)
        action = parsed.get("action", "web_search")
        if action not in ("web_search", "read_pdf", "synthesize"):
            action = "web_search"
        if action == "read_pdf" and not has_docs:
            action = "web_search"
        thought = parsed.get("thought", "Deciding next action.")
        query = parsed.get("query") or subtask
    except LLMQuotaError as exc:
        return {
            "status": "error",
            "error": str(exc),
            "scratchpad": [_entry("router", f"Routing failed: {exc}")],
        }

    return {
        "last_action": action,
        "pending_query": query,  # consumed by the next tool node
        "scratchpad": [_entry("router", thought, tool_call=f"{action}(query='{query}')" if action != "synthesize" else None)],
    }


def route_from_router(state: AgentState) -> Literal["web_search_tool", "pdf_reader_tool", "synthesizer"]:
    action = state.get("last_action")
    if action == "read_pdf":
        return "pdf_reader_tool"
    if action == "synthesize":
        return "synthesizer"
    return "web_search_tool"


# --------------------------------------------------------------------------
# 3. web_search_tool
# --------------------------------------------------------------------------


def web_search_tool(state: AgentState) -> dict:
    query = state.get("pending_query") or _current_subtask(state)
    step = state.get("current_step", 0)
    try:
        results = web_search(query, max_results=5)
    except WebSearchError as exc:
        return {
            "scratchpad": [_entry("web_search_tool", f"Search failed: {exc}", tool_call=f"web_search('{query}')", tool_result="(error, no results)")],
        }

    evidence = [
        EvidenceItem(
            step_index=step,
            source_type="web",
            title=r.title or r.url,
            url=r.url,
            filename=None,
            page=None,
            snippet=r.snippet,
        )
        for r in results
        if r.url
    ]
    preview = "; ".join(r.title for r in results[:3]) or "(no results)"
    return {
        "evidence": evidence,
        "scratchpad": [_entry("web_search_tool", f"Found {len(results)} result(s).", tool_call=f"web_search('{query}')", tool_result=preview)],
    }


# --------------------------------------------------------------------------
# 4. pdf_reader_tool
# --------------------------------------------------------------------------


def pdf_reader_tool(state: AgentState) -> dict:
    query = state.get("pending_query") or _current_subtask(state)
    step = state.get("current_step", 0)
    documents = state.get("documents", [])

    all_chunks = []
    for doc in documents:
        all_chunks.extend(chunk_pages(doc["document_id"], doc["filename"], doc["pages"]))

    if not all_chunks:
        return {
            "scratchpad": [_entry("pdf_reader_tool", "No document text available to search.", tool_call=f"read_pdf('{query}')", tool_result="(no documents)")],
        }

    passages = retrieve_passages(all_chunks, query, top_k=4)
    evidence = [
        EvidenceItem(
            step_index=step,
            source_type="pdf",
            title=f"{p.filename} (p.{p.page})",
            url=None,
            filename=p.filename,
            page=p.page,
            snippet=p.text[:500],
        )
        for p in passages
    ]
    preview = "; ".join(f"{p.filename} p.{p.page}" for p in passages) or "(no matches)"
    return {
        "evidence": evidence,
        "scratchpad": [_entry("pdf_reader_tool", f"Retrieved {len(passages)} passage(s) from uploaded PDFs.", tool_call=f"read_pdf('{query}')", tool_result=preview)],
    }


# --------------------------------------------------------------------------
# 5. reflect
# --------------------------------------------------------------------------

REFLECT_SYSTEM = """You are the reflection module of a research agent. Given the \
current sub-task and the evidence gathered for it so far, decide whether there is \
now enough evidence to consider this sub-task complete, or whether another search/\
retrieval pass is needed.

Return JSON: {"sufficient": true | false, "reason": "one short sentence"}"""


def reflect(state: AgentState) -> dict:
    subtask = _current_subtask(state)
    step = state.get("current_step", 0)
    step_evidence = [e for e in state.get("evidence", []) if e["step_index"] == step]
    loops = state.get("loops_this_step", 0)

    # Loop guard: force-advance regardless of the model's opinion once we've
    # spent the loop budget, so a stuck sub-task can't burn quota forever.
    if loops >= MAX_LOOPS_PER_STEP - 1:
        sufficient = True
        reason = "Reached the loop cap for this sub-task; moving on with available evidence."
    else:
        evidence_summary = "\n".join(f"- {e['title']}: {e['snippet'][:160]}" for e in step_evidence)
        user_prompt = f"Sub-task: {subtask}\nEvidence gathered for this sub-task:\n{evidence_summary}"
        try:
            llm = get_llm()
            parsed = llm.complete_json(REFLECT_SYSTEM, user_prompt)
            sufficient = bool(parsed.get("sufficient", True))
            reason = parsed.get("reason", "")
        except LLMQuotaError as exc:
            return {
                "status": "error",
                "error": str(exc),
                "scratchpad": [_entry("reflect", f"Reflection failed: {exc}")],
            }

    thought = f"{'Sufficient' if sufficient else 'Not yet sufficient'} — {reason}"
    entry = _entry("reflect", thought)

    if sufficient:
        return {
            "current_step": state.get("current_step", 0) + 1,
            "loops_this_step": 0,
            "scratchpad": [entry],
        }
    return {
        "loops_this_step": loops + 1,
        "scratchpad": [entry],
    }


def route_after_reflect(state: AgentState) -> Literal["router", "synthesizer"]:
    if state.get("status") == "error":
        return "synthesizer"
    if state.get("current_step", 0) >= len(state.get("plan", [])):
        return "synthesizer"
    return "router"


# --------------------------------------------------------------------------
# 6. synthesizer
# --------------------------------------------------------------------------

PLANNER_SYSTEM = """You are the planning module of a research agent. Given a user's \
goal, break it into 2-3 concise sub-tasks for fast response times. \
Classify goal_type as "lit_review" ONLY if documents were uploaded, "comparison" for item comparisons, or "general" otherwise.

Return JSON: {"plan": ["sub-task 1", "sub-task 2"], "goal_type": "comparison" | "lit_review" | "general"}"""

ROUTER_SYSTEM = """You are the routing module of a research agent. \
Given the overall goal and evidence gathered, decide the next action:
- "web_search": search for information.
- "read_pdf": ONLY valid if uploaded documents are available. If no documents were uploaded, NEVER choose "read_pdf".
- "synthesize": ready to write the final structured response.

Return JSON: {"thought": "reasoning", "action": "web_search" | "read_pdf" | "synthesize", "query": "focused query"}"""

SYNTH_SYSTEM_COMPARISON = """You are an expert research analyst. Provide a well-structured comparison report in GitHub-flavored Markdown.

FORMATTING REQUIREMENTS:
1. ## Executive Overview
   A short 2-3 sentence summary comparing the options.

2. ## Feature Comparison Table
   A clean Markdown comparison table comparing items across key dimensions (e.g. Performance, Battery Life, Price, Build Quality, Pros/Cons).

3. ## Detailed Breakdown
   Detailed subsections (### Item Name) with bullet points describing key features and findings for each option, using bold text for key attributes.

4. ## Verdict & Recommendation
   A clear summary recommendation outlining which option best suits different use cases.

Do NOT mention missing evidence or complain about missing document files. Deliver a clean, structured, authoritative report!"""

SYNTH_SYSTEM_LIT_REVIEW = """You are an expert academic reviewer. Using the passages provided from the user's uploaded PDF documents, write a structured literature review in GitHub-flavored Markdown.

FORMATTING REQUIREMENTS:
1. ## Executive Summary
   High-level overview of themes across the uploaded papers.

2. ## Key Documents & Findings
   Subsections per paper with bulleted takeaways and inline citations like (filename, p. N).

3. ## Comparative Analysis
   Synthesize methodology and findings across papers.

Do NOT add disclaimers about missing non-existent materials."""

SYNTH_SYSTEM_CONVERSATIONAL = """You are ResearchPilot, an intelligent AI assistant built like Gemini.
The user sent a simple greeting, small talk, or direct question.

Respond in a warm, natural, and concise tone (1-2 friendly sentences). Do NOT output markdown headings or tables for simple greetings."""

SYNTH_SYSTEM_GENERAL = """You are an expert AI assistant built like Gemini. Provide an accurate, well-structured answer to the user's goal in GitHub-flavored Markdown.

MATCH THE SCALE & DEPTH OF THE QUESTION:
- For simple or direct factual questions: Provide a clean, direct 1-2 paragraph answer. Do NOT generate unnecessary walls of text or bloated sections.
- For complex research questions: Structure with clear headings (## Heading), bulleted key points, bold key terms, and summary tables.

Do NOT add disclaimers about missing evidence or missing document files."""


def synthesizer(state: AgentState) -> dict:
    if state.get("status") == "error":
        # An upstream node already recorded the error; just stop the graph.
        return {"status": "error"}

    goal_type = state.get("goal_type", "general")
    system = {
        "conversational": SYNTH_SYSTEM_CONVERSATIONAL,
        "comparison": SYNTH_SYSTEM_COMPARISON,
        "lit_review": SYNTH_SYSTEM_LIT_REVIEW,
    }.get(goal_type, SYNTH_SYSTEM_GENERAL)

    evidence = state.get("evidence", [])
    evidence_block = "\n\n".join(
        (
            f"[{i}] source_type={e['source_type']} "
            f"title={e['title']} "
            f"url={e.get('url') or ''} "
            f"filename={e.get('filename') or ''} page={e.get('page') or ''}\n"
            f"{e['snippet']}"
        )
        for i, e in enumerate(evidence, start=1)
    ) or "(no evidence was gathered)"

    user_prompt = (
        f"Goal: {state['goal']}\n"
        f"Plan that was executed: {state.get('plan', [])}\n\n"
        f"Evidence:\n{evidence_block}"
    )

    try:
        llm = get_llm()
        result = llm.complete(system, user_prompt, temperature=0.4)
        answer = result.text
    except LLMQuotaError as exc:
        return {
            "status": "error",
            "error": str(exc),
            "scratchpad": [_entry("synthesizer", f"Synthesis failed: {exc}")],
        }

    return {
        "final_answer": answer,
        "status": "done",
        "scratchpad": [_entry("synthesizer", "Wrote the final answer from gathered evidence.")],
    }
