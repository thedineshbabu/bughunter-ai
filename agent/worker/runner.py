"""
BugHunter.AI - Job Runner
Redis-backed job consumer. Polls bughunter:jobs, runs the LangGraph pipeline,
saves results to PostgreSQL and notifies the backend via HTTP.
"""

import json
import logging
import os
import time

import httpx
import redis

from graph.graph import build_graph
from graph.state import AgentState
from tools.storage import save_run_to_db

logger = logging.getLogger("bughunter.runner")

QUEUE_KEY = "bughunter:jobs"
POLL_TIMEOUT = 5  # seconds to block-wait for a job


class JobRunner:
    """Polls Redis for test jobs and executes the LangGraph agent pipeline."""

    def __init__(self):
        redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
        self.redis = redis.from_url(redis_url, decode_responses=True)
        self.graph = build_graph()
        self._backend_url = os.environ.get("BACKEND_URL", "http://localhost:5000")
        self._agent_secret = os.environ.get("AGENT_API_SECRET", "")
        logger.info(f"JobRunner connected to Redis: {redis_url}")

    def poll(self):
        """Block-wait for one job on the queue, then process it."""
        logger.debug(f"Waiting for job on {QUEUE_KEY}...")
        result = self.redis.blpop(QUEUE_KEY, timeout=POLL_TIMEOUT)

        if result is None:
            return  # Timeout, no job available

        _, raw_job = result
        try:
            job = json.loads(raw_job)
        except json.JSONDecodeError as exc:
            logger.error(f"Failed to parse job JSON: {exc} | raw={raw_job}")
            return

        run_id = job.get("run_id")
        app_url = job.get("app_url")
        credentials = job.get("credentials")

        if not run_id or not app_url:
            logger.error(f"Invalid job payload: {job}")
            return

        logger.info(f"Processing job run_id={run_id} url={app_url}")

        # Mark run as running
        self._update_run_status(run_id, "running")

        # Build initial state
        initial_state: AgentState = {
            "url": app_url,
            "credentials": credentials,
            "current_page": None,
            "screenshots": [],
            "screenshot_paths": [],
            "bugs_found": [],
            "test_steps": [],
            "current_agent": None,
            "error": None,
            "status": "running",
            "report": None,
        }

        try:
            final_state = self.graph.invoke(initial_state)
            save_run_to_db(run_id, "completed", final_state)
            logger.info(f"Job {run_id} completed. Bugs found: {len(final_state.get('bugs_found', []))}")

        except Exception as exc:
            logger.error(f"Job {run_id} failed: {exc}", exc_info=True)
            save_run_to_db(
                run_id,
                "failed",
                {**initial_state, "error": str(exc), "bugs_found": [], "report": []},
            )

    def _update_run_status(self, run_id: str, status: str, summary: dict = None, error: str = None):
        """Notify the backend API of a run status change via HTTP PATCH."""
        if not self._agent_secret:
            logger.warning("AGENT_API_SECRET not set — skipping backend status update")
            return

        payload = {"status": status}
        if summary is not None:
            payload["summary"] = summary
        if error is not None:
            payload["error"] = error

        try:
            url = f"{self._backend_url}/api/runs/{run_id}"
            response = httpx.patch(
                url,
                json=payload,
                headers={"x-agent-secret": self._agent_secret},
                timeout=10.0,
            )
            response.raise_for_status()
        except Exception as exc:
            logger.error(f"Failed to update run status via API: {exc}")
