"""
BugHunter.AI - LangGraph Node Wrappers
Thin functions that delegate to the respective agent classes.
"""

import logging

from .state import AgentState

logger = logging.getLogger("bughunter.nodes")


def orchestrator_node(state: AgentState) -> AgentState:
    """Entry node: plans the test strategy for the target URL."""
    from agents.orchestrator import OrchestratorAgent

    logger.info(f"[orchestrator] Analyzing: {state['url']}")
    agent = OrchestratorAgent()
    return agent.run(state)


def explorer_node(state: AgentState) -> AgentState:
    """Navigates the app with Playwright and captures screenshots + steps."""
    from agents.explorer import ExplorerAgent

    logger.info("[explorer] Starting browser exploration")
    credentials = state.get("credentials") or {}
    extra_blocked = credentials.get("blocked_domains", []) if isinstance(credentials, dict) else []
    allowed = credentials.get("allowed_domains", []) if isinstance(credentials, dict) else []
    agent = ExplorerAgent(extra_blocked_domains=extra_blocked, allowed_domains=allowed)
    return agent.run(state)


def validator_node(state: AgentState) -> AgentState:
    """Reviews screenshots and steps to identify functional bugs.

    After validation, strips the base64 image data from each screenshot entry
    to prevent MB of image data being carried through security and reporter nodes.
    The local_path reference is retained in screenshot_paths for S3 upload.
    """
    from agents.validator import ValidatorAgent

    logger.info(f"[validator] Reviewing {len(state.get('screenshots', []))} screenshots")
    agent = ValidatorAgent()
    result = agent.run(state)

    # Strip base64 payloads; downstream agents don't need raw image data
    stripped = [
        {k: v for k, v in s.items() if k != "base64"}
        for s in result.get("screenshots", [])
    ]
    paths = [s.get("local_path", "") for s in stripped if s.get("local_path")]

    return {**result, "screenshots": stripped, "screenshot_paths": paths}


def security_node(state: AgentState) -> AgentState:
    """Runs active security tests (XSS, SQLi, auth bypass)."""
    from agents.security import SecurityAgent

    logger.info("[security] Running security checks")
    agent = SecurityAgent()
    return agent.run(state)


def reporter_node(state: AgentState) -> AgentState:
    """Generates structured bug reports from bugs_found list."""
    from agents.reporter import ReporterAgent

    logger.info(f"[reporter] Reporting {len(state.get('bugs_found', []))} bugs")
    agent = ReporterAgent()
    return agent.run(state)


def simple_reporter_node(state: AgentState) -> AgentState:
    """Logs bugs without LLM enrichment (quick mode)."""
    from agents.reporter import SimpleReporterAgent

    logger.info(f"[reporter] Quick-logging {len(state.get('bugs_found', []))} bugs (no AI enrichment)")
    agent = SimpleReporterAgent()
    return agent.run(state)


def route_reporter(state: AgentState) -> str:
    """Route to the full LLM reporter or the simple logger based on test_config."""
    test_config = state.get("test_config") or {}
    if test_config.get("detailed_report", True):
        return "reporter"
    return "simple_reporter"
