"""
BugHunter.AI - ExplorerAgent
Uses Playwright to navigate the app, capture screenshots, and log interaction steps.
Supports multi-step SSO/IDP login flows via the credentials.login_flow config.
"""

import logging
import os
import time

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

                # Option B: Simple same-page login (email + password on one page)
                elif (
                    credentials
                    and "login_flow" not in credentials
                    and not self._login_done
                    and self._is_login_page(current_url)
                ):
                    try:
                        self.browser.fill_form(
                            "input[type='email'], input[name='username']",
                            credentials.get("username", ""),
                        )
                        self.browser.fill_form(
                            "input[type='password']",
                            credentials.get("password", ""),
                        )
                        self.browser.click(
                            "button[type='submit'], input[type='submit']"
                        )
                        self._login_done = True
                        test_steps.append(
                            {
                                "agent": "explorer",
                                "action": "login_attempt",
                                "url": current_url,
                            }
                        )
                    except Exception as e:
                        logger.warning(f"Login attempt failed: {e}")

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
                    if link and link not in visited_urls and link.startswith(url):
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
