"""Orchestrator that pulls context from various sources and generates .feature files."""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime
from pathlib import Path

from config import Config
from generators.ai_engine import generate_feature, generate_smoke_test, generate_test_scenario
from integrations.confluence_client import ConfluenceClient
from integrations.figma_client import FigmaClient
from integrations.jira_client import JiraClient

log = logging.getLogger(__name__)


def _sanitize_filename(name: str) -> str:
    name = re.sub(r"[^\w\s-]", "", name)
    name = re.sub(r"[\s]+", "_", name).strip("_").lower()
    return name or "generated"


def parse_test_scenarios(content: str) -> list[dict]:
    """
    Parse a generated test scenario document into individual test cases.
    Each test case gets a 'title' and 'description' suitable for Jira upload.
    """
    scenarios: list[dict] = []

    scenario_pattern = re.compile(
        r"(?:Scenario ID\s*:\s*(TS-\d+))\s*\n"
        r"(?:Scenario Title\s*:\s*(.+?))\s*\n",
        re.IGNORECASE,
    )

    blocks = re.split(r"(?=Scenario ID\s*:)", content, flags=re.IGNORECASE)
    for block in blocks:
        block = block.strip()
        if not block:
            continue

        match = scenario_pattern.search(block)
        if match:
            sc_id = match.group(1).strip()
            sc_title = match.group(2).strip()
            scenarios.append({
                "id": sc_id,
                "title": f"{sc_id} - {sc_title}",
                "description": block,
            })

    if not scenarios:
        gherkin_blocks = re.split(
            r"(?=^\s*(?:Scenario Outline:|Scenario:))",
            content,
            flags=re.MULTILINE,
        )
        for block in gherkin_blocks:
            block = block.strip()
            if not block:
                continue
            first_line = block.split("\n")[0].strip()
            m = re.match(r"(?:Scenario Outline:|Scenario:)\s*(.+)", first_line)
            if m:
                title = m.group(1).strip()
                scenarios.append({
                    "id": "",
                    "title": title,
                    "description": block,
                })

    if not scenarios:
        chunks = content.strip().split("\n\n")
        for i, chunk in enumerate(chunks, start=1):
            chunk = chunk.strip()
            if len(chunk) > 20:
                first_line = chunk.split("\n")[0][:80]
                scenarios.append({
                    "id": f"TC-{i:03d}",
                    "title": first_line,
                    "description": chunk,
                })

    return scenarios


def _save_feature(content: str, name: str, ext: str = ".feature") -> str:
    output_dir = Path(Config.OUTPUT_DIR)
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{_sanitize_filename(name)}{ext}"
    filepath = output_dir / filename
    filepath.write_text(content, encoding="utf-8")
    log.info("Saved file: %s", filepath)
    return str(filepath)


def _generate_content(context: str, extra_instructions: str, output_format: str) -> str:
    if output_format == "test_scenario":
        return generate_test_scenario(context, extra_instructions)
    if output_format == "smoke_test":
        return generate_smoke_test(context, extra_instructions)
    return generate_feature(context, extra_instructions)


def _file_ext(output_format: str) -> str:
    if output_format in ("test_scenario", "smoke_test"):
        return ".txt"
    return ".feature"


def generate_from_user_story(
    story_text: str,
    extra_instructions: str = "",
    output_format: str = "feature",
) -> dict:
    """Generate a .feature or test scenario file from free-text user story input."""
    context = f"User Story / Requirement:\n{story_text}"
    content = _generate_content(context, extra_instructions, output_format)

    first_line = story_text.strip().split("\n")[0][:60]
    filepath = _save_feature(content, first_line, _file_ext(output_format))

    return {
        "source": "user_story",
        "output_format": output_format,
        "feature_content": content,
        "filepath": filepath,
    }


def generate_from_jira(
    issue_key: str,
    extra_instructions: str = "",
    output_format: str = "feature",
) -> dict:
    """Fetch a Jira issue and generate a .feature or test scenario file from it."""
    client = JiraClient()
    req = client.fetch_issue(issue_key)
    context = client.to_prompt_context(req)
    content = _generate_content(context, extra_instructions, output_format)
    filepath = _save_feature(content, f"{req.key}_{req.summary}", _file_ext(output_format))

    return {
        "source": "jira",
        "output_format": output_format,
        "issue_key": req.key,
        "summary": req.summary,
        "feature_content": content,
        "filepath": filepath,
    }


def generate_from_jira_jql(
    jql: str,
    extra_instructions: str = "",
    output_format: str = "feature",
) -> list[dict]:
    """Run a JQL query and generate files for each result."""
    client = JiraClient()
    requirements = client.search_issues(jql)
    results = []
    for req in requirements:
        context = client.to_prompt_context(req)
        content = _generate_content(context, extra_instructions, output_format)
        filepath = _save_feature(content, f"{req.key}_{req.summary}", _file_ext(output_format))
        results.append({
            "source": "jira",
            "output_format": output_format,
            "issue_key": req.key,
            "summary": req.summary,
            "feature_content": content,
            "filepath": filepath,
        })
    return results


def generate_from_confluence(
    page_id_or_url: str,
    extra_instructions: str = "",
    output_format: str = "feature",
) -> dict:
    """Fetch a Confluence page and generate a .feature or test scenario file."""
    client = ConfluenceClient()
    page = client.fetch_page(page_id_or_url)
    context = client.to_prompt_context(page)
    content = _generate_content(context, extra_instructions, output_format)
    filepath = _save_feature(content, page.title, _file_ext(output_format))

    return {
        "source": "confluence",
        "output_format": output_format,
        "page_id": page.page_id,
        "title": page.title,
        "feature_content": content,
        "filepath": filepath,
    }


def generate_from_figma(
    file_key_or_url: str,
    extra_instructions: str = "",
    output_format: str = "feature",
) -> dict:
    """Fetch a Figma design file and generate a .feature or test scenario file."""
    client = FigmaClient()
    design = client.fetch_design(file_key_or_url)
    context = client.to_prompt_context(design)
    content = _generate_content(context, extra_instructions, output_format)
    filepath = _save_feature(content, design.file_name, _file_ext(output_format))

    return {
        "source": "figma",
        "output_format": output_format,
        "file_name": design.file_name,
        "pages": design.pages,
        "feature_content": content,
        "filepath": filepath,
    }


def generate_from_multiple_sources(
    user_story: str = "",
    jira_key: str = "",
    confluence_url: str = "",
    figma_url: str = "",
    extra_instructions: str = "",
    output_format: str = "feature",
) -> dict:
    """Aggregate context from multiple sources and generate a single file."""
    context_parts: list[str] = []
    sources_used: list[str] = []
    name_parts: list[str] = []

    if user_story.strip():
        context_parts.append(f"== User Story ==\n{user_story.strip()}")
        sources_used.append("user_story")
        name_parts.append(user_story.strip().split("\n")[0][:30])

    if jira_key.strip():
        client = JiraClient()
        req = client.fetch_issue(jira_key.strip())
        context_parts.append(f"== Jira Issue {req.key} ==\n{client.to_prompt_context(req)}")
        sources_used.append("jira")
        name_parts.append(req.key)

    if confluence_url.strip():
        client = ConfluenceClient()
        page = client.fetch_page(confluence_url.strip())
        context_parts.append(f"== Confluence Page ==\n{client.to_prompt_context(page)}")
        sources_used.append("confluence")
        name_parts.append(page.title[:30])

    if figma_url.strip():
        client = FigmaClient()
        design = client.fetch_design(figma_url.strip())
        context_parts.append(f"== Figma Design ==\n{client.to_prompt_context(design)}")
        sources_used.append("figma")
        name_parts.append(design.file_name[:30])

    if not context_parts:
        raise ValueError("At least one source (user story, Jira, Confluence, or Figma) must be provided.")

    combined_context = "\n\n".join(context_parts)
    content = _generate_content(combined_context, extra_instructions, output_format)
    filename = "_".join(name_parts) if name_parts else "combined"
    filepath = _save_feature(content, filename, _file_ext(output_format))

    return {
        "sources": sources_used,
        "output_format": output_format,
        "feature_content": content,
        "filepath": filepath,
    }
