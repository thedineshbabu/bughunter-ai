"""
BugHunter.AI - LangGraph StateGraph Builder
Defines the agent pipeline and conditional routing logic.
"""

from langgraph.graph import END, StateGraph

from .nodes import (
    explorer_node,
    orchestrator_node,
    reporter_node,
    route_reporter,
    security_node,
    simple_reporter_node,
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
    graph.add_node("simple_reporter", simple_reporter_node)

    # ── Set entry point ─────────────────────────────────────────────────────
    graph.set_entry_point("orchestrator")

    # ── Define edges ─────────────────────────────────────────────────────────
    graph.add_edge("orchestrator", "explorer")
    graph.add_edge("explorer", "validator")
    graph.add_edge("validator", "security")
    # Route to full LLM reporter or quick logger based on test_config.detailed_report
    graph.add_conditional_edges("security", route_reporter, {
        "reporter": "reporter",
        "simple_reporter": "simple_reporter",
    })
    graph.add_edge("reporter", END)
    graph.add_edge("simple_reporter", END)

    return graph.compile()
