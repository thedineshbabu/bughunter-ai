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
    # Security always runs after validation — never skipped, regardless of bugs found
    graph.add_edge("orchestrator", "explorer")
    graph.add_edge("explorer", "validator")
    graph.add_edge("validator", "security")
    graph.add_edge("security", "reporter")
    graph.add_edge("reporter", END)

    return graph.compile()
