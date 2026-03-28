"""Confluence Cloud REST API client for fetching page content."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import requests
from bs4 import BeautifulSoup
from requests.auth import HTTPBasicAuth

from config import Config

log = logging.getLogger(__name__)


@dataclass
class ConfluencePage:
    page_id: str
    title: str
    body_text: str
    labels: list[str]
    url: str


class ConfluenceClient:
    """Thin wrapper around Confluence Cloud REST API v2 / v1."""

    def __init__(self) -> None:
        self.base_url = Config.CONFLUENCE_BASE_URL.rstrip("/")
        self.auth = HTTPBasicAuth(Config.CONFLUENCE_EMAIL, Config.CONFLUENCE_API_TOKEN)
        self.headers = {"Accept": "application/json"}

    def _get(self, path: str, params: dict | None = None) -> dict:
        url = f"{self.base_url}/rest/api/{path}"
        resp = requests.get(url, headers=self.headers, auth=self.auth, params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    def _html_to_text(html: str) -> str:
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup.find_all(["script", "style"]):
            tag.decompose()
        text = soup.get_text(separator="\n")
        return re.sub(r"\n{3,}", "\n\n", text).strip()

    def _extract_page_id_from_url(self, url: str) -> str:
        """Supports both /pages/<id> and /wiki/spaces/.../pages/<id> formats."""
        match = re.search(r"/pages/(\d+)", url)
        if match:
            return match.group(1)

        match = re.search(r"pageId=(\d+)", url)
        if match:
            return match.group(1)

        raise ValueError(f"Cannot extract Confluence page ID from URL: {url}")

    def fetch_page(self, page_id_or_url: str) -> ConfluencePage:
        if page_id_or_url.startswith("http"):
            page_id = self._extract_page_id_from_url(page_id_or_url)
        else:
            page_id = page_id_or_url

        data = self._get(f"content/{page_id}", params={"expand": "body.storage,metadata.labels"})

        labels = [
            lbl["name"]
            for lbl in data.get("metadata", {}).get("labels", {}).get("results", [])
        ]

        body_html = data.get("body", {}).get("storage", {}).get("value", "")
        body_text = self._html_to_text(body_html)

        page_url = f"{self.base_url}{data.get('_links', {}).get('webui', '')}"

        return ConfluencePage(
            page_id=page_id,
            title=data.get("title", ""),
            body_text=body_text,
            labels=labels,
            url=page_url,
        )

    def fetch_child_pages(self, parent_page_id: str) -> list[ConfluencePage]:
        data = self._get(
            f"content/{parent_page_id}/child/page",
            params={"expand": "body.storage,metadata.labels", "limit": 50},
        )
        pages = []
        for child in data.get("results", []):
            body_html = child.get("body", {}).get("storage", {}).get("value", "")
            labels = [
                lbl["name"]
                for lbl in child.get("metadata", {}).get("labels", {}).get("results", [])
            ]
            pages.append(
                ConfluencePage(
                    page_id=child["id"],
                    title=child["title"],
                    body_text=self._html_to_text(body_html),
                    labels=labels,
                    url=f"{self.base_url}{child.get('_links', {}).get('webui', '')}",
                )
            )
        return pages

    def to_prompt_context(self, page: ConfluencePage) -> str:
        parts = [
            f"Page Title: {page.title}",
            f"Page URL: {page.url}",
        ]
        if page.labels:
            parts.append(f"Labels: {', '.join(page.labels)}")
        parts.append(f"Content:\n{page.body_text}")
        return "\n".join(parts)
