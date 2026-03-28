"""Figma REST API client for extracting design information."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

import requests

from config import Config

log = logging.getLogger(__name__)


@dataclass
class FigmaComponent:
    name: str
    component_type: str
    visible: bool = True
    children_names: list[str] = field(default_factory=list)
    text_content: list[str] = field(default_factory=list)


@dataclass
class FigmaDesign:
    file_key: str
    file_name: str
    pages: list[str]
    components: list[FigmaComponent]
    raw_text_elements: list[str]


class FigmaClient:
    """Extracts UI structure and text from Figma files via the REST API."""

    API = "https://api.figma.com/v1"

    def __init__(self) -> None:
        self.token = Config.FIGMA_ACCESS_TOKEN
        self.headers = {"X-Figma-Token": self.token}

    def _get(self, path: str) -> dict:
        resp = requests.get(f"{self.API}/{path}", headers=self.headers, timeout=60)
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    def _parse_figma_url(url: str) -> tuple[str, str | None]:
        """Return (file_key, node_id | None) from a Figma URL."""
        match = re.search(r"figma\.com/(?:file|design)/([A-Za-z0-9]+)", url)
        if not match:
            raise ValueError(f"Invalid Figma URL: {url}")
        file_key = match.group(1)

        node_match = re.search(r"node-id=([^&]+)", url)
        node_id = node_match.group(1).replace("-", ":") if node_match else None
        return file_key, node_id

    def _walk_tree(self, node: dict, components: list, texts: list, depth: int = 0) -> None:
        node_type = node.get("type", "")
        name = node.get("name", "")

        if node_type == "TEXT":
            chars = node.get("characters", "")
            if chars.strip():
                texts.append(chars.strip())

        if node_type in ("FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "GROUP"):
            children_names = [c.get("name", "") for c in node.get("children", [])]
            comp = FigmaComponent(
                name=name,
                component_type=node_type,
                visible=node.get("visible", True),
                children_names=children_names,
                text_content=[],
            )
            for child in node.get("children", []):
                if child.get("type") == "TEXT":
                    chars = child.get("characters", "")
                    if chars.strip():
                        comp.text_content.append(chars.strip())
            components.append(comp)

        for child in node.get("children", []):
            self._walk_tree(child, components, texts, depth + 1)

    def fetch_design(self, file_key_or_url: str) -> FigmaDesign:
        if file_key_or_url.startswith("http"):
            file_key, node_id = self._parse_figma_url(file_key_or_url)
        else:
            file_key, node_id = file_key_or_url, None

        data = self._get(f"files/{file_key}")
        file_name = data.get("name", file_key)
        document = data.get("document", {})

        pages = [p.get("name", "") for p in document.get("children", [])]
        components: list[FigmaComponent] = []
        texts: list[str] = []

        if node_id:
            node_data = self._get(f"files/{file_key}/nodes?ids={node_id}")
            nodes = node_data.get("nodes", {})
            for nid, nval in nodes.items():
                self._walk_tree(nval.get("document", {}), components, texts)
        else:
            self._walk_tree(document, components, texts)

        return FigmaDesign(
            file_key=file_key,
            file_name=file_name,
            pages=pages,
            components=components,
            raw_text_elements=texts,
        )

    def to_prompt_context(self, design: FigmaDesign) -> str:
        parts = [
            f"Figma File: {design.file_name}",
            f"Pages: {', '.join(design.pages)}",
            "",
            "UI Components:",
        ]
        for comp in design.components[:80]:
            visibility = "" if comp.visible else " [HIDDEN]"
            parts.append(f"  - [{comp.component_type}] {comp.name}{visibility}")
            if comp.text_content:
                for t in comp.text_content[:5]:
                    parts.append(f"      Text: \"{t}\"")
            if comp.children_names:
                parts.append(f"      Children: {', '.join(comp.children_names[:10])}")

        if design.raw_text_elements:
            parts.append("\nAll visible text labels:")
            for t in design.raw_text_elements[:100]:
                parts.append(f'  "{t}"')

        return "\n".join(parts)
