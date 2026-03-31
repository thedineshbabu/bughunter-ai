"""Compact pipeline timeline from test_steps for run summary / tuning."""

from __future__ import annotations

from typing import Any, Dict, List


def build_pipeline_log(test_steps: List[Dict[str, Any]], max_entries: int = 120) -> List[Dict[str, Any]]:
    """Summarize test_steps for persistence (no large HTML/detail blobs)."""
    out: List[Dict[str, Any]] = []
    for step in test_steps[:max_entries]:
        action = step.get("action", "")
        agent = step.get("agent", "")
        url = (step.get("url") or "")[:500]
        entry: Dict[str, Any] = {"agent": agent, "action": action}
        if url:
            entry["url"] = url
        if action == "plan":
            detail = step.get("detail")
            if isinstance(detail, str):
                entry["detail_preview"] = detail[:240]
        elif action in ("observe", "errors_detected"):
            entry["has_detail"] = bool(step.get("detail") or step.get("console_errors"))
        out.append(entry)
    return out
