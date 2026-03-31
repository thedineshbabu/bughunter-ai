"""
BugHunter.AI - BrowserTool
Playwright wrapper providing a simple API for the agent pipeline.
"""

import logging
import time
from typing import List, Optional

from playwright.sync_api import Page, sync_playwright

logger = logging.getLogger("bughunter.browser")

# Consent/analytics CDN domains to block by default.
# These are never needed for QA testing and their absence prevents banners from loading.
DEFAULT_BLOCKED_DOMAINS: List[str] = [
    "trustarc.com",
    "truste.com",
    "cookielaw.org",      # OneTrust CDN
    "onetrust.com",
    "cookiebot.com",
    "usercentrics.com",
    "quantcast.com",
    "consent.cookiefirst.com",
    "cdn.privacy-mgmt.com",
]


class BrowserTool:
    """Synchronous Playwright browser wrapper for web automation."""

    def __init__(
        self,
        headless: bool = True,
        extra_blocked_domains: List[str] = None,
        allowed_domains: List[str] = None,
    ):
        self.headless = headless
        self._extra_blocked_domains: List[str] = extra_blocked_domains or []
        self._allowed_domains: List[str] = allowed_domains or []
        self._playwright = None
        self._browser = None
        self._context = None
        self.page: Optional[Page] = None
        self._console_errors: List[str] = []
        self._network_errors: List[str] = []
        self._api_responses: List[dict] = []
        self._intentionally_blocked: set = set()
        self._request_start: dict = {}  # id(request) → perf_counter start time
        self._static_exts = (
            '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
            '.woff', '.woff2', '.ttf', '.otf', '.eot', '.svg', '.ico',
            '.mp4', '.webm', '.ogg', '.wav', '.map',
        )

    def start(self):
        """Launch the browser and create a new page."""
        self._playwright = sync_playwright().start()
        self._browser = self._playwright.chromium.launch(headless=self.headless)
        self._context = self._browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="BugHunter.AI/1.0 (QA Bot)",
        )

        # Block consent CDN domains so banners never load — this is the most
        # reliable way to prevent high-z-index overlays from appearing at all.
        # allowed_domains overrides the default block list (e.g. for SSO-dependent apps).
        all_blocked = [
            d for d in DEFAULT_BLOCKED_DOMAINS + self._extra_blocked_domains
            if not any(allowed in d or d in allowed for allowed in self._allowed_domains)
        ]
        if all_blocked:
            blocked_set = set(all_blocked)
            self._intentionally_blocked = blocked_set

            def _handle_route(route):
                if any(d in route.request.url for d in blocked_set):
                    logger.debug(f"Blocked consent CDN: {route.request.url}")
                    route.abort()
                else:
                    route.continue_()

            self._context.route("**/*", _handle_route)
            logger.info(
                f"Blocking {len(all_blocked)} consent/analytics domains"
                + (f" (allowed override: {self._allowed_domains})" if self._allowed_domains else "")
            )

        self.page = self._context.new_page()

        # Capture console errors
        self.page.on("console", lambda msg: self._console_errors.append(msg.text) if msg.type == "error" else None)

        # Capture failed network requests, excluding domains we intentionally blocked.
        def _on_request_failed(req):
            if self._intentionally_blocked and any(d in req.url for d in self._intentionally_blocked):
                return
            self._network_errors.append(f"{req.method} {req.url} → {req.failure}")

        self.page.on("requestfailed", _on_request_failed)

        # Track request start times via wall clock so duration is always accurate.
        # Playwright's HAR-based timing object has many "not ready yet" edge cases
        # (responseEnd is 0 or -1 when the response event fires) which cause negatives.
        def _on_request(req):
            url = req.url
            if any(url.endswith(ext) or f'{ext}?' in url for ext in self._static_exts):
                return
            if self._intentionally_blocked and any(d in url for d in self._intentionally_blocked):
                return
            self._request_start[id(req)] = time.perf_counter()

        def _on_response(resp):
            url = resp.url
            if any(url.endswith(ext) or f'{ext}?' in url for ext in self._static_exts):
                return
            if self._intentionally_blocked and any(d in url for d in self._intentionally_blocked):
                return
            try:
                start = self._request_start.pop(id(resp.request), None)
                duration_ms = round((time.perf_counter() - start) * 1000) if start is not None else 0
                self._api_responses.append({
                    "url": url,
                    "method": resp.request.method,
                    "status": resp.status,
                    "duration_ms": duration_ms,
                })
            except Exception:
                pass

        self.page.on("request", _on_request)
        self.page.on("response", _on_response)

        logger.debug("Browser started")

    def navigate(self, url: str, wait_until: str = "domcontentloaded"):
        """Navigate to a URL and wait for the page to load."""
        if not self.page:
            raise RuntimeError("Browser not started. Call start() first.")
        self._console_errors.clear()
        self._network_errors.clear()
        self._api_responses.clear()
        self._request_start.clear()
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
                'trustarc-banner-overlay', 'trustarc-consent-track',
            ];
            for (const id of ids) {
                const el = document.getElementById(id);
                if (el) { el.remove(); removed.push('#' + id); }
            }

            // 2. Remove TrustArc overlay divs and iframes (dynamic IDs)
            document.querySelectorAll(
                '.truste_box_overlay, .truste_popframe, .truste_overlay, ' +
                '[id^="pop-div"], [id^="pop-frame"], ' +
                'iframe[name="trustarc_cm"], iframe[id^="trustarc"]'
            ).forEach(el => {
                const desc = el.id || el.className || el.tagName;
                el.remove();
                removed.push(desc);
            });

            // 3. Nuclear option: remove any fixed/absolute element with extreme z-index
            // (TrustArc uses 21999998 — nothing in a legitimate app UI needs > 999999).
            // Skip elements that contain form inputs so we don't accidentally remove login modals.
            document.querySelectorAll('*').forEach(el => {
                const style = window.getComputedStyle(el);
                const z = parseInt(style.zIndex) || 0;
                if (z > 999999 &&
                    (style.position === 'fixed' || style.position === 'absolute')) {
                    if (!el.querySelector('input, textarea, select, button[type="submit"]')) {
                        const desc = (el.id || el.className || el.tagName).toString().slice(0, 60);
                        el.remove();
                        removed.push('z:' + z + ' ' + desc);
                    }
                }
            });

            // 4. Restore body scroll/pointer-events if locked by a banner
            document.body.style.overflow = '';
            document.body.style.pointerEvents = '';
            document.documentElement.style.overflow = '';

            // 5. Remove Angular CDK overlay backdrops (Angular Material)
            document.querySelectorAll('.cdk-overlay-container, .cdk-overlay-backdrop').forEach(el => {
                if (!el.querySelector('input, textarea')) {
                    const desc = el.className.slice(0, 40);
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

    def get_page_load_time(self) -> int:
        """Return page load time in ms using the Navigation Timing API. Returns 0 on error."""
        if not self.page:
            return 0
        try:
            return self.page.evaluate(
                "() => { const t = window.performance.timing; "
                "return t.loadEventEnd > 0 ? t.loadEventEnd - t.navigationStart : 0; }"
            )
        except Exception:
            return 0

    def get_api_response_times(self) -> List[dict]:
        """Return captured API response records and clear the internal list."""
        result = list(self._api_responses)
        self._api_responses.clear()
        return result

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

    def get_clickable_elements(self) -> List[dict]:
        """Return visible interactive elements (buttons, tabs, menu/nav items) with their text and selector.

        Excludes destructive actions (delete, logout, etc.) and disabled elements.
        Used by the explorer to discover page functionality beyond <a href> links.
        """
        if not self.page:
            return []
        try:
            return self.page.evaluate("""() => {
                const SKIP = /\\b(delete|remove|reset|clear|cancel|logout|sign.?out|close|dismiss|decline|reject|deactivate|archive)\\b/i;
                const seen = new Set();
                const results = [];

                const candidates = document.querySelectorAll(
                    'button:not([disabled]):not([type="submit"]):not([type="reset"]), ' +
                    '[role="button"]:not([disabled]), ' +
                    '[role="tab"], [role="menuitem"], [role="option"], ' +
                    'nav a[href], header a[href], ' +
                    '[class*="sidebar"] a[href], [class*="nav"] a[href], [class*="menu"] a[href]'
                );

                candidates.forEach(el => {
                    const rect = el.getBoundingClientRect();
                    if (!rect.width || !rect.height) return;
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden') return;

                    const text = (
                        el.innerText || el.textContent ||
                        el.getAttribute('aria-label') || el.getAttribute('title') || ''
                    ).trim().replace(/\\s+/g, ' ').slice(0, 80);

                    if (!text || SKIP.test(text) || seen.has(text)) return;
                    seen.add(text);

                    const id = el.id ? '#' + el.id : null;
                    const testId = el.getAttribute('data-testid')
                        ? '[data-testid="' + el.getAttribute('data-testid') + '"]' : null;
                    const href = el.getAttribute('href') || null;

                    results.push({
                        text,
                        selector: id || testId || null,
                        href,
                        role: el.getAttribute('role') || el.tagName.toLowerCase(),
                        tag: el.tagName.toLowerCase(),
                    });
                });

                return results.slice(0, 20);
            }""")
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

    def inspect_page_structure(self) -> dict:
        """Return structured page data ported from web-scrapper extractor.ts patterns.

        Runs DOM queries directly in the browser via page.evaluate() — no extra
        Python dependencies. Returns a dict with:
          metadata:   {title, description, headings: [{level, text}]}
          forms:      [{action, method, fields: [{name, type, label, required, placeholder}]}]
          tables:     [{headers: [...], row_count: int}]
          key_values: {label: value, ...}
        """
        if not self.page:
            return {}
        try:
            return self.page.evaluate("""() => {
                try {
                    const txt = el => (el.textContent || '').trim().replace(/\\s+/g, ' ');

                    // Headings (from extractMetadata)
                    const headings = [];
                    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(el => {
                        if (headings.length >= 10) return;
                        const text = txt(el).slice(0, 100);
                        if (text) headings.push({ level: parseInt(el.tagName[1]), text });
                    });
                    const metadata = {
                        title: document.title.trim(),
                        description: (
                            document.querySelector('meta[name="description"]')?.content ||
                            document.querySelector('meta[property="og:description"]')?.content ||
                            null
                        ),
                        headings,
                    };

                    // Forms with fields (from extractForms)
                    const forms = [];
                    document.querySelectorAll('form').forEach(formEl => {
                        if (forms.length >= 5) return;
                        const fields = [];
                        formEl.querySelectorAll('input,select,textarea').forEach(el => {
                            if (fields.length >= 15) return;
                            const name = el.name || el.id;
                            if (!name) return;
                            const type = (el.type || el.tagName).toLowerCase();
                            if (['hidden','submit','button','image','reset'].includes(type)) return;
                            let label = null;
                            if (el.id) {
                                const lbl = document.querySelector('label[for="' + el.id + '"]');
                                if (lbl) label = txt(lbl).slice(0, 80);
                            }
                            if (!label && el.previousElementSibling?.tagName === 'LABEL')
                                label = txt(el.previousElementSibling).slice(0, 80);
                            if (!label && el.closest('label')) {
                                const clone = el.closest('label').cloneNode(true);
                                clone.querySelectorAll('input,select,textarea').forEach(c => c.remove());
                                label = (clone.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80) || null;
                            }
                            fields.push({
                                name: name.slice(0, 60), type,
                                label: label || null,
                                required: el.required || el.getAttribute('aria-required') === 'true',
                                placeholder: (el.placeholder || '').slice(0, 80) || null,
                            });
                        });
                        forms.push({ action: formEl.action || null, method: (formEl.method || 'get').toLowerCase(), fields });
                    });

                    // Tables (from extractTables)
                    const tables = [];
                    document.querySelectorAll('table').forEach(tableEl => {
                        if (tables.length >= 5) return;
                        const headers = [];
                        const headerRow = tableEl.querySelector('thead tr') || tableEl.querySelector('tr');
                        if (headerRow) headerRow.querySelectorAll('th,td').forEach(c => headers.push(txt(c).slice(0, 60)));
                        const rowCount = tableEl.querySelectorAll('tbody tr').length ||
                            Math.max(0, tableEl.querySelectorAll('tr').length - 1);
                        if (headers.length > 0 || rowCount > 0) tables.push({ headers, row_count: rowCount });
                    });

                    // Key-value pairs (from extractKeyValuePairs)
                    const key_values = {};
                    let kvCount = 0;
                    document.querySelectorAll('dl').forEach(dl => {
                        let lastKey = null;
                        dl.querySelectorAll('dt,dd').forEach(el => {
                            if (kvCount >= 20) return;
                            const t = txt(el).slice(0, 80);
                            if (el.tagName === 'DT') { lastKey = t; }
                            else if (el.tagName === 'DD' && lastKey) { key_values[lastKey] = t; lastKey = null; kvCount++; }
                        });
                    });
                    document.querySelectorAll('[class*="label"],[class*="key"]').forEach(el => {
                        if (kvCount >= 20) return;
                        const key = txt(el).slice(0, 80);
                        const next = el.nextElementSibling;
                        if (key && next) { key_values[key] = txt(next).slice(0, 120); kvCount++; }
                    });

                    return { metadata, forms, tables, key_values };
                } catch(e) { return { error: e.message }; }
            }""")
        except Exception:
            return {}

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
