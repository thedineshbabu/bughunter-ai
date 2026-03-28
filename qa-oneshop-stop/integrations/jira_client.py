"""Jira Cloud REST API client for fetching issues / user stories."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

import requests
from requests.auth import HTTPBasicAuth

from config import Config

log = logging.getLogger(__name__)


@dataclass
class JiraRequirement:
    key: str
    summary: str
    description: str
    acceptance_criteria: str
    issue_type: str
    priority: str
    labels: list[str] = field(default_factory=list)
    components: list[str] = field(default_factory=list)
    subtasks: list[dict[str, str]] = field(default_factory=list)


@dataclass
class CreatedIssue:
    key: str
    issue_id: str
    self_url: str


class JiraClient:
    """Thin wrapper around Jira Cloud REST API v3."""

    def __init__(self) -> None:
        self.base_url = Config.JIRA_BASE_URL.rstrip("/")
        self.auth = HTTPBasicAuth(Config.JIRA_EMAIL, Config.JIRA_API_TOKEN)
        self.headers = {"Accept": "application/json", "Content-Type": "application/json"}

    def _get(self, path: str, params: dict | None = None) -> dict:
        url = f"{self.base_url}/rest/api/3/{path}"
        resp = requests.get(url, headers=self.headers, auth=self.auth, params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def _post(self, path: str, json_body: dict) -> dict:
        url = f"{self.base_url}/rest/api/3/{path}"
        resp = requests.post(url, headers=self.headers, auth=self.auth, json=json_body, timeout=30)
        resp.raise_for_status()
        return resp.json() if resp.content else {}

    def _extract_text(self, doc: Any) -> str:
        """Recursively extract plain text from Atlassian Document Format (ADF)."""
        if doc is None:
            return ""
        if isinstance(doc, str):
            return doc
        if isinstance(doc, dict):
            if doc.get("type") == "text":
                return doc.get("text", "")
            children = doc.get("content", [])
            return "\n".join(self._extract_text(c) for c in children).strip()
        if isinstance(doc, list):
            return "\n".join(self._extract_text(item) for item in doc).strip()
        return str(doc)

    @staticmethod
    def _normalize_issue_key(issue_key: str) -> str:
        """Extract the issue key (e.g. KF1-11776) from a full Jira URL or raw key."""
        issue_key = issue_key.strip()
        match = re.search(r"([A-Z][A-Z0-9_]+-\d+)", issue_key)
        if match:
            return match.group(1)
        return issue_key

    def fetch_issue(self, issue_key: str) -> JiraRequirement:
        issue_key = self._normalize_issue_key(issue_key)
        data = self._get(f"issue/{issue_key}")
        fields = data["fields"]

        ac_field = ""
        for custom in ("customfield_10035", "customfield_10036", "customfield_10037"):
            val = fields.get(custom)
            if val:
                ac_field = self._extract_text(val)
                break

        subtasks = [
            {"key": st["key"], "summary": st["fields"]["summary"]}
            for st in fields.get("subtasks", [])
        ]

        return JiraRequirement(
            key=data["key"],
            summary=fields.get("summary", ""),
            description=self._extract_text(fields.get("description")),
            acceptance_criteria=ac_field,
            issue_type=fields.get("issuetype", {}).get("name", ""),
            priority=fields.get("priority", {}).get("name", ""),
            labels=fields.get("labels", []),
            components=[c["name"] for c in fields.get("components", [])],
            subtasks=subtasks,
        )

    def search_issues(self, jql: str, max_results: int = 50) -> list[JiraRequirement]:
        data = self._get("search", params={"jql": jql, "maxResults": max_results})
        return [self.fetch_issue(issue["key"]) for issue in data.get("issues", [])]

    def fetch_sprint_stories(self, board_id: int, sprint_id: int) -> list[JiraRequirement]:
        jql = f"sprint = {sprint_id} AND issuetype in (Story, 'User Story') ORDER BY rank"
        return self.search_issues(jql)

    def to_prompt_context(self, req: JiraRequirement) -> str:
        parts = [
            f"Issue Key: {req.key}",
            f"Type: {req.issue_type}",
            f"Priority: {req.priority}",
            f"Summary: {req.summary}",
            f"Description:\n{req.description}",
        ]
        if req.acceptance_criteria:
            parts.append(f"Acceptance Criteria:\n{req.acceptance_criteria}")
        if req.labels:
            parts.append(f"Labels: {', '.join(req.labels)}")
        if req.components:
            parts.append(f"Components: {', '.join(req.components)}")
        if req.subtasks:
            st_lines = "\n".join(f"  - {s['key']}: {s['summary']}" for s in req.subtasks)
            parts.append(f"Sub-tasks:\n{st_lines}")
        return "\n".join(parts)

    # ── Issue creation helpers ────────────────────────────

    def _get_project_key(self, issue_key: str) -> str:
        """Extract project key from an issue key like 'KF1-1234'."""
        return issue_key.rsplit("-", 1)[0]

    def _text_to_adf(self, text: str) -> dict:
        """Convert plain text to Atlassian Document Format (ADF)."""
        paragraphs = text.split("\n\n") if "\n\n" in text else text.split("\n")
        content = []
        for para in paragraphs:
            if not para.strip():
                continue
            content.append({
                "type": "paragraph",
                "content": [{"type": "text", "text": para.strip()}],
            })
        return {"version": 1, "type": "doc", "content": content} if content else {
            "version": 1, "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
        }

    def get_available_issue_types(self, project_key: str) -> list[dict]:
        """Return the issue types available for the given project."""
        data = self._get(f"project/{project_key}")
        return [
            {"id": it["id"], "name": it["name"], "subtask": it.get("subtask", False)}
            for it in data.get("issueTypes", [])
        ]

    def _find_issue_type(self, project_key: str, preferred_names: list[str]) -> dict | None:
        """Find the first matching issue type by name (case-insensitive)."""
        types = self.get_available_issue_types(project_key)
        lower_map = {t["name"].lower(): t for t in types}
        for name in preferred_names:
            if name.lower() in lower_map:
                return lower_map[name.lower()]
        return None

    def create_issue(
        self,
        project_key: str,
        summary: str,
        description: str,
        issue_type_name: str = "Task",
        parent_key: str | None = None,
        labels: list[str] | None = None,
    ) -> CreatedIssue:
        """Create a new Jira issue. Optionally set a parent for sub-tasks."""
        fields: dict[str, Any] = {
            "project": {"key": project_key},
            "summary": summary,
            "description": self._text_to_adf(description),
            "issuetype": {"name": issue_type_name},
        }
        if parent_key:
            fields["parent"] = {"key": parent_key}
        if labels:
            fields["labels"] = labels

        data = self._post("issue", {"fields": fields})
        return CreatedIssue(
            key=data["key"],
            issue_id=data["id"],
            self_url=data["self"],
        )

    def link_issues(self, inward_key: str, outward_key: str, link_type: str = "Test") -> None:
        """Create an issue link between two issues."""
        body = {
            "type": {"name": link_type},
            "inwardIssue": {"key": inward_key},
            "outwardIssue": {"key": outward_key},
        }
        url = f"{self.base_url}/rest/api/3/issueLink"
        resp = requests.post(url, headers=self.headers, auth=self.auth, json=body, timeout=30)
        resp.raise_for_status()

    def add_comment(self, issue_key: str, body_text: str) -> dict:
        """Add a comment to an existing Jira issue."""
        payload = {"body": self._text_to_adf(body_text)}
        return self._post(f"issue/{issue_key}/comment", payload)

    def push_test_cases(
        self,
        parent_issue_key: str,
        test_cases: list[dict],
    ) -> dict:
        """
        Create test-case issues in Jira as sub-tasks (or Tasks linked to the parent).

        Each entry in *test_cases* must have at least 'title' and 'description'.
        Returns a summary dict with created issue keys and any errors.
        """
        parent_issue_key = self._normalize_issue_key(parent_issue_key)
        project_key = self._get_project_key(parent_issue_key)

        sub_task_type = self._find_issue_type(project_key, ["Sub-task", "Subtask", "Sub-Task"])

        created: list[dict] = []
        errors: list[dict] = []

        for idx, tc in enumerate(test_cases, start=1):
            title = tc.get("title", f"Test Case #{idx}")
            description = tc.get("description", "")
            summary = f"[TC] {title}"

            try:
                if sub_task_type:
                    issue = self.create_issue(
                        project_key=project_key,
                        summary=summary,
                        description=description,
                        issue_type_name=sub_task_type["name"],
                        parent_key=parent_issue_key,
                        labels=["auto-generated-test-case"],
                    )
                else:
                    issue = self.create_issue(
                        project_key=project_key,
                        summary=summary,
                        description=description,
                        issue_type_name="Task",
                        labels=["auto-generated-test-case"],
                    )
                    try:
                        self.link_issues(issue.key, parent_issue_key, link_type="Relates")
                    except Exception as link_err:
                        log.warning("Could not link %s -> %s: %s", issue.key, parent_issue_key, link_err)

                created.append({"key": issue.key, "summary": summary})
                log.info("Created test case %s for parent %s", issue.key, parent_issue_key)

            except Exception as exc:
                log.error("Failed to create test case '%s': %s", title, exc)
                errors.append({"title": title, "error": str(exc)})

        comment_lines = [f"**Auto-Generated Test Cases** ({len(created)} created):\n"]
        for c in created:
            comment_lines.append(f"- {c['key']}: {c['summary']}")
        if errors:
            comment_lines.append(f"\n{len(errors)} test case(s) failed to create.")

        try:
            self.add_comment(parent_issue_key, "\n".join(comment_lines))
        except Exception as exc:
            log.warning("Could not add summary comment to %s: %s", parent_issue_key, exc)

        return {
            "parent_key": parent_issue_key,
            "created": created,
            "errors": errors,
            "total": len(test_cases),
            "success_count": len(created),
            "error_count": len(errors),
        }
