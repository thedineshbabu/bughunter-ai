"""
BugHunter.AI - ExplorerAgent
Uses Playwright to navigate the app, capture screenshots, and log interaction steps.
"""

import logging
import os

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage

from graph.state import AgentState
from tools.browser import BrowserTool
from tools.screenshot import capture

logger = logging.getLogger("bughunter.explorer")

MAX_PAGES = 5  # Maximum pages to explore per run


class ExplorerAgent:
    """Navigates the target web app and collects screenshots + interaction steps."""

    def __init__(self):
        self.llm = ChatAnthropic(
            model="claude-3-5-sonnet-20241022",
            api_key=os.environ["ANTHROPIC_API_KEY"],
        )
        self.browser = BrowserTool()

    def _ask_what_to_test(self, page_title: str, page_url: str, source_snippet: str) -> str:
        """Ask Claude what actions to perform on the current page."""
        prompt = f"""You are a QA automation engineer exploring a web app.

Current page: {page_url}
Page title: {page_title}
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

    def run(self, state: AgentState) -> AgentState:
        url = state["url"]
        credentials = state.get("credentials") or {}
        screenshots = list(state.get("screenshots", []))
        test_steps = list(state.get("test_steps", []))

        visited_urls = []
        pages_explored = 0

        try:
            self.browser.start()

            # Navigate to the root URL
            self.browser.navigate(url)
            visited_urls.append(url)

            for _ in range(MAX_PAGES):
                pages_explored += 1
                current_url = self.browser.get_current_url()
                page_title = self.browser.get_title()
                source = self.browser.get_page_source()

                # Capture screenshot
                shot = capture(self.browser.page, label=f"page_{pages_explored}")
                screenshots.append(shot)

                # Ask Claude what to test
                actions_json = self._ask_what_to_test(page_title, current_url, source)
                test_steps.append(
                    {
                        "agent": "explorer",
                        "url": current_url,
                        "action": "observe",
                        "detail": actions_json,
                        "screenshot_label": shot["label"],
                    }
                )

                # Try login if credentials present and on a login-looking page
                if credentials and ("login" in current_url.lower() or "signin" in current_url.lower()):
                    try:
                        self.browser.fill_form("input[type='email'], input[name='username']", credentials.get("username", ""))
                        self.browser.fill_form("input[type='password']", credentials.get("password", ""))
                        self.browser.click("button[type='submit'], input[type='submit']")
                        test_steps.append({"agent": "explorer", "action": "login_attempt", "url": current_url})
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

        return {
            **state,
            "current_agent": "explorer",
            "screenshots": screenshots,
            "test_steps": test_steps,
            "current_page": visited_urls[-1] if visited_urls else url,
        }
