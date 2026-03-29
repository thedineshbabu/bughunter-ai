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
from urllib.parse import urlparse

from langchain_core.messages import HumanMessage

from graph.state import AgentState
from providers import get_llm
from tools.browser import BrowserTool
from tools.events import publish_event
from tools.screenshot import capture

logger = logging.getLogger("bughunter.explorer")

MAX_PAGES = int(os.environ.get("AGENT_MAX_PAGES", "5"))  # configurable via env var


class ExplorerAgent:
    """Navigates the target web app and collects screenshots + interaction steps."""

    def __init__(self):
        self.llm = get_llm()
        self.browser = BrowserTool()
        self._login_done = False

    def _ask_what_to_test(self, page_title: str, page_url: str, source_snippet: str, instructions: str = "", focus_areas: str = "") -> str:
        """Ask the LLM what actions to perform on the current page."""
        custom = ""
        if instructions:
            custom += f"\nUser instructions: {instructions}"
        if focus_areas:
            custom += f"\nFocus areas: {focus_areas}"

        prompt = f"""You are a QA automation engineer exploring a web app.

Current page: {page_url}
Page title: {page_title}{custom}
HTML snippet (first 2000 chars):
{source_snippet[:2000]}

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

    def _smart_login(self, email: str, password: str) -> bool:
        """Use the LLM iteratively to navigate any login flow (single-page, email-first, SSO).

        The password is never sent to the LLM — a placeholder is used and substituted
        locally before each browser action.
        """
        MAX_STEPS = 12
        PASSWORD_PLACEHOLDER = "__PASSWORD__"

        for step_num in range(MAX_STEPS):
            self.browser.dismiss_overlays()
            current_url = self.browser.get_current_url()

            # After the first step, if we've left all auth pages the login succeeded
            if step_num > 0 and not self._is_login_page(current_url):
                logger.info(f"Smart login: URL is no longer an auth page ({current_url}) — success")
                return True

            source = self.browser.get_page_source()
            prompt = f"""You are automating login for a web app.
Current URL: {current_url}
User email: {email}
HTML (first 3000 chars):
{source[:3000]}

Determine the single next action to take to progress the login.
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
                return True

            action = step.get("action")
            selector = step.get("selector", "")
            value = step.get("value", "").replace(PASSWORD_PLACEHOLDER, password)

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
            except Exception as exc:
                logger.warning(f"Smart login: step {step_num + 1} failed ({exc}), retrying after overlay dismiss")
                self.browser.dismiss_overlays()
                try:
                    if action == "click":
                        self.browser.click(selector, force=True)
                    elif action == "fill":
                        self.browser.fill_form(selector, value)
                except Exception:
                    break

        logger.warning("Smart login: max steps reached without confirmed success")
        return False

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

        # Use scheme+host for link filtering so post-login pages are explored
        _parsed = urlparse(url)
        base_origin = f"{_parsed.scheme}://{_parsed.netloc}"

        visited_urls = []
        pages_explored = 0

        publish_event(run_id, "agent_start", {"agent": "explorer", "message": "Browser exploration starting…"})

        # Log credentials shape for debugging
        if credentials:
            cred_keys = list(credentials.keys()) if isinstance(credentials, dict) else type(credentials).__name__
            logger.info(f"Credentials received — keys: {cred_keys}")
        else:
            logger.info("No credentials provided for this run")

        try:
            self.browser.start()

            # Navigate to the root URL
            self.browser.navigate(url)
            visited_urls.append(url)

            # Dismiss any overlays / cookie consent banners.
            # Wait briefly for late-loading consent popups (e.g. TrustArc)
            # before attempting dismissal.
            time.sleep(2)
            self.browser.dismiss_overlays()

            for _ in range(max_pages):
                pages_explored += 1
                current_url = self.browser.get_current_url()
                page_title = self.browser.get_title()
                source = self.browser.get_page_source()

                # Capture screenshot
                shot = capture(self.browser.page, label=f"page_{pages_explored}")
                screenshots.append(shot)

                publish_event(run_id, "page_visited", {"url": current_url, "page": pages_explored, "title": page_title, "message": f"Exploring: {current_url}"})

                # Ask the LLM what to test
                actions_json = self._ask_what_to_test(page_title, current_url, source, instructions, focus_areas)
                test_steps.append(
                    {
                        "agent": "explorer",
                        "url": current_url,
                        "action": "observe",
                        "detail": actions_json,
                        "screenshot_label": shot["label"],
                    }
                )

                # -----------------------------------------------------------
                # Login handling
                # -----------------------------------------------------------
                # Option A: Multi-step SSO/IDP login flow
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

                        # Capture post-login screenshot
                        post_shot = capture(self.browser.page, label="post_login")
                        screenshots.append(post_shot)

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

                # Option B: Smart LLM-driven login (handles email-first, SSO redirects, single-page)
                elif (
                    credentials
                    and "login_flow" not in credentials
                    and not self._login_done
                    and self._is_login_page(current_url)
                ):
                    try:
                        success = self._smart_login(
                            credentials.get("username", ""),
                            credentials.get("password", ""),
                        )
                        self._login_done = True
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
                        post_login_url = self.browser.get_current_url()
                        if post_login_url not in visited_urls:
                            visited_urls.append(post_login_url)
                        post_shot = capture(self.browser.page, label="post_login")
                        screenshots.append(post_shot)
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

                # Try to find and click a navigation link to a new page
                navigated = False
                links = self.browser.get_all_links()
                for link in links:
                    if link and link not in visited_urls and link.startswith(base_origin):
                        try:
                            self.browser.navigate(link)
                            self.browser.dismiss_overlays()
                            visited_urls.append(link)
                            navigated = True
                            break
                        except Exception:
                            continue

                if not navigated:
                    logger.info("No new links found, stopping exploration")
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
            "current_page": visited_urls[-1] if visited_urls else url,
        }
