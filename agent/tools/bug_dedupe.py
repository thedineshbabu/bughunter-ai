"""Merge duplicate bug observations before structured reporting."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Tuple

from tools.memory import make_fingerprint

logger = logging.getLogger("bughunter.bug_dedupe")


def dedupe_bugs(bugs: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Remove duplicates by fingerprint (title + page_url).
    Preserves first occurrence order.
    """
    if not bugs:
        return [], {"before": 0, "after": 0, "removed": 0}

    seen: set[str] = set()
    merged: List[Dict[str, Any]] = []
    for b in bugs:
        title = (b.get("title") or "").strip()
        page = (b.get("page_url") or "").strip()
        fp = make_fingerprint(title, page)
        if fp in seen:
            continue
        seen.add(fp)
        merged.append(b)

    stats = {
        "before": len(bugs),
        "after": len(merged),
        "removed": len(bugs) - len(merged),
    }
    if stats["removed"]:
        logger.info(f"Deduped bugs: {stats['before']} → {stats['after']} (removed {stats['removed']})")
    return merged, stats
