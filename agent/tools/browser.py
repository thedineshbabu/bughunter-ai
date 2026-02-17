"""
BugHunter.AI - BrowserTool
Playwright wrapper providing a simple API for the agent pipeline.
"""

import logging
from typing import List, Optional

from playwright.sync_api import Page, sync_playwright

logger = logging.getLogger("bughunter.browser")


class BrowserTool:
    """Synchronous Playwright browser wrapper for web automation."""

    def __init__(self, headless: bool = True):
        self.headless = headless
        self._playwright = None
        self._browser = None
        self._context = None
        self.page: Optional[Page] = None
        self._console_errors: List[str] = []
        self._network_errors: List[str] = []

    def start(self):
        """Launch the browser and create a new page."""
        self._playwright = sync_playwright().start()
        self._browser = self._playwright.chromium.launch(headless=self.headless)
        self._context = self._browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="BugHunter.AI/1.0 (QA Bot)",
        )
        self.page = self._context.new_page()

        # Capture console errors
        self.page.on("console", lambda msg: self._console_errors.append(msg.text) if msg.type == "error" else None)

        # Capture failed network requests
        self.page.on(
            "requestfailed",
            lambda req: self._network_errors.append(f"{req.method} {req.url} → {req.failure}"),
        )

        logger.debug("Browser started")

    def navigate(self, url: str, wait_until: str = "networkidle"):
        """Navigate to a URL and wait for the page to load."""
        if not self.page:
            raise RuntimeError("Browser not started. Call start() first.")
        self._console_errors.clear()
        self._network_errors.clear()
        self.page.goto(url, wait_until=wait_until, timeout=30_000)
        logger.debug(f"Navigated to: {url}")

    def screenshot(self) -> bytes:
        """Take a full-page screenshot and return raw bytes."""
        if not self.page:
            raise RuntimeError("Browser not started.")
        return self.page.screenshot(full_page=True)

    def fill_form(self, selector: str, value: str):
        """Fill a form input matching the selector."""
        if not self.page:
            raise RuntimeError("Browser not started.")
        self.page.fill(selector, value, timeout=5_000)
        logger.debug(f"Filled '{selector}' with value")

    def click(self, selector: str):
        """Click the first element matching the selector."""
        if not self.page:
            raise RuntimeError("Browser not started.")
        self.page.click(selector, timeout=5_000)
        logger.debug(f"Clicked '{selector}'")

    def get_page_source(self) -> str:
        """Return the full HTML source of the current page."""
        if not self.page:
            raise RuntimeError("Browser not started.")
        return self.page.content()

    def get_current_url(self) -> str:
        """Return the current page URL."""
        return self.page.url if self.page else ""

    def get_title(self) -> str:
        """Return the current page title."""
        return self.page.title() if self.page else ""

    def get_console_errors(self) -> List[str]:
        """Return captured console error messages."""
        return list(self._console_errors)

    def get_network_errors(self) -> List[str]:
        """Return captured network failure messages."""
        return list(self._network_errors)

    def get_all_links(self) -> List[str]:
        """Return all href links on the current page."""
        if not self.page:
            return []
        try:
            return self.page.eval_on_selector_all(
                "a[href]",
                "els => els.map(el => el.href)",
            )
        except Exception:
            return []

    def get_form_inputs(self) -> List[str]:
        """Return CSS selectors for all visible text/password/email inputs."""
        if not self.page:
            return []
        try:
            return self.page.eval_on_selector_all(
                "input[type='text'], input[type='email'], input[type='password'], input[type='search'], textarea",
                "els => els.map((el, i) => el.id ? `#${el.id}` : el.name ? `[name='${el.name}']` : `input:nth-of-type(${i+1})`)",
            )
        except Exception:
            return []

    def close(self):
        """Close the browser and cleanup resources."""
        try:
            if self._context:
                self._context.close()
            if self._browser:
                self._browser.close()
            if self._playwright:
                self._playwright.stop()
        except Exception as exc:
            logger.warning(f"Error closing browser: {exc}")
        finally:
            self.page = None
            self._browser = None
            self._context = None
            self._playwright = None
            logger.debug("Browser closed")
