"""
BugHunter.AI - Screenshot Tool
Captures screenshots and optionally uploads them to AWS S3.
"""

import base64
import io
import logging
import os
import time
from typing import Any, Dict, Optional

logger = logging.getLogger("bughunter.screenshot")

SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), "..", "screenshots")


def capture(page, label: str) -> Dict[str, Any]:
    """
    Take a screenshot of the given Playwright page.

    Args:
        page: Playwright Page object
        label: Descriptive label for this screenshot

    Returns:
        dict with keys: label, base64, url (current page URL), timestamp, local_path
    """
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

    timestamp = int(time.time())
    filename = f"{label}_{timestamp}.png"
    local_path = os.path.join(SCREENSHOTS_DIR, filename)

    raw_bytes = page.screenshot(full_page=True)
    encoded = base64.b64encode(raw_bytes).decode("utf-8")

    with open(local_path, "wb") as f:
        f.write(raw_bytes)

    logger.debug(f"Screenshot captured: {local_path}")

    return {
        "label": label,
        "base64": encoded,
        "url": page.url,
        "timestamp": timestamp,
        "local_path": local_path,
        "screenshot_url": None,  # Will be populated after S3 upload
    }


def upload_to_s3(image_data: Dict[str, Any], run_id: str, label: str) -> Optional[str]:
    """
    Upload a screenshot to AWS S3.

    Args:
        image_data: dict from capture() containing 'base64' key
        run_id: The test run UUID (used for S3 key prefix)
        label: Label for the screenshot

    Returns:
        S3 public URL or None on failure
    """
    try:
        import boto3

        bucket = os.environ.get("S3_BUCKET", "bughunter-screenshots")
        region = os.environ.get("S3_REGION", "us-east-1")

        s3 = boto3.client("s3", region_name=region)

        key = f"runs/{run_id}/{label}_{int(time.time())}.png"
        raw_bytes = base64.b64decode(image_data["base64"])

        s3.upload_fileobj(
            io.BytesIO(raw_bytes),
            bucket,
            key,
            ExtraArgs={"ContentType": "image/png"},
        )

        url = f"https://{bucket}.s3.{region}.amazonaws.com/{key}"
        logger.info(f"Screenshot uploaded to S3: {url}")
        return url

    except Exception as exc:
        logger.error(f"S3 upload failed: {exc}")
        return None
