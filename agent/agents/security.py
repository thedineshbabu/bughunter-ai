"""
BugHunter.AI - SecurityAgent
Performs active security testing: XSS, SQL injection, auth bypass, secret exposure.
Scans the seed URL plus URLs visited during exploration (capped).
"""

import logging
import os
import re

from graph.state import AgentState
from tools.browser import BrowserTool
from tools.control import SIGNAL_STOP, check_run_control
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

SECURITY_MAX_URLS = int(os.environ.get("SECURITY_MAX_URLS", "6"))


def _build_target_urls(state: AgentState) -> list:
    """Seed URL plus explorer visited URLs, deduped, capped."""
    base = state["url"]
    visited = state.get("visited_urls") or []
    out = []
    seen = set()
    for u in [base] + list(visited):
        if not u or u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out[: max(1, SECURITY_MAX_URLS)]


class SecurityAgent:
    """Runs active security tests against the target web application."""

    def __init__(self):
        self.browser = BrowserTool()

    def _secrets_from_source(self, source: str, page_url: str) -> list:
        bugs = []
        for pattern in COMMON_SECRET_PATTERNS:
            matches = re.findall(pattern, source)
            if matches:
                bugs.append(
                    {
                        "type": "security",
                        "title": "Exposed Secret in Page Source",
                        "description": "Potential secret pattern matched in HTML (verify manually — may be a false positive).",
                        "page_url": page_url,
                        "severity": "high",
                    }
                )
                break
        return bugs

    def _scan_url(self, url: str) -> list:
        """XSS + SQLi + secret scan in one browser session per URL."""
        bugs: list = []
        try:
            self.browser.start()
            self.browser.navigate(url)

            inputs = self.browser.get_form_inputs()
            head = inputs[:3]

            for selector in head:
                for payload in XSS_PAYLOADS[:2]:
                    try:
                        self.browser.fill_form(selector, payload)
                        self.browser.click("button[type='submit'], input[type='submit']")
                        source = self.browser.get_page_source()
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

            try:
                self.browser.navigate(url)
            except Exception:
                pass

            for selector in head:
                for payload in SQLI_PAYLOADS[:2]:
                    try:
                        self.browser.fill_form(selector, payload)
                        self.browser.click("button[type='submit'], input[type='submit']")
                        source = self.browser.get_page_source()
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

            try:
                self.browser.navigate(url)
                source = self.browser.get_page_source()
                bugs.extend(self._secrets_from_source(source, url))
            except Exception as exc:
                logger.debug(f"Secret scan navigate failed: {exc}")

        except Exception as exc:
            logger.error(f"Security scan failed for {url}: {exc}")
        finally:
            try:
                self.browser.close()
            except Exception:
                pass
        return bugs

    def run(self, state: AgentState) -> AgentState:
        run_id = state.get("run_id")
        bugs_found = list(state.get("bugs_found", []))

        if check_run_control(run_id) == SIGNAL_STOP:
            logger.info(f"Run {run_id} stopped — skipping security scan")
            return {**state, "current_agent": "security"}

        targets = _build_target_urls(state)

        logger.info(f"Running security tests on {len(targets)} URL(s): {targets}")
        publish_event(
            run_id,
            "agent_start",
            {"agent": "security", "message": f"Running security tests on {len(targets)} page(s)…"},
        )

        new_bugs: list = []
        for turl in targets:
            new_bugs.extend(self._scan_url(turl))

        if new_bugs:
            logger.info(f"SecurityAgent found {len(new_bugs)} security issue(s)")
            for bug in new_bugs:
                publish_event(
                    run_id,
                    "bug_found",
                    {
                        "title": bug.get("title", "Security issue"),
                        "severity": bug.get("severity", "critical"),
                        "page_url": bug.get("page_url", ""),
                        "message": f"[{bug.get('severity', 'critical').upper()}] {bug.get('title', 'Security issue')}",
                    },
                )

        bugs_found.extend(new_bugs)
        publish_event(
            run_id,
            "agent_done",
            {"agent": "security", "message": f"Security scan complete — {len(new_bugs)} issue(s) across {len(targets)} URL(s)"},
        )

        return {
            **state,
            "current_agent": "security",
            "bugs_found": bugs_found,
        }
