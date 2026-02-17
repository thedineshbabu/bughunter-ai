"""
BugHunter.AI - Agent Entry Point
Loads environment variables and starts the worker runner loop.
"""

import logging
import time
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("bughunter.main")


def main():
    from worker.runner import JobRunner

    logger.info("🐛 BugHunter.AI agent starting...")
    runner = JobRunner()

    logger.info("Worker listening for jobs on bughunter:jobs ...")
    while True:
        try:
            runner.poll()
        except KeyboardInterrupt:
            logger.info("Shutting down worker...")
            break
        except Exception as exc:
            logger.error(f"Worker error: {exc}", exc_info=True)
            time.sleep(5)  # back-off before retry


if __name__ == "__main__":
    main()
