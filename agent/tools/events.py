"""
BugHunter.AI - Event Publisher
Publishes progress events to Redis Pub/Sub so the backend can stream them
to the frontend via SSE. All calls are best-effort and never raise exceptions.
"""

import json
import logging
import os

import redis as redis_lib

logger = logging.getLogger("bughunter.events")

_redis = None


def _get_redis():
    global _redis
    if _redis is None:
        redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
        _redis = redis_lib.from_url(redis_url, decode_responses=True)
    return _redis


def publish_event(run_id: str, event_type: str, data: dict):
    """Publish a progress event to the run's Redis channel.

    Channel: bughunter:run:{run_id}:progress
    Payload: JSON object with 'type' and arbitrary extra fields.
    """
    if not run_id:
        return
    try:
        channel = f"bughunter:run:{run_id}:progress"
        payload = json.dumps({"type": event_type, **data})
        _get_redis().publish(channel, payload)
    except Exception as exc:
        logger.debug(f"Failed to publish event '{event_type}' for run {run_id}: {exc}")
