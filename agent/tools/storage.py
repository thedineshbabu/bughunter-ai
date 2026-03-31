"""
BugHunter.AI - Storage Tool
Database persistence helpers using a psycopg2 ThreadedConnectionPool.
"""

import json
import logging
import os
from contextlib import contextmanager
from typing import Any, Dict

from tools.pipeline_log import build_pipeline_log

import psycopg2
import psycopg2.extras
import psycopg2.pool

logger = logging.getLogger("bughunter.storage")

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    """Return the singleton connection pool, creating it on first call."""
    global _pool
    if _pool is None:
        url = os.environ["DATABASE_URL"]
        _pool = psycopg2.pool.ThreadedConnectionPool(minconn=1, maxconn=5, dsn=url)
        logger.info("DB connection pool initialised (minconn=1, maxconn=5)")
    return _pool


@contextmanager
def _get_conn():
    """Context manager that borrows a connection from the pool and returns it on exit."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        yield conn
    finally:
        pool.putconn(conn)


def save_run_to_db(run_id: str, status: str, results: Dict[str, Any]) -> bool:
    """
    Update a test_run record with its final status and summary,
    then insert structured bug reports.

    Returns True on success, False on failure.
    """
    try:
        with _get_conn() as conn:
            cur = conn.cursor()

            screenshots = results.get("screenshots", [])
            test_steps  = results.get("test_steps", [])

            # Build a per-page record: url → first non-login-step screenshot for that page
            # Also collect login step screenshots separately (label = "login_step_N")
            page_map: dict = {}
            login_steps_by_page: dict = {}
            for shot in screenshots:
                page_url = shot.get("url", "")
                label = shot.get("label", "")
                if not page_url:
                    continue
                if label.startswith("login_step_"):
                    login_steps_by_page.setdefault(page_url, []).append({
                        "step": shot.get("login_step"),
                        "action": shot.get("login_action", ""),
                        "selector": shot.get("login_selector", ""),
                        "screenshot_file": os.path.basename(shot["local_path"]) if shot.get("local_path") else None,
                    })
                elif page_url not in page_map:
                    local_path = shot.get("local_path", "")
                    page_map[page_url] = {
                        "url": page_url,
                        "label": label,
                        "screenshot_file": os.path.basename(local_path) if local_path else None,
                    }

            # Collect per-page performance metrics from "observe" steps
            metrics_by_page: dict = {}
            for step in test_steps:
                if step.get("action") != "observe":
                    continue
                u = step.get("url", "")
                if not u:
                    continue
                metrics_by_page[u] = {
                    "load_time_ms": step.get("load_time_ms", 0) or 0,
                    "links_found": step.get("links_found", 0) or 0,
                    "api_calls": step.get("api_calls", []) or [],
                }

            # Summarise what each page had tested (from observer steps)
            steps_by_page: dict = {}
            for step in test_steps:
                url = step.get("url", "")
                action = step.get("action", "")
                if not url:
                    continue
                if url not in steps_by_page:
                    steps_by_page[url] = []
                if action in ("observe", "login_attempt", "login_flow_completed",
                              "login_flow_failed", "smart_login_completed", "smart_login_partial",
                              "smart_login_failed", "memory_login_completed", "errors_detected", "error"):
                    steps_by_page[url].append({
                        "action": action,
                        "detail": step.get("detail") or step.get("console_errors") or "",
                    })

            pages_visited = []
            for page in page_map.values():
                metrics = metrics_by_page.get(page["url"], {})
                api_calls = metrics.get("api_calls", [])
                entry = {
                    **page,
                    "steps": steps_by_page.get(page["url"], []),
                    "load_time_ms": metrics.get("load_time_ms", 0),
                    "links_found": metrics.get("links_found", 0),
                    "api_call_count": len(api_calls),
                    "api_error_count": sum(1 for c in api_calls if c.get("status", 0) >= 400),
                    "slowest_api_ms": max((c.get("duration_ms", 0) for c in api_calls), default=0),
                }
                login_steps = login_steps_by_page.get(page["url"], [])
                if login_steps:
                    entry["login_steps"] = login_steps
                pages_visited.append(entry)

            # Aggregate performance stats across all pages
            all_load_times = [p["load_time_ms"] for p in pages_visited if p.get("load_time_ms")]
            all_api_calls = [
                c for p in pages_visited
                for c in metrics_by_page.get(p["url"], {}).get("api_calls", [])
            ]
            avg_load_ms = round(sum(all_load_times) / len(all_load_times)) if all_load_times else 0
            total_links = sum(p.get("links_found", 0) for p in pages_visited)
            total_api = len(all_api_calls)
            api_errors = sum(1 for c in all_api_calls if c.get("status", 0) >= 400)
            slow_apis = [c for c in all_api_calls if c.get("duration_ms", 0) > 2000]

            improvement_suggestions = []
            if avg_load_ms > 3000:
                improvement_suggestions.append(
                    f"Average page load time is {avg_load_ms}ms — consider optimising server response times or enabling caching."
                )
            if api_errors > 0:
                improvement_suggestions.append(
                    f"{api_errors} API call(s) returned HTTP 4xx/5xx errors — review server error handling."
                )
            if slow_apis:
                slowest = max(slow_apis, key=lambda c: c.get("duration_ms", 0))
                improvement_suggestions.append(
                    f"Slowest API call: {slowest['url']} took {slowest['duration_ms']}ms — consider optimising this endpoint."
                )
            if len(pages_visited) == 1 and total_links == 0:
                improvement_suggestions.append(
                    "Only one page was explored and no same-origin links were found — ensure navigation links are present and reachable."
                )

            strategic_plan = results.get("strategic_plan")
            visited_urls = results.get("visited_urls")
            dedupe_stats = results.get("dedupe_stats")
            summary = {
                "total_bugs": len(results.get("bugs_found", [])),
                "pages_explored": len(page_map),
                "screenshots_taken": len(screenshots),
                "pages_visited": pages_visited,
                "strategic_plan": strategic_plan,
                "visited_urls": visited_urls,
                "dedupe_stats": dedupe_stats,
                "pipeline_log": build_pipeline_log(test_steps),
                "avg_load_time_ms": avg_load_ms,
                "total_links_found": total_links,
                "total_api_calls": total_api,
                "api_error_count": api_errors,
                "improvement_suggestions": improvement_suggestions,
            }

            cur.execute(
                """
                UPDATE test_runs
                SET status = %s,
                    completed_at = NOW(),
                    summary = %s,
                    error = %s
                WHERE id = %s
                """,
                (
                    status,
                    json.dumps(summary),
                    results.get("error"),
                    run_id,
                ),
            )

            report = results.get("report") or []
            for bug in report:
                cur.execute(
                    """
                    INSERT INTO bug_reports (
                        run_id, app_id, title, description,
                        steps_to_reproduce, expected_behavior, actual_behavior,
                        severity, status, screenshot_url, page_url
                    )
                    SELECT %s, app_id, %s, %s, %s, %s, %s, %s, 'open', %s, %s
                    FROM test_runs WHERE id = %s
                    """,
                    (
                        run_id,
                        bug.get("title", "Untitled Bug"),
                        bug.get("description", ""),
                        bug.get("steps_to_reproduce", ""),
                        bug.get("expected_behavior", ""),
                        bug.get("actual_behavior", ""),
                        bug.get("severity", "medium"),
                        bug.get("screenshot_url"),
                        bug.get("page_url", ""),
                        run_id,
                    ),
                )

            conn.commit()
            cur.close()

        logger.info(f"Run {run_id} saved to DB with {len(report)} bug report(s)")
        return True

    except Exception as exc:
        logger.error(f"save_run_to_db failed: {exc}", exc_info=True)
        return False
