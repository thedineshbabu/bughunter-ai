"""Merge duplicate bug observations before structured reporting.

Uses both exact fingerprint matching AND semantic similarity to catch
bugs that describe the same issue with different wording.
"""

from __future__ import annotations

import logging
import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Tuple

from tools.memory import make_fingerprint

logger = logging.getLogger("bughunter.bug_dedupe")


def _normalize(text: str) -> str:
    """Lowercase, strip whitespace, collapse runs of whitespace."""
    return re.sub(r"\s+", " ", (text or "").lower().strip())


def _semantic_similarity(a: str, b: str) -> float:
    """Compute semantic similarity between two strings using SequenceMatcher.

    Returns a float in [0.0, 1.0]. For short QA titles this is surprisingly
    effective at catching rephrasings like:
      "Login button broken" vs "Login button not working"
    """
    na, nb = _normalize(a), _normalize(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()


def _is_duplicate(bug: dict, existing: dict, threshold: float = 0.70) -> bool:
    """Check if two bugs describe the same issue.

    Uses a combination of:
    1. Exact fingerprint match (title + page_url SHA-256)
    2. Same page_url + high title similarity
    3. Same page_url + same type + high description similarity
    """
    # Exact fingerprint match
    fp_new = make_fingerprint(
        (bug.get("title") or "").strip(),
        (bug.get("page_url") or "").strip(),
    )
    fp_existing = make_fingerprint(
        (existing.get("title") or "").strip(),
        (existing.get("page_url") or "").strip(),
    )
    if fp_new == fp_existing:
        return True

    # Same page — check title similarity
    page_a = _normalize(bug.get("page_url", ""))
    page_b = _normalize(existing.get("page_url", ""))
    if page_a and page_a == page_b:
        title_sim = _semantic_similarity(bug.get("title", ""), existing.get("title", ""))
        if title_sim >= threshold:
            return True

        # Same page + same type — check description similarity
        if bug.get("type") == existing.get("type"):
            desc_sim = _semantic_similarity(bug.get("description", ""), existing.get("description", ""))
            if desc_sim >= threshold:
                return True

    return False


def dedupe_bugs(bugs: List[Dict[str, Any]], threshold: float = 0.70) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Remove duplicates using exact fingerprints AND semantic similarity.

    Preserves first occurrence order. Merges severity (keeps highest).
    """
    if not bugs:
        return [], {"before": 0, "after": 0, "removed": 0, "semantic_removed": 0}

    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    merged: List[Dict[str, Any]] = []
    semantic_removed = 0

    for bug in bugs:
        is_dup = False
        for existing in merged:
            if _is_duplicate(bug, existing, threshold):
                is_dup = True
                # Keep the higher severity
                bug_sev = severity_order.get(bug.get("severity", "medium"), 2)
                existing_sev = severity_order.get(existing.get("severity", "medium"), 2)
                if bug_sev < existing_sev:
                    existing["severity"] = bug.get("severity", "medium")
                # Check if this was a semantic match (not exact fingerprint)
                fp_new = make_fingerprint((bug.get("title") or "").strip(), (bug.get("page_url") or "").strip())
                fp_existing = make_fingerprint((existing.get("title") or "").strip(), (existing.get("page_url") or "").strip())
                if fp_new != fp_existing:
                    semantic_removed += 1
                break
        if not is_dup:
            merged.append(bug)

    stats = {
        "before": len(bugs),
        "after": len(merged),
        "removed": len(bugs) - len(merged),
        "semantic_removed": semantic_removed,
    }
    if stats["removed"]:
        logger.info(
            f"Deduped bugs: {stats['before']} → {stats['after']} "
            f"(removed {stats['removed']}, {semantic_removed} by semantic similarity)"
        )
    return merged, stats
