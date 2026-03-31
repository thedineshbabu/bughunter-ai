"""
BugHunter.AI - Job Runner
Redis-backed job consumer. Polls bughunter:jobs, runs the LangGraph pipeline,
saves results to PostgreSQL and notifies the backend via HTTP.
"""

import json
import logging
import os
import threading
import time

import httpx
import redis

from graph.graph import build_graph
from graph.state import AgentState
from tools.control import SIGNAL_STOP, check_run_control, clear_run_control
from tools.memory import (
    extract_and_save_skills,
    extract_memory_updates,
    load_agent_skills,
    load_memory,
    save_memory,
)
from tools.storage import save_run_to_db

logger = logging.getLogger("bughunter.runner")

QUEUE_KEY = "bughunter:jobs"
POLL_TIMEOUT = 5  # seconds to block-wait for a job
HEARTBEAT_INTERVAL = 30  # seconds between heartbeats
HEARTBEAT_TTL = 90  # seconds before a heartbeat is considered stale


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
        app_id = job.get("app_id")
        app_url = job.get("app_url")
        credentials = job.get("credentials")
        test_config = job.get("test_config")

        if not run_id or not app_url:
            logger.error(f"Invalid job payload: {job}")
            return

        logger.info(f"Processing job run_id={run_id} app_id={app_id} url={app_url}")

        # Load per-app memory (returns {} on first run or if no app_id)
        app_memory = load_memory(app_id) if app_id else {}
        if app_memory:
            logger.info(f"Loaded memory for app {app_id}: {app_memory.get('total_runs', 0)} prior run(s)")

        # Load agent skills from agent_skills table
        skills = load_agent_skills(app_id, "all") if app_id else []
        if skills:
            logger.info(f"Loaded {len(skills)} skill(s) for app={app_id}")

        # Mark run as running
        self._update_run_status(run_id, "running")

        # Build initial state
        initial_state: AgentState = {
            "run_id": run_id,
            "url": app_url,
            "credentials": credentials,
            "test_config": test_config,
            "current_page": None,
            "screenshots": [],
            "screenshot_paths": [],
            "bugs_found": [],
            "test_steps": [],
            "current_agent": None,
            "error": None,
            "status": "running",
            "report": None,
            "app_memory": app_memory,
            "skills": skills,
            "app_id": app_id,
            "login_steps_for_memory": None,
            "strategic_plan": None,
            "visited_urls": None,
            "dedupe_stats": None,
        }

        self._publish(run_id, "agent_start", {"agent": "orchestrator", "message": "Pipeline starting…"})

        # Start heartbeat thread for this run
        heartbeat_stop = threading.Event()
        heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop, args=(run_id, heartbeat_stop), daemon=True
        )
        heartbeat_thread.start()

        try:
            final_state = self.graph.invoke(initial_state)
            bug_count = len(final_state.get("bugs_found", []))

            # Determine final status: the stop signal may have been set mid-run
            was_stopped = check_run_control(run_id) == SIGNAL_STOP
            final_status = "cancelled" if was_stopped else "completed"
            save_run_to_db(run_id, final_status, final_state)

            if final_status == "cancelled":
                self._publish(run_id, "run_cancelled", {"message": f"Run cancelled — {bug_count} partial result(s) saved"})
                logger.info(f"Job {run_id} cancelled. Partial bugs saved: {bug_count}")
            else:
                # Persist updated memory and extract skills after a full successful run
                if app_id:
                    updated_memory = extract_memory_updates(final_state, app_memory)
                    save_memory(app_id, updated_memory)
                    extract_and_save_skills(run_id, app_id, final_state)
                self._publish(run_id, "run_complete", {"total_bugs": bug_count, "message": f"Run completed — {bug_count} bug(s) found"})
                logger.info(f"Job {run_id} completed. Bugs found: {bug_count}")

        except Exception as exc:
            logger.error(f"Job {run_id} failed: {exc}", exc_info=True)
            self._publish(run_id, "run_failed", {"error": str(exc), "message": f"Run failed: {exc}"})
            save_run_to_db(
                run_id,
                "failed",
                {**initial_state, "error": str(exc), "bugs_found": [], "report": []},
            )
        finally:
            heartbeat_stop.set()
            self._clear_heartbeat(run_id)
            clear_run_control(run_id)

    def _heartbeat_loop(self, run_id: str, stop_event: threading.Event):
        """Periodically set a Redis key to signal the run is still alive."""
        key = f"bughunter:heartbeat:{run_id}"
        while not stop_event.is_set():
            try:
                self.redis.setex(key, HEARTBEAT_TTL, int(time.time()))
            except Exception as exc:
                logger.debug(f"Heartbeat write failed for {run_id}: {exc}")
            stop_event.wait(HEARTBEAT_INTERVAL)

    def _clear_heartbeat(self, run_id: str):
        """Remove the heartbeat key when a run finishes."""
        try:
            self.redis.delete(f"bughunter:heartbeat:{run_id}")
        except Exception:
            pass

    def _publish(self, run_id: str, event_type: str, data: dict):
        """Publish a pipeline progress event to Redis Pub/Sub."""
        try:
            from tools.events import publish_event
            publish_event(run_id, event_type, data)
        except Exception as exc:
            logger.debug(f"Event publish failed: {exc}")

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
