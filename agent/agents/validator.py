"""
BugHunter.AI - ValidatorAgent
Reviews screenshots and test steps to identify functional bugs using Claude.
"""

import json
import logging

from langchain_core.messages import HumanMessage

from graph.state import AgentState
from providers import get_llm

logger = logging.getLogger("bughunter.validator")


class ValidatorAgent:
    """Identifies functional bugs from collected screenshots and interaction logs."""

    def __init__(self):
        self.llm = get_llm()

    def _analyze_step(self, step: dict) -> list:
        """Ask Claude to identify bugs from a single test step observation."""
        prompt = f"""You are a QA engineer reviewing web application test results.

Test step data:
{json.dumps(step, indent=2)}

Identify any bugs or issues. Look for:
- 404 / 5xx errors
- Broken layouts or missing elements
- JavaScript console errors
- Network request failures
- Form validation failures
- Incorrect or missing data
- Accessibility issues

Return a JSON array of bug objects. Each bug: {{
  "type": "functional|ui|error|data",
  "title": "short title",
  "description": "what went wrong",
  "page_url": "url where it was found",
  "severity": "critical|high|medium|low"
}}
If no bugs found, return an empty array [].
"""
        try:
            response = self.llm.invoke([HumanMessage(content=prompt)])
            raw = response.content.strip()
            # Extract JSON array from response
            start = raw.find("[")
            end = raw.rfind("]") + 1
            if start != -1 and end > start:
                return json.loads(raw[start:end])
        except Exception as exc:
            logger.error(f"ValidatorAgent LLM call failed: {exc}")
        return []

    def run(self, state: AgentState) -> AgentState:
        test_steps = state.get("test_steps", [])
        bugs_found = list(state.get("bugs_found", []))

        logger.info(f"Validating {len(test_steps)} test steps")

        for step in test_steps:
            if step.get("action") in ("observe", "errors_detected"):
                new_bugs = self._analyze_step(step)
                if new_bugs:
                    logger.info(f"Found {len(new_bugs)} bug(s) in step: {step.get('url', '?')}")
                    bugs_found.extend(new_bugs)

        logger.info(f"ValidatorAgent total bugs found: {len(bugs_found)}")

        return {
            **state,
            "current_agent": "validator",
            "bugs_found": bugs_found,
        }
