"""
BugHunter.AI - OrchestratorAgent
Analyzes the target app URL, plans the test strategy, and initializes state fields.
"""

import logging

from langchain_core.messages import HumanMessage

from graph.state import AgentState
from providers import get_llm
from tools.events import publish_event
from tools.memory import format_memory_for_prompt, format_skills_for_prompt

logger = logging.getLogger("bughunter.orchestrator")


class OrchestratorAgent:
    """Plans the testing strategy for a given web application URL."""

    def __init__(self):
        self.llm = get_llm()

    def run(self, state: AgentState) -> AgentState:
        url = state["url"]
        run_id = state.get("run_id")
        credentials = state.get("credentials")
        logger.info(f"Planning test strategy for: {url}")
        publish_event(run_id, "agent_start", {"agent": "orchestrator", "message": f"Planning test strategy for {url}…"})

        # Summarise auth context so the plan reflects what's actually available
        if isinstance(credentials, dict) and credentials.get("login_flow"):
            n_steps = len(credentials["login_flow"])
            auth_context = f"Multi-step SSO login flow provided ({n_steps} steps)."
        elif isinstance(credentials, dict) and credentials.get("username"):
            auth_context = "Simple username/password credentials provided."
        else:
            auth_context = "No credentials provided — test as an anonymous user."

        # Build memory and skills context for the prompt
        memory = state.get("memory", {})
        skills = state.get("skills", [])
        memory_section = format_memory_for_prompt(memory)
        skills_section = format_skills_for_prompt(skills, agent_type="orchestrator")

        history_block = ""
        if memory_section or skills_section:
            history_block = f"""
--- HISTORICAL CONTEXT (from previous runs on this same app) ---
{memory_section}
{skills_section}
Use this history to prioritize previously buggy areas and refine your strategy.
--- END HISTORICAL CONTEXT ---
"""

        prompt = f"""You are a senior QA engineer. Analyze this web application URL and create a testing strategy.

URL: {url}
Auth context: {auth_context}
{history_block}
Provide:
1. Key pages/flows to test — prioritize previously buggy areas if history is available
2. Critical user journeys
3. Common bug-prone areas to focus on
4. Notes on authentication strategy based on the auth context above

Be concise and practical. Output as JSON with keys: pages, user_journeys, focus_areas, notes
"""

        try:
            response = self.llm.invoke([HumanMessage(content=prompt)])
            plan_text = response.content
            logger.info(f"Test plan generated: {plan_text[:200]}...")
        except Exception as exc:
            logger.error(f"OrchestratorAgent LLM call failed: {exc}")
            plan_text = f"Default strategy for {url}"

        publish_event(run_id, "agent_done", {"agent": "orchestrator", "message": "Test strategy ready — starting exploration"})
        return {
            **state,
            "current_agent": "orchestrator",
            "status": "running",
            "screenshots": state.get("screenshots", []),
            "bugs_found": state.get("bugs_found", []),
            "test_steps": [
                {
                    "action": "plan",
                    "detail": plan_text,
                    "agent": "orchestrator",
                }
            ],
            "error": None,
        }
