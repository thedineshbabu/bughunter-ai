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

    # Test configuration supplied by the user at run-creation time
    test_config: Optional[Dict[str, Any]]  # {max_pages, instructions, focus_areas}

    # Final structured report (populated by ReporterAgent)
    report: Optional[List[Dict[str, Any]]]

    # Per-app persistent memory loaded from PostgreSQL before each run.
    # None when no memory exists yet (first run for this app).
    app_memory: Optional[Dict[str, Any]]

    # Login steps produced by a successful smart login this run.
    # Populated by ExplorerAgent; consumed by extract_memory_updates() to
    # persist the working flow so future runs can skip LLM login discovery.
    login_steps_for_memory: Optional[List[Dict[str, Any]]]

    # Parsed orchestrator output (pages, journeys, focus_areas, notes) — drives explorer priorities.
    strategic_plan: Optional[Dict[str, Any]]

    # URLs visited during exploration — consumed by SecurityAgent for multi-page scans.
    visited_urls: Optional[List[str]]

    # Populated by ReporterAgent after deduplicating bugs_found.
    dedupe_stats: Optional[Dict[str, Any]]
