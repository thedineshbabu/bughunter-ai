"""
BugHunter.AI - BDD Test Generator
Generates Gherkin/Cucumber .feature files from a list of bug reports
found during an agent run. Uses the same LLM provider as the rest of
the agent pipeline (configured via LLM_PROVIDER env var).
"""

import logging
import re

from langchain_core.messages import HumanMessage, SystemMessage

from providers import get_llm

logger = logging.getLogger("bughunter.bdd_generator")

SYSTEM_PROMPT = """You are an expert QA engineer writing Cucumber/Gherkin BDD feature files for regression testing.

Rules:
- Write one Feature block per application area or page
- Create one Scenario per bug found, naming it to describe the regression test
- Use descriptive Scenario names that clearly identify what is being tested
- Use Given/When/Then steps that are specific and actionable
- Add a @regression tag to all scenarios, plus severity tags like @critical, @high, @medium, @low
- Include @bug_id tags like @bug-1, @bug-2 etc. for traceability
- Write steps in plain English — no code or selectors
- Ensure the feature file is valid Gherkin syntax

Output ONLY the raw .feature file content. Do not wrap in markdown fences.
"""


def generate_bdd_from_bugs(bugs: list, app_url: str) -> str:
    """Generate a Gherkin .feature file from a list of structured bug reports.

    Args:
        bugs: List of bug report dicts (title, description, steps_to_reproduce,
              expected_behavior, actual_behavior, severity, page_url).
        app_url: The target application URL (used as context).

    Returns:
        Raw .feature file content as a string.
    """
    if not bugs:
        return "# No bugs found — no regression tests generated.\n"

    llm = get_llm()

    # Build the bug context for the prompt
    context_lines = [f"Application: {app_url}\n", "Bugs to create regression tests for:\n"]
    for i, bug in enumerate(bugs, 1):
        context_lines.append(f"\n--- Bug {i} ---")
        context_lines.append(f"Severity: {bug.get('severity', 'medium').upper()}")
        context_lines.append(f"Title: {bug.get('title', 'Unknown bug')}")
        context_lines.append(f"Page URL: {bug.get('page_url', '')}")
        context_lines.append(f"Description: {bug.get('description', '')}")
        if bug.get("steps_to_reproduce"):
            context_lines.append(f"Steps to Reproduce: {bug['steps_to_reproduce']}")
        if bug.get("expected_behavior"):
            context_lines.append(f"Expected: {bug['expected_behavior']}")
        if bug.get("actual_behavior"):
            context_lines.append(f"Actual: {bug['actual_behavior']}")

    context = "\n".join(context_lines)

    prompt = (
        f"{context}\n\n"
        "Generate a complete Gherkin .feature file with one Scenario for each bug above."
    )

    try:
        response = llm.invoke([
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        content = response.content.strip()
        # Strip markdown fences in case the LLM wraps the output anyway
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        return content
    except Exception as exc:
        logger.error(f"BDD generation failed: {exc}")
        # Return a minimal fallback feature file
        return _fallback_feature(bugs, app_url)


def _fallback_feature(bugs: list, app_url: str) -> str:
    """Generate a minimal feature file without LLM when generation fails."""
    domain = re.sub(r"https?://", "", app_url).split("/")[0]
    lines = [
        f"Feature: Regression tests for {domain}",
        f"  # Auto-generated from BugHunter.AI findings",
        "",
    ]
    for i, bug in enumerate(bugs, 1):
        sev = bug.get("severity", "medium")
        title = bug.get("title", f"Bug {i}")
        lines += [
            f"  @regression @{sev} @bug-{i}",
            f"  Scenario: Verify fix for — {title}",
            f"    Given I navigate to {bug.get('page_url', app_url)}",
            f"    When I interact with the affected area",
            f"    Then the issue should not occur",
            "",
        ]
    return "\n".join(lines)
