"""
BugHunter.AI - OrchestratorAgent
Analyzes the target app URL, plans the test strategy, and initializes state fields.
"""

import logging
import os

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage

from graph.state import AgentState

logger = logging.getLogger("bughunter.orchestrator")


class OrchestratorAgent:
    """Plans the testing strategy for a given web application URL."""

    def __init__(self):
        self.llm = ChatAnthropic(
            model="claude-3-5-sonnet-20241022",
            api_key=os.environ["ANTHROPIC_API_KEY"],
        )

    def run(self, state: AgentState) -> AgentState:
        url = state["url"]
        logger.info(f"Planning test strategy for: {url}")

        prompt = f"""You are a senior QA engineer. Analyze this web application URL and create a testing strategy.

URL: {url}

Provide:
1. Key pages/flows to test (home, login, dashboard, forms, etc.)
2. Critical user journeys
3. Common bug-prone areas to focus on
4. Any credentials to test (use common defaults if none provided)

Be concise and practical. Output as JSON with keys: pages, user_journeys, focus_areas, notes
"""

        try:
            response = self.llm.invoke([HumanMessage(content=prompt)])
            plan_text = response.content
            logger.info(f"Test plan generated: {plan_text[:200]}...")
        except Exception as exc:
            logger.error(f"OrchestratorAgent LLM call failed: {exc}")
            plan_text = f"Default strategy for {url}"

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
