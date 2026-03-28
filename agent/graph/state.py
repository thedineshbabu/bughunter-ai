"""
BugHunter.AI - Agent State Definition
TypedDict that flows through the entire LangGraph pipeline.
"""

from typing import Any, Dict, List, Optional, TypedDict


class AgentState(TypedDict):
    """Shared state object passed between all agents in the LangGraph pipeline."""

    # Job identity — used for SSE progress publishing
    run_id: Optional[str]

    # Target application
    url: str
    credentials: Optional[Dict[str, str]]  # e.g. {"username": "...", "password": "..."}

    # Navigation context
    current_page: Optional[str]

    # Collected artifacts
    screenshots: List[Dict[str, Any]]  # [{label, base64, url, timestamp, local_path}, ...]
                                        # base64 is stripped from each entry after ValidatorAgent runs
    screenshot_paths: List[str]         # local_path values retained after base64 strip
    bugs_found: List[Dict[str, Any]]   # raw bug observations
    test_steps: List[Dict[str, Any]]   # [{action, selector, value, result}, ...]

    # Pipeline control
    current_agent: Optional[str]
    error: Optional[str]
    status: str  # "pending" | "running" | "completed" | "failed"

    # Final structured report (populated by ReporterAgent)
    report: Optional[List[Dict[str, Any]]]
