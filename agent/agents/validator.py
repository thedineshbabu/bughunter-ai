"""
BugHunter.AI - ValidatorAgent
Reviews screenshots and test steps to identify functional bugs using Claude.
"""

import json
import logging

from langchain_core.messages import HumanMessage

from graph.state import AgentState
from providers import get_llm
from tools.events import publish_event

logger = logging.getLogger("bughunter.validator")


class ValidatorAgent:
    """Identifies functional bugs from collected screenshots and interaction logs."""

    def __init__(self):
        self.llm = get_llm()

    def _analyze_step(self, step: dict, known_bugs: list = None) -> list:
        """Ask Claude to identify bugs from a single test step observation."""
        regression_section = ""
        if known_bugs:
            page_url = step.get("url", "")
            page_known = [b for b in known_bugs if b.get("page_url") == page_url]
            if page_known:
                fixed_bugs = [b for b in page_known if b.get("status") == "fixed"]
                open_bugs = [b for b in page_known if b.get("status") == "open"]
                parts = []
                if fixed_bugs:
                    titles = [b.get("title", "?") for b in fixed_bugs[:3]]
                    parts.append(f"Previously FIXED bugs on this page (check for regressions): {', '.join(titles)}")
                if open_bugs:
                    titles = [b.get("title", "?") for b in open_bugs[:3]]
                    parts.append(f"Known OPEN bugs (skip if unchanged): {', '.join(titles)}")
                if parts:
                    regression_section = "\n## Historical Context:\n" + "\n".join(f"- {p}" for p in parts) + "\n"

        prompt = f"""You are a QA engineer reviewing web application test results.
{regression_section}
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
- REGRESSIONS: bugs that were previously fixed but appear to have returned

Return a JSON array of bug objects. Each bug: {{
  "type": "functional|ui|error|data|regression",
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
        run_id = state.get("run_id")
        memory = state.get("memory") or {}
        known_bugs = memory.get("previous_bugs", [])

        logger.info(f"Validating {len(test_steps)} test steps")
        if known_bugs:
            logger.info(f"Loaded {len(known_bugs)} known bug(s) from previous runs for regression detection")
        publish_event(run_id, "agent_start", {"agent": "validator", "message": "Analyzing screenshots for bugs…"})

        for step in test_steps:
            if step.get("action") in ("observe", "errors_detected"):
                new_bugs = self._analyze_step(step, known_bugs)
                if new_bugs:
                    logger.info(f"Found {len(new_bugs)} bug(s) in step: {step.get('url', '?')}")
                    bugs_found.extend(new_bugs)
                    for bug in new_bugs:
                        publish_event(run_id, "bug_found", {
                            "title": bug.get("title", "Bug detected"),
                            "severity": bug.get("severity", "medium"),
                            "page_url": bug.get("page_url", step.get("url", "")),
                            "message": f"[{bug.get('severity','medium').upper()}] {bug.get('title','Bug detected')}",
                        })

        logger.info(f"ValidatorAgent total bugs found: {len(bugs_found)}")
        publish_event(run_id, "agent_done", {"agent": "validator", "message": f"Validation complete — {len(bugs_found)} functional bug(s)"})

        return {
            **state,
            "current_agent": "validator",
            "bugs_found": bugs_found,
        }
