"""
BugHunter.AI - LangGraph StateGraph Builder
Defines the agent pipeline and conditional routing logic.
"""

from langgraph.graph import END, StateGraph

from .nodes import (
    explorer_node,
    orchestrator_node,
    reporter_node,
    security_node,
    validator_node,
)
from .state import AgentState


def has_bugs(state: AgentState) -> str:
    """Conditional edge: route to reporter if bugs found, else to security."""
    if state.get("bugs_found"):
        return "reporter"
    return "security"


def build_graph():
    """Build and compile the BugHunter.AI LangGraph pipeline."""
    graph = StateGraph(AgentState)

    # ── Register nodes ──────────────────────────────────────────────────────
    graph.add_node("orchestrator", orchestrator_node)
    graph.add_node("explorer", explorer_node)
    graph.add_node("validator", validator_node)
    graph.add_node("security", security_node)
    graph.add_node("reporter", reporter_node)

    # ── Set entry point ─────────────────────────────────────────────────────
    graph.set_entry_point("orchestrator")

    # ── Define edges ─────────────────────────────────────────────────────────
    graph.add_edge("orchestrator", "explorer")
    graph.add_edge("explorer", "validator")

    # Conditional: if bugs found go straight to reporter, else do security first
    graph.add_conditional_edges(
        "validator",
        has_bugs,
        {
            "reporter": "reporter",
            "security": "security",
        },
    )

    graph.add_edge("security", "reporter")
    graph.add_edge("reporter", END)

    return graph.compile()
