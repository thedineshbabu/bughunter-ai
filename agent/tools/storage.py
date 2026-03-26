"""
BugHunter.AI - Storage Tool
Database persistence helpers using a psycopg2 ThreadedConnectionPool.
"""

import json
import logging
import os
from contextlib import contextmanager
from typing import Any, Dict

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

            summary = {
                "total_bugs": len(results.get("bugs_found", [])),
                "pages_explored": len(set(
                    s.get("url", "") for s in results.get("test_steps", []) if s.get("url")
                )),
                "screenshots_taken": len(results.get("screenshots", [])),
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
