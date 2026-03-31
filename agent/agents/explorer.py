"""
BugHunter.AI - ExplorerAgent
Uses Playwright to navigate the app, capture screenshots, and log interaction steps.

Login modes:
  A) Multi-step / SSO  — credentials.login_flow list (manual, power-user override)
  B) Smart auto-login  — credentials.username + password; LLM drives each step
                         iteratively, handling email-first pages and SSO redirects
"""

import json
import logging
import os
import re
import time
from typing import Optional
from urllib.parse import urlparse

from langchain_core.messages import HumanMessage

from graph.state import AgentState
from providers import get_llm
from tools.browser import BrowserTool
from tools.control import SIGNAL_STOP, check_run_control, wait_while_paused
from tools.events import publish_event
from tools.screenshot import capture

logger = logging.getLogger("bughunter.explorer")

MAX_PAGES = int(os.environ.get("AGENT_MAX_PAGES", "5"))  # configurable via env var


def _same_origin(a: str, b: str) -> bool:
    try:
        return urlparse(a).netloc == urlparse(b).netloc
    except Exception:
        return False


class ExplorerAgent:
    """Navigates the target web app and collects screenshots + interaction steps."""

    def __init__(self, extra_blocked_domains: list = None, allowed_domains: list = None):
        self.llm = get_llm()
        self.browser = BrowserTool(
            extra_blocked_domains=extra_blocked_domains or [],
            allowed_domains=allowed_domains or [],
        )
        self._login_done = False

    def _ask_what_to_test(
        self,
        page_title: str,
        page_url: str,
        page_structure: dict,
        instructions: str = "",
        focus_areas: str = "",
        strategic_plan: Optional[dict] = None,
    ) -> str:
        """Ask the LLM what actions to perform on the current page."""
        custom = ""
        if instructions:
            custom += f"\nUser instructions: {instructions}"
        if focus_areas:
            custom += f"\nFocus areas: {focus_areas}"

        plan_block = ""
        if strategic_plan:
            notes = (strategic_plan.get("notes") or "").strip()
            o_focus = (strategic_plan.get("focus_areas") or "").strip()
            journeys = strategic_plan.get("user_journeys") or []
            if notes:
                plan_block += f"\nOverall strategy notes: {notes[:2000]}"
            if o_focus:
                plan_block += f"\nOrchestrator focus_areas: {o_focus}"
            if journeys:
                try:
                    plan_block += f"\nPlanned user journeys: {json.dumps(journeys)[:1500]}"
                except Exception:
                    plan_block += f"\nPlanned user journeys: {str(journeys)[:1500]}"

        # Build compact structured context from page_structure dict
        ctx_parts = []
        metadata = page_structure.get("metadata") or {}
        if metadata.get("description"):
            ctx_parts.append(f"Page description: {metadata['description']}")
        if metadata.get("headings"):
            heading_lines = "\n".join(
                f"  {'#' * h['level']} {h['text']}" for h in metadata["headings"]
            )
            ctx_parts.append(f"Page sections:\n{heading_lines}")

        forms = page_structure.get("forms") or []
        if forms:
            form_parts = []
            for i, form in enumerate(forms, 1):
                field_lines = "\n".join(
                    f"    - {f['name']} ({f['type']})"
                    + (f" label={f['label']!r}" if f["label"] else "")
                    + (" [required]" if f["required"] else "")
                    + (f" placeholder={f['placeholder']!r}" if f["placeholder"] else "")
                    for f in form["fields"]
                )
                form_parts.append(
                    f"  Form {i} [{form['method'].upper()} {form['action'] or '(this page)'}]:\n"
                    + (field_lines or "    (no named fields)")
                )
            ctx_parts.append("Forms:\n" + "\n".join(form_parts))

        tables = page_structure.get("tables") or []
        if tables:
            tbl_lines = "\n".join(
                f"  Table {i+1}: columns=[{', '.join(t['headers'])}], rows={t['row_count']}"
                for i, t in enumerate(tables)
            )
            ctx_parts.append(f"Data tables:\n{tbl_lines}")

        kv = page_structure.get("key_values") or {}
        if kv:
            kv_lines = "\n".join(f"  {k}: {v}" for k, v in list(kv.items())[:10])
            ctx_parts.append(f"Key data:\n{kv_lines}")

        if page_structure.get("error"):
            ctx_parts.append(f"(Page inspection error: {page_structure['error']})")
        if not ctx_parts:
            ctx_parts.append("(No structured content detected)")

        structure_block = "\n\n".join(ctx_parts)

        prompt = f"""You are a QA automation engineer exploring a web app.

Current page: {page_url}
Page title: {page_title}{custom}{plan_block}

Page structure:
{structure_block}

List the top 3 actions to perform on this page to discover bugs.
Format: JSON array of objects with keys: action (click/fill/navigate), selector, value (optional), reason
"""
        try:
            response = self.llm.invoke([HumanMessage(content=prompt)])
            return response.content
        except Exception as exc:
            logger.error(f"Explorer LLM call failed: {exc}")
            return "[]"

    def _execute_login_flow(self, login_flow: list):
        """Execute a multi-step login flow (supports SSO/IDP redirects).

        Each step is a dict with:
          - action: "fill" | "click" | "wait_for_navigation" | "wait_for_selector" | "wait"
          - selector: CSS selector (for fill, click, wait_for_selector)
          - value: text to type (for fill)
          - timeout: ms to wait (for wait_for_navigation, wait_for_selector, wait)
        """
        for i, step in enumerate(login_flow):
            action = step.get("action")
            selector = step.get("selector", "")
            value = step.get("value", "")
            timeout = step.get("timeout", 15_000)

            logger.info(
                f"Login flow step {i + 1}/{len(login_flow)}: "
                f"{action} {selector or ''}"
            )

            # Dismiss any overlays before each step (new banners can appear
            # after navigation or after interacting with the page).
            self.browser.dismiss_overlays()

            if action == "fill":
                self.browser.wait_for_selector(selector, timeout=timeout)
                self.browser.fill_form(selector, value)

            elif action == "click":
                self.browser.wait_for_selector(selector, timeout=timeout)
                try:
                    self.browser.click(selector)
                except Exception as click_err:
                    # If the normal click is blocked by a lingering overlay,
                    # dismiss overlays again and retry with a normal click first.
                    # Only fall back to force=True as a last resort.
                    logger.warning(
                        f"Click blocked on '{selector}', dismissing overlays and retrying: "
                        f"{click_err}"
                    )
                    self.browser.dismiss_overlays()
                    time.sleep(0.5)
                    try:
                        self.browser.click(selector)
                    except Exception:
                        logger.warning(
                            f"Normal retry failed on '{selector}', using force click"
                        )
                        self.browser.click(selector, force=True)

            elif action == "wait_for_navigation":
                self.browser.wait_for_navigation(timeout=timeout)

            elif action == "wait_for_selector":
                self.browser.wait_for_selector(selector, timeout=timeout)

            elif action == "wait":
                time.sleep(timeout / 1000)

            else:
                logger.warning(f"Unknown login flow action: {action}")

            logger.debug(f"  → now at: {self.browser.get_current_url()}")

    @staticmethod
    def _is_login_page(url: str) -> bool:
        """Check if the current URL looks like a login / sign-in / auth page."""
        lower = url.lower()
        return any(kw in lower for kw in ("login", "signin", "sign-in", "auth", "sso"))

    @staticmethod
    def _format_steps_for_memory(action_history: list, email: str) -> list:
        """Convert smart-login action_history to a reusable login-flow format for memory.

        Replaces the actual email value with __EMAIL__ and ensures __PASSWORD__
        is preserved as a placeholder so credentials are never stored in plaintext.
        """
        steps = []
        for entry in action_history:
            action = entry.get("action", "")
            selector = entry.get("selector", "")
            raw_value = entry.get("raw_value", "")

            step: dict = {"action": action, "selector": selector}

            if "__PASSWORD__" in raw_value:
                step["value"] = "__PASSWORD__"
            elif raw_value and raw_value.lower() == email.lower():
                # LLM sent the actual email; replace with placeholder for safe storage
                step["value"] = "__EMAIL__"
            elif raw_value:
                step["value"] = raw_value
            # click / navigation actions have no value — omit the key

            steps.append(step)
        return steps

    def _execute_memory_login(self, steps: list, email: str, password: str):
        """Execute stored memory login steps, substituting __EMAIL__ and __PASSWORD__.

        Mirrors _execute_login_flow but substitutes placeholders at runtime so
        credentials are never persisted in plaintext.
        """
        for i, step in enumerate(steps):
            action = step.get("action")
            selector = step.get("selector", "")
            raw_value = step.get("value", "")
            value = raw_value.replace("__PASSWORD__", password).replace("__EMAIL__", email)
            timeout = step.get("timeout", 15_000)

            logger.info(f"Memory login step {i + 1}/{len(steps)}: {action} '{selector}'")
            self.browser.dismiss_overlays()

            if action == "fill":
                self.browser.wait_for_selector(selector, timeout=timeout)
                self.browser.fill_form(selector, value)
            elif action == "click":
                self.browser.wait_for_selector(selector, timeout=timeout)
                try:
                    self.browser.click(selector)
                except Exception:
                    self.browser.dismiss_overlays()
                    time.sleep(0.5)
                    try:
                        self.browser.click(selector)
                    except Exception:
                        self.browser.click(selector, force=True)
            elif action == "wait_for_navigation":
                self.browser.wait_for_navigation(timeout=timeout)
            elif action == "wait_for_selector":
                self.browser.wait_for_selector(selector, timeout=timeout)
            elif action == "wait":
                time.sleep(timeout / 1000)

            logger.debug(f"  → now at: {self.browser.get_current_url()}")

    # Keywords that signal a destructive or session-ending action — never auto-click these.
    _UNSAFE_CLICK = re.compile(
        r'\b(delete|remove|reset|clear|logout|sign.?out|close|dismiss|cancel|decline|reject|deactivate|archive)\b',
        re.I,
    )

    def _run_page_actions(self, actions_json: str, run_id: str) -> list:
        """Execute safe LLM-suggested actions (fill / click) on the current page.

        Returns a list of screenshot dicts captured after each successful action.
        Navigation actions are skipped — the main loop handles page traversal.
        Destructive-looking clicks are skipped via _UNSAFE_CLICK pattern.
        """
        shots = []
        try:
            parsed = json.loads(self._extract_json(actions_json))
            actions = parsed if isinstance(parsed, list) else []
        except Exception:
            return shots

        for act in actions[:3]:  # cap at 3 actions per page
            action = act.get("action", "")
            selector = act.get("selector", "")
            value = act.get("value", "") or ""
            reason = act.get("reason", "")

            if not selector or action == "navigate":
                continue

            try:
                if action == "fill" and value:
                    self.browser.wait_for_selector(selector, timeout=3_000)
                    self.browser.fill_form(selector, value)
                    logger.info(f"Executed fill: {selector}")

                elif action == "click":
                    label = f"{reason} {selector}"
                    if self._UNSAFE_CLICK.search(label):
                        logger.debug(f"Skipping unsafe click: {selector}")
                        continue
                    self.browser.wait_for_selector(selector, timeout=3_000)
                    self.browser.click(selector)
                    logger.info(f"Executed click: {selector}")

                else:
                    continue

                # Short wait for any JS reactions (modal open, content change, etc.)
                self.browser.page.wait_for_timeout(800)

                # Capture state after the action
                try:
                    shot = capture(self.browser.page, label=f"action_{action}_{selector[:20]}", run_id=run_id)
                    shot["action_performed"] = f"{action}: {selector}"
                    shots.append(shot)
                except Exception:
                    pass

                publish_event(run_id, "page_action", {
                    "action": action,
                    "selector": selector,
                    "message": f"Performed {action} on {selector}",
                })

            except Exception as exc:
                logger.debug(f"Action {action} on '{selector}' failed: {exc}")

        return shots

    # ── Form Fuzzing ──────────────────────────────────────────────────────────
    FUZZ_PAYLOADS = [
        ("empty", ""),
        ("long_string", "A" * 5000),
        ("special_chars", "!@#$%^&*()_+-=[]{}|;':\",./<>?`~"),
        ("unicode", "测试 émojis 🐛 Ñoño"),
        ("negative_number", "-99999"),
        ("script_tag", "<script>alert(1)</script>"),
        ("sql_quote", "' OR '1'='1"),
    ]

    def _fuzz_forms(self, page_url: str, run_id: str) -> list:
        """Test form inputs with edge-case values and record any errors."""
        bugs = []
        try:
            inputs = self.browser.get_form_inputs()
            if not inputs:
                return bugs

            # Test up to 3 inputs with up to 3 payloads each
            for selector in inputs[:3]:
                for label, payload in self.FUZZ_PAYLOADS[:3]:
                    try:
                        self.browser.fill_form(selector, payload)
                    except Exception:
                        continue

                # Try submitting after filling with edge-case data
                try:
                    self.browser.click("button[type='submit'], input[type='submit']")
                    self.browser.page.wait_for_timeout(1000)

                    # Check for errors after submission
                    console_errors = self.browser.get_console_errors()
                    source = self.browser.get_page_source().lower()

                    error_indicators = [
                        "500 internal server error", "unhandled exception",
                        "traceback", "fatal error", "uncaught typeerror",
                        "cannot read properties of", "null reference",
                    ]
                    for indicator in error_indicators:
                        if indicator in source:
                            bugs.append({
                                "type": "functional",
                                "title": f"Form crashes with edge-case input on {selector}",
                                "description": f"Submitting fuzz data to '{selector}' caused a server/client error: '{indicator}' detected in page.",
                                "page_url": page_url,
                                "severity": "high",
                            })
                            break

                    if console_errors:
                        js_errors = [e for e in console_errors if "error" in e.lower() or "uncaught" in e.lower()]
                        if js_errors:
                            bugs.append({
                                "type": "error",
                                "title": f"JS error after form submission on {selector}",
                                "description": f"Console errors after submitting edge-case data: {js_errors[0][:200]}",
                                "page_url": page_url,
                                "severity": "medium",
                            })

                    # Navigate back for next test
                    self.browser.navigate(page_url)
                    self.browser.page.wait_for_timeout(500)
                except Exception:
                    try:
                        self.browser.navigate(page_url)
                    except Exception:
                        pass
        except Exception as exc:
            logger.debug(f"Form fuzzing failed on {page_url}: {exc}")
        return bugs

    # ── Performance & Accessibility Checks ─────────────────────────────────
    def _check_performance(self, page_url: str) -> list:
        """Check page load performance metrics via Playwright."""
        bugs = []
        try:
            metrics = self.browser.page.evaluate("""
                () => {
                    const perf = performance.getEntriesByType('navigation')[0];
                    if (!perf) return null;
                    return {
                        dom_content_loaded: Math.round(perf.domContentLoadedEventEnd - perf.startTime),
                        load_complete: Math.round(perf.loadEventEnd - perf.startTime),
                        ttfb: Math.round(perf.responseStart - perf.requestStart),
                    };
                }
            """)
            if metrics:
                if metrics.get("load_complete", 0) > 5000:
                    bugs.append({
                        "type": "performance",
                        "title": "Slow page load",
                        "description": f"Page took {metrics['load_complete']}ms to fully load (threshold: 5000ms). "
                                       f"TTFB: {metrics.get('ttfb', 0)}ms, DOMContentLoaded: {metrics.get('dom_content_loaded', 0)}ms.",
                        "page_url": page_url,
                        "severity": "medium",
                    })
                if metrics.get("ttfb", 0) > 2000:
                    bugs.append({
                        "type": "performance",
                        "title": "Slow server response (TTFB)",
                        "description": f"Time to first byte is {metrics['ttfb']}ms (threshold: 2000ms). Server may be under load or unoptimized.",
                        "page_url": page_url,
                        "severity": "medium",
                    })
        except Exception as exc:
            logger.debug(f"Performance check failed on {page_url}: {exc}")
        return bugs

    def _check_accessibility(self, page_url: str) -> list:
        """Run basic accessibility checks via DOM inspection."""
        bugs = []
        try:
            a11y_issues = self.browser.page.evaluate("""
                () => {
                    const issues = [];
                    // Images without alt text
                    const imgs = document.querySelectorAll('img:not([alt])');
                    if (imgs.length > 0) {
                        issues.push({type: 'missing_alt', count: imgs.length, detail: 'Images missing alt text'});
                    }
                    // Form inputs without labels
                    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
                    let unlabeled = 0;
                    inputs.forEach(input => {
                        const id = input.id;
                        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
                        const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
                        const hasPlaceholder = input.getAttribute('placeholder');
                        if (!hasLabel && !hasAriaLabel && !hasPlaceholder) unlabeled++;
                    });
                    if (unlabeled > 0) {
                        issues.push({type: 'unlabeled_input', count: unlabeled, detail: 'Form inputs without labels or aria-labels'});
                    }
                    // Buttons without accessible names
                    const buttons = document.querySelectorAll('button');
                    let emptyButtons = 0;
                    buttons.forEach(btn => {
                        if (!btn.textContent.trim() && !btn.getAttribute('aria-label') && !btn.querySelector('img[alt]')) {
                            emptyButtons++;
                        }
                    });
                    if (emptyButtons > 0) {
                        issues.push({type: 'empty_button', count: emptyButtons, detail: 'Buttons without accessible text'});
                    }
                    // Missing lang attribute on html
                    if (!document.documentElement.getAttribute('lang')) {
                        issues.push({type: 'missing_lang', count: 1, detail: 'HTML element missing lang attribute'});
                    }
                    // Low contrast detection (basic: white text on light bg or dark on dark)
                    // Heading hierarchy check
                    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
                    let skippedLevels = 0;
                    for (let i = 1; i < headings.length; i++) {
                        const prev = parseInt(headings[i-1].tagName[1]);
                        const curr = parseInt(headings[i].tagName[1]);
                        if (curr > prev + 1) skippedLevels++;
                    }
                    if (skippedLevels > 0) {
                        issues.push({type: 'heading_skip', count: skippedLevels, detail: 'Heading levels are skipped (e.g., h1 to h3)'});
                    }
                    return issues;
                }
            """)
            for issue in (a11y_issues or []):
                severity = "medium" if issue["type"] in ("missing_alt", "unlabeled_input") else "low"
                bugs.append({
                    "type": "accessibility",
                    "title": f"Accessibility: {issue['detail']}",
                    "description": f"Found {issue['count']} instance(s) of {issue['detail']} on this page.",
                    "page_url": page_url,
                    "severity": severity,
                })
        except Exception as exc:
            logger.debug(f"Accessibility check failed on {page_url}: {exc}")
        return bugs

    @staticmethod
    def _extract_json(text: str) -> str:
        """Strip markdown fences and extract first JSON object or array from LLM output."""
        text = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("`").strip()
        for start_char, end_char in [('{', '}'), ('[', ']')]:
            idx = text.find(start_char)
            if idx != -1:
                depth = 0
                for i, ch in enumerate(text[idx:], idx):
                    if ch == start_char:
                        depth += 1
                    elif ch == end_char:
                        depth -= 1
                        if depth == 0:
                            return text[idx:i + 1]
        return text

    def _smart_login(
        self,
        email: str,
        password: str,
        run_id: str = None,
        capture_steps: bool = True,
    ) -> tuple[bool, list, list]:
        """Use the LLM iteratively to navigate any login flow (single-page, email-first, SSO).

        The password is never sent to the LLM — a placeholder is used and substituted
        locally before each browser action.

        Returns:
            (success, step_screenshots, action_history)
            step_screenshots: list of screenshot dicts when capture_steps=True
            action_history: list of {action, selector, raw_value, display_value} dicts
                            used to reconstruct the working flow for memory storage
        """
        MAX_STEPS = 12
        PASSWORD_PLACEHOLDER = "__PASSWORD__"
        action_history: list[dict] = []
        step_screenshots: list[dict] = []

        for step_num in range(MAX_STEPS):
            self.browser.dismiss_overlays()
            current_url = self.browser.get_current_url()

            # After the first step, if we've left all auth pages the login succeeded
            if step_num > 0 and not self._is_login_page(current_url):
                logger.info(f"Smart login: URL is no longer an auth page ({current_url}) — success")
                return True, step_screenshots, action_history

            source = self.browser.get_page_source()

            history_str = ""
            if action_history:
                lines = "\n".join(
                    f"  {i+1}. {a['action']} selector='{a.get('selector','')}'"
                    + (f" value='{a['display_value']}'" if a.get('display_value') else "")
                    for i, a in enumerate(action_history)
                )
                history_str = f"\n\nActions already performed (do NOT repeat these unless the page changed):\n{lines}"

            prompt = f"""You are automating login for a web app.
Current URL: {current_url}
User email: {email}
HTML (first 3000 chars):
{source[:3000]}{history_str}

Determine the single NEXT action to take to progress the login.
If login appears complete (you are past all login/auth pages), return {{"done": true}}.
Otherwise return exactly ONE action as a JSON object:
{{
  "action": "fill" | "click" | "wait_for_navigation" | "wait_for_selector",
  "selector": "<css selector>",
  "value": "<text to type — use {PASSWORD_PLACEHOLDER} for any password field>",
  "done": false
}}
Return only the JSON object, no explanation."""

            try:
                response = self.llm.invoke([HumanMessage(content=prompt)])
                step = json.loads(self._extract_json(response.content))
            except Exception as exc:
                logger.warning(f"Smart login: failed to parse LLM response at step {step_num + 1}: {exc}")
                break

            if step.get("done"):
                logger.info("Smart login: LLM signalled login complete")
                return True, step_screenshots, action_history

            action = step.get("action")
            selector = step.get("selector", "")
            value = (step.get("value") or "").replace(PASSWORD_PLACEHOLDER, password)

            logger.info(f"Smart login step {step_num + 1}/{MAX_STEPS}: {action} '{selector}'")

            try:
                if action == "fill":
                    self.browser.wait_for_selector(selector, timeout=10000)
                    self.browser.fill_form(selector, value)
                elif action == "click":
                    self.browser.wait_for_selector(selector, timeout=10000)
                    self.browser.click(selector)
                elif action == "wait_for_navigation":
                    self.browser.wait_for_navigation(timeout=15000)
                elif action == "wait_for_selector":
                    self.browser.wait_for_selector(selector, timeout=10000)
                else:
                    logger.warning(f"Smart login: unknown action '{action}', skipping")
                    continue

                # Record what was done so the next prompt doesn't repeat it.
                # raw_value preserves the LLM-provided value (with __PASSWORD__ placeholder)
                # so we can reconstruct a reusable login flow for memory storage.
                raw_value = step.get("value") or ""
                display_value = "(password)" if PASSWORD_PLACEHOLDER in raw_value else raw_value
                action_history.append({
                    "action": action,
                    "selector": selector,
                    "raw_value": raw_value,
                    "display_value": display_value,
                })

                # Capture screenshot after this step and publish event
                shot = None
                if capture_steps:
                    try:
                        shot = capture(self.browser.page, label=f"login_step_{step_num + 1}", run_id=run_id)
                        shot["login_step"] = step_num + 1
                        shot["login_action"] = action
                        shot["login_selector"] = selector
                        step_screenshots.append(shot)
                    except Exception as cap_exc:
                        logger.debug(f"Smart login: screenshot capture failed at step {step_num + 1}: {cap_exc}")

                publish_event(run_id, "login_step", {
                    "step": step_num + 1,
                    "action": action,
                    "selector": selector,
                    "screenshot_file": os.path.basename(shot["local_path"]) if shot and shot.get("local_path") else None,
                    "message": f"Login step {step_num + 1}: {action} → {selector}",
                })

            except Exception as exc:
                logger.warning(f"Smart login: step {step_num + 1} failed ({exc}), retrying after overlay dismiss")
                self.browser.dismiss_overlays()
                try:
                    if action == "click":
                        self.browser.click(selector, force=True)
                    elif action == "fill":
                        self.browser.fill_form(selector, value)
                    action_history.append({"action": action, "selector": selector, "raw_value": "", "display_value": ""})
                    publish_event(run_id, "login_step", {
                        "step": step_num + 1,
                        "action": action,
                        "selector": selector,
                        "screenshot_file": None,
                        "message": f"Login step {step_num + 1} (retry): {action} → {selector}",
                    })
                except Exception:
                    break

        logger.warning("Smart login: max steps reached without confirmed success")
        return False, step_screenshots, action_history

    def run(self, state: AgentState) -> AgentState:
        url = state["url"]
        run_id = state.get("run_id")
        credentials = state.get("credentials") or {}
        screenshots = list(state.get("screenshots", []))
        test_steps = list(state.get("test_steps", []))

        test_config = state.get("test_config") or {}
        max_pages = int(test_config.get("max_pages") or MAX_PAGES)
        instructions = test_config.get("instructions", "").strip()
        focus_areas = test_config.get("focus_areas", "").strip()
        capture_login_steps = test_config.get("screenshot_login_steps", True)

        # Use scheme+host for link filtering so post-login pages are explored
        _parsed = urlparse(url)
        base_origin = f"{_parsed.scheme}://{_parsed.netloc}"

        visited_urls = []
        pages_explored = 0
        bugs_found = list(state.get("bugs_found", []))
        app_memory = state.get("app_memory") or {}
        strategic_plan = state.get("strategic_plan") or {}
        # Bug-prone pages from prior runs — used only to sort discovered links, not to guess URLs
        memory_priority_scores = app_memory.get("pages", {})

        publish_event(run_id, "agent_start", {"agent": "explorer", "message": "Browser exploration starting…"})

        # Log credentials shape for debugging
        if credentials:
            cred_keys = list(credentials.keys()) if isinstance(credentials, dict) else type(credentials).__name__
            logger.info(f"Credentials received — keys: {cred_keys}")
        else:
            logger.info("No credentials provided for this run")

        try:
            self.browser.start()

            # Navigate to the starting URL
            self.browser.navigate(url)
            visited_urls.append(url)
            # Wait for SPA frameworks to render initial content + late-loading consent popups
            self.browser.page.wait_for_timeout(2_000)
            self.browser.dismiss_overlays()

            for _ in range(max_pages):
                # Check for stop/pause signal before processing each page
                signal = check_run_control(run_id)
                if signal == SIGNAL_STOP:
                    logger.info(f"Stop signal received — ending exploration early after {pages_explored} page(s)")
                    publish_event(run_id, "run_stopped", {"message": "Test run stopped by user"})
                    break
                elif signal is not None:  # pause
                    publish_event(run_id, "run_paused", {"message": "Test run paused — waiting for resume…"})
                    stopped_during_pause = wait_while_paused(run_id)
                    if stopped_during_pause:
                        logger.info(f"Stop signal received while paused — ending exploration")
                        publish_event(run_id, "run_stopped", {"message": "Test run stopped by user"})
                        break
                    publish_event(run_id, "run_resumed", {"message": "Test run resumed"})

                pages_explored += 1
                current_url = self.browser.get_current_url()
                page_title = self.browser.get_title()
                page_structure = self.browser.inspect_page_structure()

                # Capture screenshot
                shot = capture(self.browser.page, label=f"page_{pages_explored}", run_id=run_id)
                screenshots.append(shot)

                publish_event(run_id, "page_visited", {"url": current_url, "page": pages_explored, "title": page_title, "message": f"Exploring: {current_url}"})

                merged_focus = focus_areas
                if strategic_plan.get("focus_areas") and not merged_focus:
                    merged_focus = str(strategic_plan.get("focus_areas", "")).strip()

                # Ask the LLM what to test (guided by orchestrator strategic plan)
                actions_json = self._ask_what_to_test(
                    page_title,
                    current_url,
                    page_structure,
                    instructions,
                    merged_focus,
                    strategic_plan=strategic_plan if strategic_plan else None,
                )
                load_time_ms = self.browser.get_page_load_time()
                api_calls = self.browser.get_api_response_times()
                page_links = self.browser.get_all_links()
                same_origin_links = [lnk for lnk in page_links if lnk.startswith(base_origin)]
                interactive_elements = self.browser.get_clickable_elements()

                test_steps.append(
                    {
                        "agent": "explorer",
                        "url": current_url,
                        "action": "observe",
                        "detail": actions_json,
                        "page_structure": page_structure,
                        "screenshot_label": shot["label"],
                        "load_time_ms": load_time_ms,
                        "links_found": len(same_origin_links),
                        "api_calls": api_calls,
                        "interactive_elements": interactive_elements,
                    }
                )

                # Execute the LLM-suggested actions on this page (safe fills + clicks only)
                action_shots = self._run_page_actions(actions_json, run_id)
                if action_shots:
                    screenshots.extend(action_shots)
                    test_steps.append({
                        "agent": "explorer",
                        "url": current_url,
                        "action": "page_actions_performed",
                        "detail": f"Executed {len(action_shots)} action(s) on this page",
                    })

                # Performance checks
                perf_bugs = self._check_performance(current_url)
                if perf_bugs:
                    test_steps.append({"agent": "explorer", "url": current_url, "action": "errors_detected",
                                       "detail": f"Performance issues: {[b['title'] for b in perf_bugs]}"})
                    for b in perf_bugs:
                        bugs_found.append(b)
                        publish_event(run_id, "bug_found", {"title": b["title"], "severity": b["severity"],
                                                            "page_url": current_url, "message": f"[PERF] {b['title']}"})

                # Accessibility checks
                a11y_bugs = self._check_accessibility(current_url)
                if a11y_bugs:
                    test_steps.append({"agent": "explorer", "url": current_url, "action": "errors_detected",
                                       "detail": f"Accessibility issues: {[b['title'] for b in a11y_bugs]}"})
                    for b in a11y_bugs:
                        bugs_found.append(b)

                # Form fuzzing (edge-case input testing)
                fuzz_bugs = self._fuzz_forms(current_url, run_id)
                if fuzz_bugs:
                    test_steps.append({"agent": "explorer", "url": current_url, "action": "errors_detected",
                                       "detail": f"Form fuzzing issues: {[b['title'] for b in fuzz_bugs]}"})
                    for b in fuzz_bugs:
                        bugs_found.append(b)
                        publish_event(run_id, "bug_found", {"title": b["title"], "severity": b["severity"],
                                                            "page_url": current_url, "message": f"[FUZZ] {b['title']}"})

                # -----------------------------------------------------------
                # Login handling
                # -----------------------------------------------------------
                # Option A: Multi-step SSO/IDP login flow (user-provided)
                if (
                    credentials
                    and "login_flow" in credentials
                    and not self._login_done
                    and self._is_login_page(current_url)
                ):
                    try:
                        logger.info(
                            f"Executing {len(credentials['login_flow'])}-step "
                            f"login flow on {current_url}"
                        )
                        self._execute_login_flow(credentials["login_flow"])
                        self._login_done = True

                        test_steps.append(
                            {
                                "agent": "explorer",
                                "action": "login_flow_completed",
                                "url": current_url,
                                "detail": (
                                    f"Executed {len(credentials['login_flow'])} "
                                    f"login steps, now at {self.browser.get_current_url()}"
                                ),
                            }
                        )

                        # Capture post-login screenshot, then let the next
                        # loop iteration process the post-login page properly
                        post_shot = capture(self.browser.page, label="post_login", run_id=run_id)
                        screenshots.append(post_shot)
                        continue

                    except Exception as e:
                        logger.warning(f"Login flow failed: {e}")
                        test_steps.append(
                            {
                                "agent": "explorer",
                                "action": "login_flow_failed",
                                "url": current_url,
                                "detail": str(e),
                            }
                        )

                elif (
                    credentials
                    and "login_flow" not in credentials
                    and not self._login_done
                    and self._is_login_page(current_url)
                ):
                    email = credentials.get("username", "")
                    password = credentials.get("password", "")

                    # Option B0: Memory-based login (skip LLM discovery on runs 2+)
                    stored_steps = app_memory.get("login", {}).get("working_steps", [])
                    failure_count = app_memory.get("login", {}).get("failure_count", 0)
                    memory_login_succeeded = False

                    if stored_steps and failure_count < 3:
                        try:
                            logger.info(
                                f"Attempting memory-based login ({len(stored_steps)} stored steps)"
                            )
                            self._execute_memory_login(stored_steps, email, password)
                            if not self._is_login_page(self.browser.get_current_url()):
                                memory_login_succeeded = True
                                self._login_done = True
                                test_steps.append(
                                    {
                                        "agent": "explorer",
                                        "action": "memory_login_completed",
                                        "url": current_url,
                                        "detail": (
                                            f"Memory login succeeded using {len(stored_steps)} stored steps, "
                                            f"now at {self.browser.get_current_url()}"
                                        ),
                                    }
                                )
                                post_shot = capture(self.browser.page, label="post_login", run_id=run_id)
                                screenshots.append(post_shot)
                                # Don't add post_login_url to visited_urls here —
                                # the next loop iteration will process the post-login page properly
                            else:
                                logger.info("Memory login steps did not navigate away from login page — falling back to smart login")
                        except Exception as mem_exc:
                            logger.info(f"Memory login failed ({mem_exc}) — falling back to smart login")

                    # Option B: Smart LLM-driven login (handles email-first, SSO redirects, single-page)
                    if not memory_login_succeeded:
                        try:
                            success, login_shots, action_history = self._smart_login(
                                email,
                                password,
                                run_id=run_id,
                                capture_steps=capture_login_steps,
                            )
                            screenshots.extend(login_shots)
                            self._login_done = True
                            if success:
                                # Store the working steps so future runs can skip LLM discovery
                                state["login_steps_for_memory"] = self._format_steps_for_memory(
                                    action_history, email
                                )
                            test_steps.append(
                                {
                                    "agent": "explorer",
                                    "action": "smart_login_completed" if success else "smart_login_partial",
                                    "url": current_url,
                                    "detail": (
                                        f"Smart login {'succeeded' if success else 'reached max steps'}, "
                                        f"now at {self.browser.get_current_url()}"
                                    ),
                                }
                            )
                            post_shot = capture(self.browser.page, label="post_login", run_id=run_id)
                            screenshots.append(post_shot)
                            # Don't add post_login_url to visited_urls here —
                            # the next loop iteration will process the post-login page properly
                        except Exception as e:
                            logger.warning(f"Smart login failed: {e}")
                            test_steps.append(
                                {
                                    "agent": "explorer",
                                    "action": "smart_login_failed",
                                    "url": current_url,
                                    "detail": str(e),
                                }
                            )

                    # Login succeeded — let the next iteration handle the post-login page
                    # instead of falling through to the navigation section below
                    if self._login_done:
                        continue

                # Record console + network errors
                console_errors = self.browser.get_console_errors()
                network_errors = self.browser.get_network_errors()
                if console_errors or network_errors:
                    test_steps.append(
                        {
                            "agent": "explorer",
                            "action": "errors_detected",
                            "console_errors": console_errors,
                            "network_errors": network_errors,
                            "url": current_url,
                        }
                    )

                # Crawl-only navigation: discover links from actual page content.
                # No URL guessing — only navigate to hrefs found on real pages.
                # Sort discovered links so known-bug-prone pages (from memory) are visited first.
                navigated = False

                # Gather links from <a href> AND navigable elements (nav buttons, sidebar links)
                raw_links = self.browser.get_all_links()
                nav_hrefs = [
                    el["href"] for el in interactive_elements
                    if el.get("href") and el["href"].startswith("http")
                ]
                all_candidate_links = list(dict.fromkeys(raw_links + nav_hrefs))  # dedupe, preserve order

                unvisited = [
                    lnk for lnk in all_candidate_links
                    if lnk and lnk not in visited_urls and _same_origin(lnk, base_origin)
                ]

                # Sort: known bug-prone pages first, then by discovery order
                unvisited.sort(
                    key=lambda u: memory_priority_scores.get(u, {}).get("priority_score", 0),
                    reverse=True,
                )

                for link in unvisited:
                    try:
                        self.browser.navigate(link)
                        self.browser.page.wait_for_timeout(1_000)  # let SPA render after navigation
                        self.browser.dismiss_overlays()
                        visited_urls.append(link)
                        navigated = True
                        logger.info(f"Navigated to discovered link: {link}")
                        break
                    except Exception:
                        continue

                if not navigated:
                    logger.info("No new links found on current page, stopping exploration")
                    break

        except Exception as exc:
            logger.error(f"ExplorerAgent error: {exc}", exc_info=True)
            test_steps.append({"agent": "explorer", "action": "error", "detail": str(exc)})
        finally:
            try:
                self.browser.close()
            except Exception:
                pass

        publish_event(run_id, "agent_done", {"agent": "explorer", "message": f"Exploration complete — {pages_explored} page(s) visited"})
        return {
            **state,
            "current_agent": "explorer",
            "screenshots": screenshots,
            "test_steps": test_steps,
            "bugs_found": bugs_found,
            "current_page": visited_urls[-1] if visited_urls else url,
            "login_steps_for_memory": state.get("login_steps_for_memory"),
            "visited_urls": visited_urls,
        }
