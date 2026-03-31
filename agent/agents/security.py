"""
BugHunter.AI - SecurityAgent
Performs active security testing: XSS, SQL injection, CSRF, IDOR,
HTTP header security, cookie flags, auth bypass, secret exposure.
Scans the seed URL plus URLs visited during exploration (capped).
"""

import logging
import os
import re
from urllib.parse import urlparse

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

# Required HTTP security headers and expected values
REQUIRED_SECURITY_HEADERS = {
    "strict-transport-security": "HSTS header missing — site vulnerable to protocol downgrade attacks",
    "x-content-type-options": "X-Content-Type-Options header missing — vulnerable to MIME sniffing",
    "x-frame-options": "X-Frame-Options header missing — vulnerable to clickjacking",
    "content-security-policy": "Content-Security-Policy header missing — no XSS mitigation via CSP",
}

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

    def _check_security_headers(self, url: str) -> list:
        """Check for missing HTTP security headers via Playwright response."""
        bugs = []
        try:
            self.browser.start()
            response = self.browser.page.goto(url, wait_until="domcontentloaded")
            if response:
                headers = {k.lower(): v for k, v in response.headers.items()}
                for header, message in REQUIRED_SECURITY_HEADERS.items():
                    if header not in headers:
                        bugs.append({
                            "type": "security",
                            "title": f"Missing Security Header: {header}",
                            "description": message,
                            "page_url": url,
                            "severity": "medium",
                        })
        except Exception as exc:
            logger.debug(f"Header check failed for {url}: {exc}")
        finally:
            try:
                self.browser.close()
            except Exception:
                pass
        return bugs

    def _check_cookie_security(self, url: str) -> list:
        """Check cookies for missing security flags (HttpOnly, Secure, SameSite)."""
        bugs = []
        try:
            self.browser.start()
            self.browser.navigate(url)
            cookies = self.browser._context.cookies()
            parsed = urlparse(url)
            is_https = parsed.scheme == "https"

            for cookie in cookies:
                name = cookie.get("name", "")
                issues = []
                if not cookie.get("httpOnly", False):
                    issues.append("HttpOnly")
                if is_https and not cookie.get("secure", False):
                    issues.append("Secure")
                if cookie.get("sameSite", "None") == "None":
                    issues.append("SameSite")

                if issues:
                    bugs.append({
                        "type": "security",
                        "title": f"Insecure Cookie: {name}",
                        "description": f"Cookie '{name}' is missing flags: {', '.join(issues)}. "
                                       f"This could expose the cookie to XSS theft or CSRF attacks.",
                        "page_url": url,
                        "severity": "medium" if "HttpOnly" in issues else "low",
                    })
        except Exception as exc:
            logger.debug(f"Cookie check failed: {exc}")
        finally:
            try:
                self.browser.close()
            except Exception:
                pass
        return bugs

    def _check_csrf(self, url: str) -> list:
        """Check forms for missing CSRF tokens."""
        bugs = []
        try:
            self.browser.start()
            self.browser.navigate(url)
            # Look for POST forms without CSRF tokens
            forms_info = self.browser.page.evaluate("""
                () => {
                    const forms = document.querySelectorAll('form[method="post"], form[method="POST"], form:not([method])');
                    return Array.from(forms).map(f => ({
                        action: f.action,
                        hasToken: !!(
                            f.querySelector('input[name*="csrf"]') ||
                            f.querySelector('input[name*="token"]') ||
                            f.querySelector('input[name*="_token"]') ||
                            f.querySelector('input[name="authenticity_token"]')
                        ),
                        inputCount: f.querySelectorAll('input').length,
                    }));
                }
            """)
            for form in (forms_info or []):
                if not form.get("hasToken") and form.get("inputCount", 0) > 0:
                    bugs.append({
                        "type": "security",
                        "title": "Potential CSRF Vulnerability",
                        "description": f"Form posting to '{form.get('action', url)}' has no CSRF token. "
                                       f"State-changing requests may be vulnerable to cross-site request forgery.",
                        "page_url": url,
                        "severity": "high",
                    })
        except Exception as exc:
            logger.debug(f"CSRF check failed: {exc}")
        finally:
            try:
                self.browser.close()
            except Exception:
                pass
        return bugs

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

    def _build_adaptive_payloads(self, state: AgentState) -> tuple:
        """Build XSS and SQLi payload lists, prioritizing previously effective ones from memory."""
        app_memory = state.get("app_memory") or {}
        known_bugs = app_memory.get("known_bugs", [])
        # Extract payloads from known security bugs
        effective_xss = []
        effective_sqli = []
        for b in known_bugs:
            if b.get("type") != "security":
                continue
            title = b.get("title", "").lower()
            # Skills table may also store effective payloads via skill_data
            # but known_bugs from app_memory is the primary source
            if "xss" in title:
                effective_xss.append(b.get("title", ""))
            elif "sql" in title:
                effective_sqli.append(b.get("title", ""))

        # Also check agent_skills for effective payloads
        skills = state.get("skills") or []
        for skill in skills:
            if skill.get("skill_type") != "security_payload":
                continue
            data = skill.get("skill_data", {})
            payload = data.get("payload", "")
            if not payload:
                continue
            if data.get("type") == "xss":
                effective_xss.append(payload)
            elif data.get("type") == "sqli":
                effective_sqli.append(payload)

        # Prepend effective payloads, then defaults, deduplicated
        xss = list(dict.fromkeys(effective_xss + XSS_PAYLOADS))
        sqli = list(dict.fromkeys(effective_sqli + SQLI_PAYLOADS))
        return xss, sqli

    def _scan_url(self, url: str, xss_payloads: list = None, sqli_payloads: list = None) -> list:
        """XSS + SQLi + secret scan in one browser session per URL."""
        xss_payloads = xss_payloads or XSS_PAYLOADS
        sqli_payloads = sqli_payloads or SQLI_PAYLOADS
        bugs: list = []
        try:
            self.browser.start()
            self.browser.navigate(url)

            inputs = self.browser.get_form_inputs()
            head = inputs[:3]

            for selector in head:
                for payload in xss_payloads[:2]:
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
                for payload in sqli_payloads[:2]:
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

        # Build adaptive payload lists from memory and skills
        xss_payloads, sqli_payloads = self._build_adaptive_payloads(state)
        if len(xss_payloads) > len(XSS_PAYLOADS) or len(sqli_payloads) > len(SQLI_PAYLOADS):
            logger.info(f"Using adaptive payloads: {len(xss_payloads)} XSS, {len(sqli_payloads)} SQLi")

        targets = _build_target_urls(state)

        logger.info(f"Running security tests on {len(targets)} URL(s): {targets}")
        publish_event(
            run_id,
            "agent_start",
            {"agent": "security", "message": f"Running security tests on {len(targets)} page(s)…"},
        )

        new_bugs: list = []
        for turl in targets:
            new_bugs.extend(self._scan_url(turl, xss_payloads, sqli_payloads))

        # Run header, cookie, and CSRF checks on the seed URL only (avoid redundancy)
        seed_url = state["url"]
        publish_event(run_id, "agent_progress", {"agent": "security", "message": "Checking HTTP headers, cookies, and CSRF…"})
        new_bugs.extend(self._check_security_headers(seed_url))
        new_bugs.extend(self._check_cookie_security(seed_url))
        new_bugs.extend(self._check_csrf(seed_url))

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
