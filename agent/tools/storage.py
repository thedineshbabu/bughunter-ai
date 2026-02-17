"""
BugHunter.AI - Storage Tool
Database persistence helpers using psycopg2.
"""

import json
import logging
import os
from typing import Any, Dict, List

import psycopg2
import psycopg2.extras

logger = logging.getLogger("bughunter.storage")


def _get_connection():
    """Create a new PostgreSQL connection."""
    url = os.environ["DATABASE_URL"]
    return psycopg2.connect(url)


def save_run_to_db(run_id: str, status: str, results: Dict[str, Any]) -> bool:
    """
    Update a test_run record with its final status and summary.

    Args:
        run_id: UUID of the test run
        status: Final status string (completed|failed)
        results: Full agent state dict including report, bugs_found, etc.

    Returns:
        True on success, False on failure
    """
    try:
        conn = _get_connection()
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

        # Insert structured bug reports
        report = results.get("report", [])
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
        conn.close()
        logger.info(f"Run {run_id} saved to DB with {len(report)} bug report(s)")
        return True

    except Exception as exc:
        logger.error(f"save_run_to_db failed: {exc}", exc_info=True)
        return False


def update_bug(bug_data: Dict[str, Any]) -> bool:
    """
    Update an existing bug_report record.

    Args:
        bug_data: Dict with 'id' key + any fields to update

    Returns:
        True on success, False on failure
    """
    try:
        bug_id = bug_data.get("id")
        if not bug_id:
            raise ValueError("bug_data must contain 'id'")

        conn = _get_connection()
        cur = conn.cursor()

        cur.execute(
            """
            UPDATE bug_reports
            SET title = COALESCE(%s, title),
                description = COALESCE(%s, description),
                severity = COALESCE(%s, severity),
                status = COALESCE(%s, status),
                screenshot_url = COALESCE(%s, screenshot_url)
            WHERE id = %s
            """,
            (
                bug_data.get("title"),
                bug_data.get("description"),
                bug_data.get("severity"),
                bug_data.get("status"),
                bug_data.get("screenshot_url"),
                bug_id,
            ),
        )

        conn.commit()
        cur.close()
        conn.close()
        logger.info(f"Bug {bug_id} updated in DB")
        return True

    except Exception as exc:
        logger.error(f"update_bug failed: {exc}", exc_info=True)
        return False
