"""
Compiles the ResearchPilot agent as an explicit LangGraph StateGraph:

                    +-----------+
        START ----> |  planner  |
                    +-----+-----+
                          |
                          v
                    +-----------+
              +---> |  router   | <-------------------+
              |     +-----+-----+                      |
              |           |                             |
              | (loop)    +---------------+             |
              |           |               |             |
              |    web_search_tool   pdf_reader_tool     |
              |           |               |              |
              |           +-------+-------+              |
              |                   v                        |
              |             +-----------+                   |
              +------------ |  reflect  | ---(all steps done)+--> synthesizer -> END
                             +-----------+

`router` makes a ReAct Thought->Action decision each visit (web_search /
read_pdf / synthesize). `reflect` decides whether the current sub-task has
enough evidence; if not (and under the loop cap) it sends the graph back
to `router` for another pass at the *same* sub-task, otherwise it advances
`current_step` and either loops back to `router` for the next sub-task or
falls through to `synthesizer` once the plan is exhausted.
"""
from __future__ import annotations

from typing import AsyncIterator

from langgraph.graph import END, START, StateGraph

from app.agent import nodes
from app.agent.state import AgentState


def build_graph():
    graph = StateGraph(AgentState)

    graph.add_node("planner", nodes.planner)
    graph.add_node("router", nodes.router)
    graph.add_node("web_search_tool", nodes.web_search_tool)
    graph.add_node("pdf_reader_tool", nodes.pdf_reader_tool)
    graph.add_node("reflect", nodes.reflect)
    graph.add_node("synthesizer", nodes.synthesizer)

    graph.add_edge(START, "planner")
    graph.add_edge("planner", "router")

    graph.add_conditional_edges(
        "router",
        nodes.route_from_router,
        {
            "web_search_tool": "web_search_tool",
            "pdf_reader_tool": "pdf_reader_tool",
            "synthesizer": "synthesizer",
        },
    )

    graph.add_edge("web_search_tool", "reflect")
    graph.add_edge("pdf_reader_tool", "reflect")

    graph.add_conditional_edges(
        "reflect",
        nodes.route_after_reflect,
        {"router": "router", "synthesizer": "synthesizer"},
    )

    graph.add_edge("synthesizer", END)

    return graph.compile()


_compiled_graph = None


def get_graph():
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_graph()
    return _compiled_graph


def initial_state(goal: str, documents: list[dict] | None = None) -> AgentState:
    return AgentState(
        goal=goal,
        documents=documents or [],
        plan=[],
        current_step=0,
        scratchpad=[],
        evidence=[],
        loops_this_step=0,
        last_action=None,
        pending_query=None,
        final_answer=None,
        goal_type=None,
        status="running",
        error=None,
    )


async def stream_run(goal: str, documents: list[dict] | None = None) -> AsyncIterator[dict]:
    """Run the graph, yielding every state update as it happens.

    Each yielded dict is the partial state update returned by whichever
    node just ran, tagged with the node name — this is what the SSE
    layer forwards straight to the frontend's live trace panel.
    """
    graph = get_graph()
    state = initial_state(goal, documents)

    async for event in graph.astream(state, config={"recursion_limit": 100}, stream_mode="updates"):
        # event is like {"planner": {...partial state...}}
        for node_name, partial in event.items():
            yield {"node": node_name, "update": partial}
