"""
BugHunter.AI - Memory & Skills Service
Loads historical context and learned patterns for agent self-improvement.
"""

import json
import logging
from collections import defaultdict
from typing import Any, Dict, List, Optional

import psycopg2.extras

from tools.storage import _get_conn

logger = logging.getLogger("bughunter.memory")


# ---------------------------------------------------------------------------
# Lookup helpers
# ---------------------------------------------------------------------------

def get_app_id_for_run(run_id: str) -> Optional[str]:
    """Query test_runs to get app_id for a given run_id."""
    try:
        with _get_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT app_id FROM test_runs WHERE id = %s", (run_id,))
            row = cur.fetchone()
            cur.close()
            return str(row[0]) if row else None
    except Exception as exc:
        logger.error(f"get_app_id_for_run failed: {exc}")
        return None


def get_previous_bugs_for_app(app_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Fetch bug reports from previous runs for the same app."""
    try:
        with _get_conn() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(
                """
                SELECT id, run_id, title, description, severity, status, page_url
                FROM bug_reports
                WHERE app_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (app_id, limit),
            )
            rows = cur.fetchall()
            cur.close()
            return [dict(r) for r in rows]
    except Exception as exc:
        logger.error(f"get_previous_bugs_for_app failed: {exc}")
        return []


# ---------------------------------------------------------------------------
# Memory loading
# ---------------------------------------------------------------------------

def load_app_memory(app_id: str, limit: int = 5) -> Dict[str, Any]:
    """Load and merge recent memory entries for an app into a single context dict."""
    try:
        with _get_conn() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(
                """
                SELECT buggy_pages, effective_strategies, navigation_map,
                       security_findings, run_summary
                FROM agent_memory
                WHERE app_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (app_id, limit),
            )
            rows = cur.fetchall()
            cur.close()
    except Exception as exc:
        logger.error(f"load_app_memory failed: {exc}")
        return {}

    if not rows:
        return {}

    # Merge across recent runs
    all_buggy_pages: Dict[str, Dict] = {}
    all_strategies: List[Dict] = []
    all_security: List[Dict] = []
    run_summaries: List[str] = []

    for row in rows:
        # Buggy pages — aggregate by URL
        for page in (row.get("buggy_pages") or []):
            url = page.get("url", "")
            if url in all_buggy_pages:
                all_buggy_pages[url]["bug_count"] += page.get("bug_count", 0)
                all_buggy_pages[url]["bug_types"] = list(
                    set(all_buggy_pages[url]["bug_types"]) | set(page.get("bug_types", []))
                )
            else:
                all_buggy_pages[url] = {
                    "url": url,
                    "bug_count": page.get("bug_count", 0),
                    "bug_types": page.get("bug_types", []),
                    "severities": page.get("severities", []),
                }

        all_strategies.extend(row.get("effective_strategies") or [])
        all_security.extend(row.get("security_findings") or [])

        if row.get("run_summary"):
            run_summaries.append(row["run_summary"])

    # Sort buggy pages by bug count descending
    sorted_pages = sorted(all_buggy_pages.values(), key=lambda p: p["bug_count"], reverse=True)

    return {
        "all_buggy_pages": sorted_pages[:10],
        "past_strategies": all_strategies[:10],
        "security_findings": all_security[:10],
        "run_summaries": run_summaries[:5],
        "previous_bugs": get_previous_bugs_for_app(app_id, limit=30),
    }


# ---------------------------------------------------------------------------
# Skills loading
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


# ---------------------------------------------------------------------------
# Memory saving (post-run)
# ---------------------------------------------------------------------------

def save_run_memory(run_id: str, app_id: str, final_state: Dict[str, Any]) -> None:
    """Extract and save memory from a completed run."""
    try:
        bugs = final_state.get("bugs_found", [])
        test_steps = final_state.get("test_steps", [])
        report = final_state.get("report", [])

        # Build buggy_pages grouped by page_url
        page_bugs: Dict[str, Dict] = defaultdict(lambda: {"bug_count": 0, "bug_types": set(), "severities": set()})
        for bug in bugs:
            url = bug.get("page_url", "unknown")
            page_bugs[url]["bug_count"] += 1
            page_bugs[url]["bug_types"].add(bug.get("type", "unknown"))
            page_bugs[url]["severities"].add(bug.get("severity", "medium"))

        buggy_pages = [
            {"url": url, "bug_count": d["bug_count"], "bug_types": list(d["bug_types"]), "severities": list(d["severities"])}
            for url, d in page_bugs.items()
        ]

        # Build navigation_map
        visited_urls = list({s.get("url") for s in test_steps if s.get("url")})
        login_success = any(s.get("action") == "login_flow_completed" for s in test_steps)
        navigation_map = {
            "visited_urls": visited_urls,
            "login_success": login_success,
            "pages_explored": len(visited_urls),
        }

        # Build security_findings
        security_findings = []
        for bug in bugs:
            if bug.get("type") == "security":
                security_findings.append({
                    "type": "xss" if "XSS" in bug.get("title", "") else "sqli" if "SQL" in bug.get("title", "") else "secret",
                    "payload": bug.get("payload", ""),
                    "selector": bug.get("selector", ""),
                    "effective": True,
                    "page_url": bug.get("page_url", ""),
                })

        # Build run summary
        run_summary = _generate_run_summary(final_state)

        with _get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO agent_memory (app_id, run_id, buggy_pages, effective_strategies,
                                          navigation_map, security_findings, run_summary)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    app_id,
                    run_id,
                    json.dumps(buggy_pages),
                    json.dumps([]),  # strategies populated by skill extraction
                    json.dumps(navigation_map),
                    json.dumps(security_findings),
                    run_summary,
                ),
            )
            conn.commit()
            cur.close()

        logger.info(f"Saved run memory for run={run_id}, app={app_id}")
    except Exception as exc:
        logger.error(f"save_run_memory failed: {exc}", exc_info=True)


def _generate_run_summary(final_state: Dict[str, Any]) -> str:
    """Generate a concise run summary from final state."""
    bugs = final_state.get("bugs_found", [])
    steps = final_state.get("test_steps", [])
    pages = len({s.get("url") for s in steps if s.get("url")})

    bug_types = defaultdict(int)
    severities = defaultdict(int)
    for bug in bugs:
        bug_types[bug.get("type", "unknown")] += 1
        severities[bug.get("severity", "medium")] += 1

    type_str = ", ".join(f"{count} {t}" for t, count in bug_types.items()) if bug_types else "none"
    sev_str = ", ".join(f"{count} {s}" for s, count in severities.items()) if severities else "none"

    return (
        f"Explored {pages} page(s), found {len(bugs)} bug(s). "
        f"Bug types: {type_str}. Severities: {sev_str}."
    )


# ---------------------------------------------------------------------------
# Skills extraction (post-run)
# ---------------------------------------------------------------------------

def extract_and_save_skills(run_id: str, app_id: str, final_state: Dict[str, Any], memory: Dict[str, Any]) -> None:
    """After a run, extract new skills or reinforce existing ones."""
    try:
        bugs = final_state.get("bugs_found", [])
        previous_bugs = memory.get("previous_bugs", [])

        # Track page_url → bug_type patterns
        page_patterns: Dict[str, set] = defaultdict(set)
        for bug in bugs:
            page_patterns[bug.get("page_url", "")].add(bug.get("type", "unknown"))

        with _get_conn() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            # For each bug pattern, check if a matching skill exists
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

def format_memory_for_prompt(memory: Dict[str, Any], max_items: int = 5) -> str:
    """Format memory into a concise string for LLM prompt injection."""
    if not memory:
        return ""

    sections = []

    run_summaries = memory.get("run_summaries", [])
    if run_summaries:
        sections.append("## Previous Run History (same app):")
        for s in run_summaries[:3]:
            sections.append(f"- {s}")

    buggy_pages = memory.get("all_buggy_pages", [])
    if buggy_pages:
        sections.append("\n## Previously Buggy Pages:")
        for p in buggy_pages[:max_items]:
            types = ", ".join(p.get("bug_types", []))
            sections.append(f"- {p['url']}: {p['bug_count']} bug(s) ({types})")

    security = memory.get("security_findings", [])
    if security:
        sections.append("\n## Past Security Findings:")
        for f in security[:max_items]:
            sections.append(f"- {f.get('type', 'unknown')} on {f.get('page_url', '?')}")

    return "\n".join(sections) if sections else ""


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
