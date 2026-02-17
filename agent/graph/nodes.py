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
    agent = ExplorerAgent()
    return agent.run(state)


def validator_node(state: AgentState) -> AgentState:
    """Reviews screenshots and steps to identify functional bugs."""
    from agents.validator import ValidatorAgent

    logger.info(f"[validator] Reviewing {len(state.get('screenshots', []))} screenshots")
    agent = ValidatorAgent()
    return agent.run(state)


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
