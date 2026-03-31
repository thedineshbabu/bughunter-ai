"""
BugHunter.AI - ValidatorAgent
Reviews screenshots and test steps to identify functional bugs using Claude.
Supports vision-based analysis when screenshots with base64 data are available.
"""

import json
import logging

from langchain_core.messages import HumanMessage

from graph.state import AgentState
from providers import get_llm
from tools.control import SIGNAL_STOP, check_run_control
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
            start = raw.find("[")
            end = raw.rfind("]") + 1
            if start != -1 and end > start:
                return json.loads(raw[start:end])
        except Exception as exc:
            logger.error(f"ValidatorAgent LLM call failed: {exc}")
        return []

    def _analyze_screenshot_visual(self, screenshot: dict, known_bugs: list = None) -> list:
        """Use vision (multimodal) to analyze a screenshot image for visual bugs."""
        base64_data = screenshot.get("base64")
        if not base64_data:
            return []

        page_url = screenshot.get("url", "unknown")
        label = screenshot.get("label", "")

        regression_section = ""
        if known_bugs:
            page_known = [b for b in known_bugs if b.get("page_url") == page_url]
            if page_known:
                titles = [b.get("title", "?") for b in page_known[:5]]
                regression_section = f"\nKnown bugs on this page from previous runs: {', '.join(titles)}\nCheck if any of these are still present (regression).\n"

        text_prompt = f"""You are a senior QA engineer reviewing a screenshot of a web application page.

Page URL: {page_url}
Screenshot label: {label}
{regression_section}
Examine this screenshot carefully for VISUAL bugs only:
- Broken or overlapping layouts
- Missing images or icons (broken image placeholders)
- Text overflow or truncation
- Misaligned elements
- Empty sections that should have content
- Modal/overlay rendering issues
- Responsive layout problems
- Incorrect colors or contrast issues
- Missing or garbled text
- UI elements rendered in wrong position

Do NOT report issues you cannot see in the image. Only report clear, visible problems.

Return a JSON array of bug objects. Each bug: {{
  "type": "ui",
  "title": "short descriptive title",
  "description": "what is visually wrong and where in the page",
  "page_url": "{page_url}",
  "severity": "critical|high|medium|low",
  "confidence": "high|medium|low"
}}
If no visual bugs found, return an empty array [].
"""
        try:
            # Build multimodal message with image
            message = HumanMessage(
                content=[
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{base64_data}"},
                    },
                    {"type": "text", "text": text_prompt},
                ]
            )
            response = self.llm.invoke([message])
            raw = response.content.strip()
            start = raw.find("[")
            end = raw.rfind("]") + 1
            if start != -1 and end > start:
                bugs = json.loads(raw[start:end])
                # Only keep medium+ confidence visual bugs
                return [b for b in bugs if b.get("confidence", "medium") != "low"]
        except Exception as exc:
            logger.warning(f"Vision analysis failed for {label}: {exc}")
        return []

    def run(self, state: AgentState) -> AgentState:
        test_steps = state.get("test_steps", [])
        screenshots = state.get("screenshots", [])
        bugs_found = list(state.get("bugs_found", []))
        run_id = state.get("run_id")
        app_memory = state.get("app_memory") or {}
        known_bugs = app_memory.get("known_bugs", [])

        if check_run_control(run_id) == SIGNAL_STOP:
            logger.info(f"Run {run_id} stopped — skipping validation")
            return {**state, "current_agent": "validator"}

        logger.info(f"Validating {len(test_steps)} test steps + {len(screenshots)} screenshots")
        if known_bugs:
            logger.info(f"Loaded {len(known_bugs)} known bug(s) from previous runs for regression detection")
        publish_event(run_id, "agent_start", {"agent": "validator", "message": "Analyzing screenshots for bugs…"})

        # Phase 1: Text-based analysis of test steps
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

        # Phase 2: Vision-based analysis of screenshots (multimodal)
        # Only analyze screenshots that still have base64 data
        visual_screenshots = [s for s in screenshots if s.get("base64")]
        if visual_screenshots:
            logger.info(f"Running vision analysis on {len(visual_screenshots)} screenshot(s)")
            publish_event(run_id, "agent_progress", {
                "agent": "validator",
                "message": f"Running visual inspection on {len(visual_screenshots)} screenshot(s)…",
            })
            for shot in visual_screenshots:
                if check_run_control(run_id) == SIGNAL_STOP:
                    break
                visual_bugs = self._analyze_screenshot_visual(shot, known_bugs)
                if visual_bugs:
                    logger.info(f"Vision found {len(visual_bugs)} visual bug(s) on {shot.get('url', '?')}")
                    bugs_found.extend(visual_bugs)
                    for bug in visual_bugs:
                        publish_event(run_id, "bug_found", {
                            "title": bug.get("title", "Visual bug"),
                            "severity": bug.get("severity", "medium"),
                            "page_url": bug.get("page_url", shot.get("url", "")),
                            "message": f"[VISUAL] {bug.get('title','Visual bug')}",
                        })
        else:
            logger.debug("No screenshots with base64 data available for vision analysis")

        logger.info(f"ValidatorAgent total bugs found: {len(bugs_found)}")
        publish_event(run_id, "agent_done", {"agent": "validator", "message": f"Validation complete — {len(bugs_found)} bug(s) (text + visual)"})

        return {
            **state,
            "current_agent": "validator",
            "bugs_found": bugs_found,
        }
