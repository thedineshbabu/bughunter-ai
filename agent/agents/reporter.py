"""
BugHunter.AI - ReporterAgent
Generates structured, actionable bug reports using Claude.
"""

import json
import logging

from langchain_core.messages import HumanMessage

from graph.state import AgentState
from providers import get_llm
from tools.events import publish_event

logger = logging.getLogger("bughunter.reporter")


class ReporterAgent:
    """Converts raw bug observations into structured, developer-ready bug reports."""

    def __init__(self):
        self.llm = get_llm()

    def _generate_report(self, bug: dict) -> dict:
        """Use Claude to enrich a raw bug observation into a full bug report."""
        prompt = f"""You are a senior QA engineer writing a professional bug report.

Raw bug observation:
{json.dumps(bug, indent=2)}

Generate a structured bug report with these exact fields:
{{
  "title": "concise, descriptive title (max 100 chars)",
  "description": "detailed description of the bug",
  "steps_to_reproduce": "numbered steps to reproduce the bug",
  "expected_behavior": "what should happen",
  "actual_behavior": "what actually happens",
  "severity": "critical|high|medium|low",
  "type": "functional|security|ui|performance|data",
  "page_url": "URL where the bug was found",
  "screenshot_url": null
}}

Return ONLY the JSON object, no extra text.
"""
        try:
            response = self.llm.invoke([HumanMessage(content=prompt)])
            raw = response.content.strip()
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start != -1 and end > start:
                return json.loads(raw[start:end])
        except Exception as exc:
            logger.error(f"ReporterAgent LLM call failed: {exc}")

        # Fallback: use the raw bug data with defaults
        return {
            "title": bug.get("title", "Unknown Bug"),
            "description": bug.get("description", ""),
            "steps_to_reproduce": "See test logs for details.",
            "expected_behavior": "Application should function correctly.",
            "actual_behavior": bug.get("description", "Unexpected behavior observed."),
            "severity": bug.get("severity", "medium"),
            "type": bug.get("type", "functional"),
            "page_url": bug.get("page_url", ""),
            "screenshot_url": bug.get("screenshot_url", None),
        }

    def run(self, state: AgentState) -> AgentState:
        bugs_found = state.get("bugs_found", [])
        run_id = state.get("run_id")
        logger.info(f"Generating reports for {len(bugs_found)} bug(s)")
        publish_event(run_id, "agent_start", {"agent": "reporter", "message": f"Writing structured reports for {len(bugs_found)} bug(s)…"})

        structured_reports = []
        for raw_bug in bugs_found:
            report = self._generate_report(raw_bug)
            # Preserve screenshot_url if present on the original bug
            if "screenshot_url" in raw_bug and not report.get("screenshot_url"):
                report["screenshot_url"] = raw_bug["screenshot_url"]
            structured_reports.append(report)

        logger.info(f"Generated {len(structured_reports)} structured bug report(s)")
        publish_event(run_id, "agent_done", {"agent": "reporter", "message": f"Reports ready — {len(structured_reports)} bug(s) documented"})

        return {
            **state,
            "current_agent": "reporter",
            "status": "completed",
            "report": structured_reports,
        }
