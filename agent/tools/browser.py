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

    def navigate(self, url: str, wait_until: str = "domcontentloaded"):
        """Navigate to a URL and wait for the page to load."""
        if not self.page:
            raise RuntimeError("Browser not started. Call start() first.")
        self._console_errors.clear()
        self._network_errors.clear()
        self.page.goto(url, wait_until=wait_until, timeout=60_000)
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

    def click(self, selector: str, force: bool = False):
        """Click the first element matching the selector.

        Args:
            selector: CSS selector for the target element.
            force: If True, bypass actionability checks (useful when overlays
                   intercept pointer events despite dismiss attempts).
        """
        if not self.page:
            raise RuntimeError("Browser not started.")
        self.page.click(selector, timeout=5_000, force=force)
        logger.debug(f"Clicked '{selector}' (force={force})")

    def dismiss_overlays(self):
        """Try to dismiss common overlays: cookie consent banners, modals, etc.

        Runs a series of heuristics to close elements that often block
        interaction with the underlying page.
        """
        if not self.page:
            return

        # Common selectors for cookie-consent / privacy banners and generic modals.
        # Order: most specific first, then generic patterns.
        dismiss_selectors = [
            # OneTrust / cookie-consent bars
            "#onetrust-accept-btn-handler",
            "#consent_blackbar button",
            "#consent_blackbar a",
            "[id*='consent'] button[id*='accept']",
            "[id*='consent'] button",
            "[class*='consent'] button[class*='accept']",
            "[class*='consent'] button",
            # CookieBot / generic cookie banners
            "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
            "[id*='cookie'] button[id*='accept']",
            "[id*='cookie'] button",
            "[class*='cookie'] button[class*='accept']",
            "[class*='cookie'] button",
            # Generic dismiss / close patterns
            "button[class*='dismiss']",
            "button[class*='close-banner']",
            "button[aria-label='Close']",
            "button[aria-label='Dismiss']",
            "[class*='overlay'] button[class*='close']",
            "[class*='modal'] button[class*='close']",
        ]

        dismissed = []
        for sel in dismiss_selectors:
            try:
                element = self.page.query_selector(sel)
                if element and element.is_visible():
                    element.click(force=True)
                    dismissed.append(sel)
                    # Small pause so the banner animates away
                    self.page.wait_for_timeout(500)
            except Exception:
                continue

        # Fallback: remove blocking containers via JS.
        # Handles elements with static IDs, dynamic IDs, and class-based overlays
        # (e.g. TrustArc iframes whose IDs are generated at runtime).
        removed = self.page.evaluate("""() => {
            const removed = [];

            // 1. Remove by exact ID
            const ids = [
                'consent_blackbar', 'onetrust-banner-sdk',
                'CybotCookiebotDialog', 'truste-consent-track',
                'trustarc-banner-overlay',
            ];
            for (const id of ids) {
                const el = document.getElementById(id);
                if (el) { el.remove(); removed.push('#' + id); }
            }

            // 2. Remove TrustArc overlay divs and iframes (dynamic IDs)
            document.querySelectorAll(
                '.truste_box_overlay, .truste_popframe, .truste_overlay, ' +
                '[id^="pop-div"], [id^="pop-frame"], ' +
                'iframe[name="trustarc_cm"]'
            ).forEach(el => {
                const desc = el.id || el.className || el.tagName;
                el.remove();
                removed.push(desc);
            });

            // 3. Remove any remaining full-screen overlays that block pointer events
            document.querySelectorAll(
                '[class*="overlay"], [class*="Overlay"]'
            ).forEach(el => {
                const style = window.getComputedStyle(el);
                const isFullScreen = (
                    style.position === 'fixed' &&
                    parseInt(style.zIndex || 0) > 100
                );
                if (isFullScreen) {
                    const desc = el.id || el.className || el.tagName;
                    el.remove();
                    removed.push(desc);
                }
            });

            return removed;
        }""")

        if dismissed or removed:
            logger.info(
                f"Dismissed overlays — clicked: {dismissed}, "
                f"removed via JS: {removed}"
            )
        else:
            logger.debug("No overlays found to dismiss")

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

    def wait_for_navigation(self, timeout: int = 15_000):
        """Wait for a navigation/redirect to complete (e.g. SSO/IDP redirect)."""
        if not self.page:
            raise RuntimeError("Browser not started.")
        self.page.wait_for_load_state("domcontentloaded", timeout=timeout)
        logger.debug(f"Navigation completed, now at: {self.page.url}")

    def wait_for_selector(self, selector: str, timeout: int = 15_000):
        """Wait for an element matching the selector to appear in the DOM."""
        if not self.page:
            raise RuntimeError("Browser not started.")
        self.page.wait_for_selector(selector, timeout=timeout)
        logger.debug(f"Selector '{selector}' found on page")

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
