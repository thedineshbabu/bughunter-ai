"""
BugHunter.AI - Run Control
Redis-backed signals for stopping and pausing active test runs.

The backend writes a signal to Redis when the user clicks Stop or Pause.
The agent reads it at each page boundary and reacts accordingly.
"""

import logging
import os
import time

import redis

logger = logging.getLogger("bughunter.control")

SIGNAL_STOP  = "stop"
SIGNAL_PAUSE = "pause"
_KEY_PREFIX  = "bughunter:control:"
_SIGNAL_TTL  = 3600  # 1-hour safety expiry so stale keys don't persist


def _redis() -> redis.Redis:
    url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    return redis.from_url(url, decode_responses=True)


def check_run_control(run_id: str) -> str | None:
    """Return the current control signal ('stop' | 'pause') for a run, or None."""
    if not run_id:
        return None
    try:
        return _redis().get(f"{_KEY_PREFIX}{run_id}")
    except Exception as exc:
        logger.debug(f"control.check failed for {run_id}: {exc}")
        return None


def clear_run_control(run_id: str) -> None:
    """Remove the control signal key once the run has finished."""
    if not run_id:
        return
    try:
        _redis().delete(f"{_KEY_PREFIX}{run_id}")
    except Exception as exc:
        logger.debug(f"control.clear failed for {run_id}: {exc}")


def wait_while_paused(run_id: str, poll_interval: float = 2.0) -> bool:
    """
    Block until the run is no longer paused.

    Returns True if a stop signal was received while waiting (caller should break),
    False if the run was resumed normally.
    """
    logger.info(f"Run {run_id} paused — waiting for resume or stop signal…")
    while True:
        signal = check_run_control(run_id)
        if signal != SIGNAL_PAUSE:
            # Either resumed (None) or stopped
            return signal == SIGNAL_STOP
        time.sleep(poll_interval)
