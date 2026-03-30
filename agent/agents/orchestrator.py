"""
BugHunter.AI - OrchestratorAgent
Analyzes the target app URL, plans the test strategy, and initializes state fields.
"""

import json
import logging

from langchain_core.messages import HumanMessage

from graph.state import AgentState
from providers import get_llm
from tools.events import publish_event
from tools.json_utils import extract_json_from_text

logger = logging.getLogger("bughunter.orchestrator")


def _parse_strategic_plan(plan_text: str) -> dict:
    """Parse JSON plan from LLM output; fall back to empty structure + notes."""
    default: dict = {"user_journeys": [], "focus_areas": "", "notes": ""}
    try:
        raw = extract_json_from_text(plan_text)
        data = json.loads(raw)
        if isinstance(data, dict):
            uj = data.get("user_journeys")
            default["user_journeys"] = uj if isinstance(uj, list) else []
            fa = data.get("focus_areas")
            if isinstance(fa, str):
                default["focus_areas"] = fa
            elif isinstance(fa, list):
                default["focus_areas"] = ", ".join(str(x) for x in fa)
            notes = data.get("notes")
            default["notes"] = notes if isinstance(notes, str) else ""
            return default
    except Exception as exc:
        logger.debug(f"Could not parse strategic plan as JSON: {exc}")
    return {**default, "notes": (default.get("notes") or "") + (plan_text[:1500] if plan_text else "")}


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

        test_config = state.get("test_config") or {}
        user_instructions = test_config.get("instructions", "").strip()
        focus_areas = test_config.get("focus_areas", "").strip()
        max_pages = test_config.get("max_pages", 5)

        custom_section = ""
        if user_instructions:
            custom_section += f"\nUser instructions: {user_instructions}"
        if focus_areas:
            custom_section += f"\nFocus areas: {focus_areas}"
        if max_pages:
            custom_section += f"\nThe explorer will visit up to {max_pages} page(s)."

        memory_section = ""
        app_memory = state.get("app_memory") or {}
        if app_memory.get("total_runs", 0) > 0:
            total_runs = app_memory["total_runs"]
            known_bugs = app_memory.get("known_bugs", [])
            pages = app_memory.get("pages", {})
            memory_section = f"\n\nPrevious test history ({total_runs} run(s)):"
            if known_bugs:
                top = sorted(known_bugs, key=lambda b: b.get("occurrence_count", 1), reverse=True)[:5]
                lines = "\n".join(
                    f"  - [{b['severity'].upper()}] {b['title']} — {b['page_url']} (seen {b.get('occurrence_count', 1)}x)"
                    for b in top
                )
                memory_section += f"\nKnown recurring bugs (verify if fixed):\n{lines}"
            if pages:
                top_pages = sorted(pages.items(), key=lambda kv: kv[1].get("priority_score", 0), reverse=True)[:3]
                lines = "\n".join(
                    f"  - {page_url} ({info.get('bug_count', 0)} historical bug(s))"
                    for page_url, info in top_pages
                )
                memory_section += f"\nBug-prone pages to prioritise:\n{lines}"

        prompt = f"""You are a senior QA engineer. Define a testing strategy for this web application.

URL: {url}
Auth context: {auth_context}{custom_section}{memory_section}

The browser will discover pages by crawling real links — do NOT list specific URL paths.

Define:
1. Critical user journeys to verify (e.g. "login → view dashboard → update profile")
2. Functional areas to focus on (e.g. forms, navigation, data display, auth, error handling)
3. Common bug-prone patterns to watch for in this type of app
4. Notes on the authentication approach

Output as JSON with these keys only: user_journeys, focus_areas, notes
"""

        try:
            response = self.llm.invoke([HumanMessage(content=prompt)])
            plan_text = response.content
            logger.info(f"Test plan generated: {plan_text[:200]}...")
        except Exception as exc:
            logger.error(f"OrchestratorAgent LLM call failed: {exc}")
            plan_text = f'{{"pages":[],"user_journeys":[],"focus_areas":"","notes":"Default strategy for {url}"}}'

        strategic_plan = _parse_strategic_plan(plan_text)

        publish_event(run_id, "agent_done", {"agent": "orchestrator", "message": "Test strategy ready — starting exploration"})
        return {
            **state,
            "current_agent": "orchestrator",
            "status": "running",
            "screenshots": state.get("screenshots", []),
            "bugs_found": state.get("bugs_found", []),
            "strategic_plan": strategic_plan,
            "test_steps": [
                {
                    "action": "plan",
                    "detail": plan_text,
                    "agent": "orchestrator",
                }
            ],
            "error": None,
        }
