"""
BugHunter.AI - SecurityAgent
Performs active security testing: XSS, SQL injection, auth bypass, secret exposure.
"""

import logging
import os
import re

from graph.state import AgentState
from tools.browser import BrowserTool
from tools.events import publish_event

logger = logging.getLogger("bughunter.security")

XSS_PAYLOADS = [
    "<script>alert('XSS')</script>",
    '"><script>alert(1)</script>',
    "javascript:alert(1)",
    "<img src=x onerror=alert(1)>",
    "';alert(1)//",
]

SQLI_PAYLOADS = [
    "' OR '1'='1",
    "' OR 1=1--",
    '" OR ""="',
    "1; DROP TABLE users--",
    "admin'--",
]

COMMON_SECRET_PATTERNS = [
    r"(?i)(api[_-]?key|apikey)\s*[=:]\s*['\"]?[\w\-]{16,}",
    r"(?i)(secret[_-]?key|secretkey)\s*[=:]\s*['\"]?[\w\-]{16,}",
    r"(?i)(password|passwd|pwd)\s*[=:]\s*['\"]?\w{6,}",
    r"(?i)aws[_-]?(access[_-]?key|secret)\s*[=:]\s*['\"]?[\w/+=]{16,}",
]


class SecurityAgent:
    """Runs active security tests against the target web application."""

    def __init__(self):
        self.browser = BrowserTool()

    def _test_xss(self, url: str) -> list:
        bugs = []
        try:
            self.browser.start()
            self.browser.navigate(url)
            inputs = self.browser.get_form_inputs()

            for selector in inputs[:3]:  # Test first 3 inputs
                for payload in XSS_PAYLOADS[:2]:  # Test 2 payloads per input
                    try:
                        self.browser.fill_form(selector, payload)
                        self.browser.click("button[type='submit'], input[type='submit']")
                        source = self.browser.get_page_source()

                        # Check if payload reflected unescaped
                        if "<script>alert" in source or "onerror=alert" in source:
                            bugs.append(
                                {
                                    "type": "security",
                                    "title": f"XSS Vulnerability in {selector}",
                                    "description": f"Payload '{payload}' was reflected unescaped in the response",
                                    "page_url": url,
                                    "severity": "critical",
                                    "payload": payload,
                                }
                            )
                    except Exception as e:
                        logger.debug(f"XSS test error for {selector}: {e}")
        except Exception as exc:
            logger.error(f"XSS test failed: {exc}")
        finally:
            try:
                self.browser.close()
            except Exception:
                pass
        return bugs

    def _test_sqli(self, url: str) -> list:
        bugs = []
        try:
            self.browser.start()
            self.browser.navigate(url)
            inputs = self.browser.get_form_inputs()

            for selector in inputs[:3]:
                for payload in SQLI_PAYLOADS[:2]:
                    try:
                        self.browser.fill_form(selector, payload)
                        self.browser.click("button[type='submit'], input[type='submit']")
                        source = self.browser.get_page_source()

                        # Look for SQL error signatures
                        sql_errors = [
                            "sql syntax",
                            "mysql_fetch",
                            "unclosed quotation",
                            "ORA-",
                            "sqlite3.OperationalError",
                            "pg_query",
                        ]
                        for err in sql_errors:
                            if err.lower() in source.lower():
                                bugs.append(
                                    {
                                        "type": "security",
                                        "title": f"SQL Injection in {selector}",
                                        "description": f"SQL error exposed with payload: {payload}",
                                        "page_url": url,
                                        "severity": "critical",
                                        "payload": payload,
                                    }
                                )
                                break
                    except Exception as e:
                        logger.debug(f"SQLi test error: {e}")
        except Exception as exc:
            logger.error(f"SQLi test failed: {exc}")
        finally:
            try:
                self.browser.close()
            except Exception:
                pass
        return bugs

    def _check_exposed_secrets(self, url: str) -> list:
        bugs = []
        try:
            self.browser.start()
            self.browser.navigate(url)
            source = self.browser.get_page_source()
            self.browser.close()

            for pattern in COMMON_SECRET_PATTERNS:
                matches = re.findall(pattern, source)
                if matches:
                    bugs.append(
                        {
                            "type": "security",
                            "title": "Exposed Secret in Page Source",
                            "description": f"Potential secret found: {matches[0]}",
                            "page_url": url,
                            "severity": "critical",
                        }
                    )
        except Exception as exc:
            logger.error(f"Secret check failed: {exc}")
        return bugs

    def run(self, state: AgentState) -> AgentState:
        url = state["url"]
        run_id = state.get("run_id")
        bugs_found = list(state.get("bugs_found", []))

        logger.info(f"Running security tests on: {url}")
        publish_event(run_id, "agent_start", {"agent": "security", "message": "Running security tests (XSS, SQLi, secrets)…"})

        xss_bugs = self._test_xss(url)
        sqli_bugs = self._test_sqli(url)
        secret_bugs = self._check_exposed_secrets(url)

        new_bugs = xss_bugs + sqli_bugs + secret_bugs
        if new_bugs:
            logger.info(f"SecurityAgent found {len(new_bugs)} security issue(s)")
            for bug in new_bugs:
                publish_event(run_id, "bug_found", {
                    "title": bug.get("title", "Security issue"),
                    "severity": "critical",
                    "page_url": url,
                    "message": f"[CRITICAL] {bug.get('title', 'Security issue')}",
                })

        bugs_found.extend(new_bugs)
        publish_event(run_id, "agent_done", {"agent": "security", "message": f"Security scan complete — {len(new_bugs)} issue(s)"})

        return {
            **state,
            "current_agent": "security",
            "bugs_found": bugs_found,
        }
