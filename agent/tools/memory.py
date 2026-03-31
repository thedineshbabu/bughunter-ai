"""
BugHunter.AI - Memory & Skills Service
Per-app persistent memory stored in PostgreSQL, plus agent skills for self-improvement.

Loads before each run, updated after each successful run.
All functions are safe on first run (no row yet → returns {}).
"""

import copy
import hashlib
import json
import logging
from collections import defaultdict
from typing import Any, Dict, List
from urllib.parse import urlparse

import psycopg2.extras

from tools.storage import _get_conn  # reuse the existing connection pool

logger = logging.getLogger("bughunter.memory")


# ---------------------------------------------------------------------------
# App Memory (JSONB blob per app — from app_memory table)
# ---------------------------------------------------------------------------


def load_memory(app_id: str) -> dict:
    """Load the memory blob for an app. Returns {} on first run or any error."""
    try:
        with _get_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT data FROM app_memory WHERE app_id = %s", (app_id,))
            row = cur.fetchone()
            cur.close()
            return row[0] if row else {}
    except Exception as exc:
        logger.error(f"load_memory failed for app {app_id}: {exc}")
        return {}


def save_memory(app_id: str, memory: dict) -> bool:
    """
    Upsert the memory blob for an app.
    Creates the row on first run, updates it on subsequent runs.
    Returns True on success, False on failure (non-fatal).
    """
    try:
        with _get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO app_memory (app_id, data)
                VALUES (%s, %s)
                ON CONFLICT (app_id) DO UPDATE
                  SET data = EXCLUDED.data,
                      updated_at = NOW()
                """,
                (app_id, json.dumps(memory)),
            )
            conn.commit()
            cur.close()
        logger.info(f"Memory saved for app {app_id}")
        return True
    except Exception as exc:
        logger.error(f"save_memory failed for app {app_id}: {exc}")
        return False


def make_fingerprint(title: str, page_url: str) -> str:
    """
    Stable bug identity: SHA-256 of (title + page_url), both normalised.
    Used to detect the same bug across multiple runs (regression detection).
    """
    normalised = (title.lower().strip() + page_url.lower().strip()).encode()
    return hashlib.sha256(normalised).hexdigest()


def build_page_priority_list(memory: dict, base_url: str) -> List[str]:
    """
    Return bug-prone page URLs from memory sorted descending by priority_score,
    filtered to the same origin as base_url.

    Called by ExplorerAgent to visit historically buggy pages first.
    """
    try:
        base_origin = _origin(base_url)
        pages = memory.get("pages", {})
        same_origin = [
            (url, info)
            for url, info in pages.items()
            if _origin(url) == base_origin and info.get("bug_count", 0) > 0
        ]
        same_origin.sort(key=lambda kv: kv[1].get("priority_score", 0), reverse=True)
        return [url for url, _ in same_origin]
    except Exception as exc:
        logger.debug(f"build_page_priority_list error: {exc}")
        return []


def extract_memory_updates(state: Dict[str, Any], existing_memory: dict) -> dict:
    """
    Pure function — no DB calls.
    Takes a completed AgentState and the memory loaded at run start.
    Returns the new memory dict that should be saved.

    Handles:
    1. Login steps from a successful smart login
    2. Page priority scores from bugs found
    3. Known-bug deduplication via fingerprints
    4. Run metadata (total_runs, last_run_id)
    """
    memory = copy.deepcopy(existing_memory) if existing_memory else {}
    run_id = state.get("run_id", "")
    report: List[Dict] = state.get("report") or []

    # ------------------------------------------------------------------
    # 1. Login steps
    # ------------------------------------------------------------------
    login_steps = state.get("login_steps_for_memory")
    if login_steps:
        memory["login"] = {
            "working_steps": login_steps,
            "last_success_run_id": run_id,
            "failure_count": 0,
        }
    elif memory.get("login", {}).get("working_steps"):
        had_smart_fallback = any(
            s.get("action") == "smart_login_completed"
            for s in (state.get("test_steps") or [])
        )
        if had_smart_fallback:
            memory["login"]["failure_count"] = memory["login"].get("failure_count", 0) + 1

    # ------------------------------------------------------------------
    # 2. Page priority scores
    # ------------------------------------------------------------------
    pages: dict = memory.setdefault("pages", {})
    for bug in report:
        page_url = (bug.get("page_url") or "").strip()
        if not page_url:
            continue
        if page_url not in pages:
            pages[page_url] = {"bug_count": 0, "priority_score": 0, "last_visited_run_id": run_id}
        pages[page_url]["bug_count"] = pages[page_url].get("bug_count", 0) + 1
        pages[page_url]["last_visited_run_id"] = run_id
        pages[page_url]["priority_score"] = pages[page_url]["bug_count"]

    # ------------------------------------------------------------------
    # 3. Known bugs (dedup by fingerprint)
    # ------------------------------------------------------------------
    known_bugs: list = memory.setdefault("known_bugs", [])
    fp_to_idx = {b["fingerprint"]: i for i, b in enumerate(known_bugs)}

    for bug in report:
        fp = make_fingerprint(bug.get("title", ""), bug.get("page_url", ""))
        if fp in fp_to_idx:
            idx = fp_to_idx[fp]
            known_bugs[idx]["last_seen_run_id"] = run_id
            known_bugs[idx]["occurrence_count"] = known_bugs[idx].get("occurrence_count", 1) + 1
        else:
            entry = {
                "fingerprint": fp,
                "title": bug.get("title", ""),
                "page_url": bug.get("page_url", ""),
                "severity": bug.get("severity", "medium"),
                "type": bug.get("type", "functional"),
                "first_seen_run_id": run_id,
                "last_seen_run_id": run_id,
                "occurrence_count": 1,
            }
            fp_to_idx[fp] = len(known_bugs)
            known_bugs.append(entry)

    # Cap at 100 entries; evict those with the oldest last_seen_run_id
    if len(known_bugs) > 100:
        known_bugs.sort(key=lambda b: b.get("last_seen_run_id", ""), reverse=False)
        memory["known_bugs"] = known_bugs[-100:]

    # ------------------------------------------------------------------
    # 4. Run metadata
    # ------------------------------------------------------------------
    memory["total_runs"] = memory.get("total_runs", 0) + 1
    memory["last_run_id"] = run_id

    return memory


# ---------------------------------------------------------------------------
# Agent Skills (from agent_skills table — persistent learned patterns)
# ---------------------------------------------------------------------------


def load_agent_skills(app_id: str, agent_type: str = "all", limit: int = 10) -> List[Dict[str, Any]]:
    """Load relevant skills for an agent. Combines app-specific + global skills."""
    try:
        with _get_conn() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            if agent_type == "all":
                cur.execute(
                    """
                    SELECT agent_type, skill_type, description, skill_data, confidence
                    FROM agent_skills
                    WHERE app_id = %s OR app_id IS NULL
                    ORDER BY confidence DESC, times_effective DESC
                    LIMIT %s
                    """,
                    (app_id, limit),
                )
            else:
                cur.execute(
                    """
                    SELECT agent_type, skill_type, description, skill_data, confidence
                    FROM agent_skills
                    WHERE (app_id = %s OR app_id IS NULL) AND agent_type = %s
                    ORDER BY confidence DESC, times_effective DESC
                    LIMIT %s
                    """,
                    (app_id, agent_type, limit),
                )
            rows = cur.fetchall()
            cur.close()
            return [dict(r) for r in rows]
    except Exception as exc:
        logger.error(f"load_agent_skills failed: {exc}")
        return []


def extract_and_save_skills(run_id: str, app_id: str, final_state: Dict[str, Any]) -> None:
    """After a run, extract new skills or reinforce existing ones."""
    try:
        bugs = final_state.get("bugs_found", [])

        # Track page_url → bug_type patterns
        page_patterns: Dict[str, set] = defaultdict(set)
        for bug in bugs:
            page_patterns[bug.get("page_url", "")].add(bug.get("type", "unknown"))

        with _get_conn() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            for page_url, bug_types in page_patterns.items():
                for bug_type in bug_types:
                    description = f"Page '{page_url}' tends to have {bug_type} bugs"

                    cur.execute(
                        """
                        SELECT id, times_used, times_effective, confidence
                        FROM agent_skills
                        WHERE app_id = %s AND skill_type = 'bug_pattern'
                          AND skill_data->>'page_url' = %s AND skill_data->>'bug_type' = %s
                        """,
                        (app_id, page_url, bug_type),
                    )
                    existing = cur.fetchone()

                    if existing:
                        new_confidence = min(1.0, existing["confidence"] + 0.1)
                        cur.execute(
                            """
                            UPDATE agent_skills
                            SET times_used = times_used + 1,
                                times_effective = times_effective + 1,
                                confidence = %s,
                                updated_at = NOW()
                            WHERE id = %s
                            """,
                            (new_confidence, existing["id"]),
                        )
                    else:
                        cur.execute(
                            """
                            INSERT INTO agent_skills (app_id, agent_type, skill_type, description, skill_data, confidence)
                            VALUES (%s, 'validator', 'bug_pattern', %s, %s, 0.5)
                            """,
                            (app_id, description, json.dumps({"page_url": page_url, "bug_type": bug_type})),
                        )

            # Save effective security payloads as skills
            for bug in bugs:
                if bug.get("type") == "security" and bug.get("payload"):
                    payload = bug["payload"]
                    sec_type = "xss" if "XSS" in bug.get("title", "") else "sqli"
                    description = f"Effective {sec_type} payload: {payload[:50]}"

                    cur.execute(
                        """
                        SELECT id FROM agent_skills
                        WHERE app_id = %s AND skill_type = 'security_payload'
                          AND skill_data->>'payload' = %s
                        """,
                        (app_id, payload),
                    )
                    if not cur.fetchone():
                        cur.execute(
                            """
                            INSERT INTO agent_skills (app_id, agent_type, skill_type, description, skill_data, confidence)
                            VALUES (%s, 'security', 'security_payload', %s, %s, 0.7)
                            """,
                            (app_id, description, json.dumps({"payload": payload, "type": sec_type})),
                        )

            conn.commit()
            cur.close()

        logger.info(f"Skills extracted for run={run_id}, app={app_id}")
    except Exception as exc:
        logger.error(f"extract_and_save_skills failed: {exc}", exc_info=True)


# ---------------------------------------------------------------------------
# Prompt formatting helpers
# ---------------------------------------------------------------------------


def format_skills_for_prompt(skills: List[Dict[str, Any]], agent_type: str = "all") -> str:
    """Format skills into a concise string for LLM prompt injection."""
    if not skills:
        return ""

    filtered = [s for s in skills if agent_type == "all" or s.get("agent_type") == agent_type]
    if not filtered:
        return ""

    lines = ["## Learned Patterns:"]
    for skill in filtered[:5]:
        conf = skill.get("confidence", 0.5)
        lines.append(f"- [{conf:.0%} confidence] {skill['description']}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _origin(url: str) -> str:
    """Return scheme://host for a URL, or the full URL if parsing fails."""
    try:
        p = urlparse(url)
        return f"{p.scheme}://{p.netloc}"
    except Exception:
        return url
