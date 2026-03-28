"""
BugHunter.AI - Agent Entry Point
Loads environment variables, starts the Flask API server in a background
thread, then runs the Redis job worker loop.
"""

import logging
import os
import threading
import time
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("bughunter.main")


def _start_api_server():
    """Start the Flask API server (runs forever in a daemon thread)."""
    from api_server import start
    port = int(os.environ.get("AGENT_FLASK_PORT", "5001"))
    start(port)


def main():
    from worker.runner import JobRunner

    logger.info("🐛 BugHunter.AI agent starting…")

    # Start the Flask API server in a background daemon thread
    api_thread = threading.Thread(target=_start_api_server, daemon=True, name="api-server")
    api_thread.start()
    logger.info("Agent API server thread started")

    runner = JobRunner()
    logger.info("Worker listening for jobs on bughunter:jobs …")

    while True:
        try:
            runner.poll()
        except KeyboardInterrupt:
            logger.info("Shutting down worker…")
            break
        except Exception as exc:
            logger.error(f"Worker error: {exc}", exc_info=True)
            time.sleep(5)  # back-off before retry


if __name__ == "__main__":
    main()
