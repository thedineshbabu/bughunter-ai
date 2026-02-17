"""
BugHunter.AI - Agent State Definition
TypedDict that flows through the entire LangGraph pipeline.
"""

from typing import Any, Dict, List, Optional, TypedDict


class AgentState(TypedDict):
    """Shared state object passed between all agents in the LangGraph pipeline."""

    # Target application
    url: str
    credentials: Optional[Dict[str, str]]  # e.g. {"username": "...", "password": "..."}

    # Navigation context
    current_page: Optional[str]

    # Collected artifacts
    screenshots: List[Dict[str, Any]]  # [{label, base64, url, timestamp}, ...]
    bugs_found: List[Dict[str, Any]]   # raw bug observations
    test_steps: List[Dict[str, Any]]   # [{action, selector, value, result}, ...]

    # Pipeline control
    current_agent: Optional[str]
    error: Optional[str]
    status: str  # "pending" | "running" | "completed" | "failed"

    # Final structured report (populated by ReporterAgent)
    report: Optional[List[Dict[str, Any]]]
