"""Playwright-based smoke test executor with crawl-driven scenario generation.

Flow:
  1. Navigate to target URL
  2. Handle login if credentials provided (or auto-detect login prompt)
  3. Crawl the application — discover pages, navigation, interactive elements
  4. Generate smoke test scenarios from crawl data
  5. Execute each scenario
  6. Generate an HTML report
"""

from __future__ import annotations

import base64
import html as html_mod
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin, urlparse

from config import Config

log = logging.getLogger(__name__)

LOGIN_TRIGGER_PATTERNS = [
    "login.microsoftonline.com",
    "login.live.com",
    "home.kornferrytalent",
]


# ── Dataclasses ──────────────────────────────────────────────────────────────

@dataclass
class SmokeCheck:
    id: str
    title: str
    status: str = "pending"
    detail: str = ""
    duration_ms: int = 0
    screenshot_b64: str = ""


@dataclass
class CrawlResult:
    pages_discovered: list[dict] = field(default_factory=list)
    navigation_items: list[dict] = field(default_factory=list)
    forms: list[dict] = field(default_factory=list)
    buttons: list[dict] = field(default_factory=list)
    api_endpoints: list[str] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)
    page_title: str = ""
    current_url: str = ""

    def to_dict(self) -> dict:
        return {
            "pages_discovered": self.pages_discovered,
            "navigation_items": self.navigation_items,
            "forms": self.forms,
            "buttons": self.buttons,
            "api_endpoints": self.api_endpoints[:20],
            "headings": self.headings,
            "page_title": self.page_title,
            "current_url": self.current_url,
        }


@dataclass
class SmokeReport:
    url: str
    timestamp: str = ""
    total_duration_ms: int = 0
    checks: list[SmokeCheck] = field(default_factory=list)
    crawl_result: Optional[CrawlResult] = None
    screenshot_path: str = ""
    screenshot_b64: str = ""
    console_errors: list[str] = field(default_factory=list)
    network_failures: list[str] = field(default_factory=list)
    report_path: str = ""

    @property
    def passed(self) -> int:
        return sum(1 for c in self.checks if c.status == "pass")

    @property
    def failed(self) -> int:
        return sum(1 for c in self.checks if c.status == "fail")

    @property
    def warnings(self) -> int:
        return sum(1 for c in self.checks if c.status == "warn")

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "timestamp": self.timestamp,
            "total_duration_ms": self.total_duration_ms,
            "summary": {
                "total": len(self.checks),
                "passed": self.passed,
                "failed": self.failed,
                "warnings": self.warnings,
            },
            "checks": [
                {
                    "id": c.id,
                    "title": c.title,
                    "status": c.status,
                    "detail": c.detail,
                    "duration_ms": c.duration_ms,
                    "screenshot_b64": c.screenshot_b64,
                }
                for c in self.checks
            ],
            "crawl_result": self.crawl_result.to_dict() if self.crawl_result else None,
            "console_errors": self.console_errors,
            "network_failures": self.network_failures,
            "screenshot_b64": self.screenshot_b64,
            "screenshot_path": self.screenshot_path,
            "report_path": self.report_path,
        }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _timed(fn):
    start = time.perf_counter()
    result = fn()
    elapsed = int((time.perf_counter() - start) * 1000)
    return result, elapsed


def _needs_login(page_url: str) -> bool:
    lowered = page_url.lower()
    return any(p in lowered for p in LOGIN_TRIGGER_PATTERNS)


def _has_login_form(page) -> bool:
    try:
        return page.evaluate("""() => {
            const pw = document.querySelector('input[type="password"]');
            const email = document.querySelector(
                'input[type="email"], input[name="loginfmt"], '
                + 'input[name="username"], input[name="UserName"]'
            );
            return !!(pw || email);
        }""")
    except Exception:
        return False


def _handle_login(page, credentials: dict | None, original_url: str) -> None:
    """Handle login flow using provided credentials or defaults."""
    current = page.url.lower()

    if not (_needs_login(current) or _has_login_form(page)):
        return

    if not credentials or not credentials.get("user_id"):
        log.info("Login prompt detected but no credentials provided — skipping")
        return

    log.info("Login prompt detected — entering credentials for %s", credentials["user_id"])

    email_selector = (
        'input[type="email"], input[name="loginfmt"], input[name="login"], '
        'input[name="username"], input[name="UserName"], '
        'input[id="i0116"], input[id="userNameInput"]'
    )
    try:
        page.wait_for_selector(email_selector, timeout=10000)
        page.fill(email_selector, credentials["user_id"])
        page.wait_for_timeout(500)
        next_btn = 'input[type="submit"], button[type="submit"], #idSIButton9, #nextButton'
        if page.query_selector(next_btn):
            page.click(next_btn)
            page.wait_for_timeout(2000)
    except Exception as exc:
        log.warning("Email step failed: %s", exc)
        return

    password_selector = (
        'input[type="password"], input[name="passwd"], input[name="password"], '
        'input[name="Password"], input[id="i0118"], input[id="passwordInput"]'
    )
    try:
        page.wait_for_selector(password_selector, state="visible", timeout=10000)
        page.fill(password_selector, credentials["password"])
        page.wait_for_timeout(500)
        sign_in_btn = 'input[type="submit"], button[type="submit"], #idSIButton9, #submitButton'
        if page.query_selector(sign_in_btn):
            page.click(sign_in_btn)
            page.wait_for_timeout(3000)
    except Exception as exc:
        log.warning("Password step failed: %s", exc)
        return

    try:
        stay = '#idSIButton9, #idBtn_Back, input[value="Yes"], input[value="No"]'
        btn = page.query_selector(stay)
        if btn:
            btn.click()
            page.wait_for_timeout(2000)
    except Exception:
        pass

    page.wait_for_load_state("domcontentloaded", timeout=15000)
    log.info("Login completed — now at %s", page.url)


def _dismiss_consent_popup(page) -> None:
    selectors = [
        'button:has-text("Accept All")', 'button:has-text("Accept all")',
        'button:has-text("ACCEPT ALL")', 'a:has-text("Accept All")',
        'button:has-text("Accept All Cookies")', 'button:has-text("Allow All")',
        'button#onetrust-accept-btn-handler', 'button#accept-all',
    ]
    page.wait_for_timeout(2000)
    for sel in selectors:
        try:
            btn = page.query_selector(sel)
            if btn and btn.is_visible():
                btn.click()
                log.info("Dismissed consent popup via: %s", sel)
                page.wait_for_timeout(1000)
                return
        except Exception:
            continue


def _extract_auth_token(page, context) -> str | None:
    token = page.evaluate("""() => {
        const keys = [
            'access_token', 'accessToken', 'auth_token', 'authToken',
            'token', 'id_token', 'idToken', 'jwt', 'bearer',
            'msal.idtoken', 'msal.accesstoken',
        ];
        for (const key of keys) {
            let val = localStorage.getItem(key) || sessionStorage.getItem(key);
            if (val) return val;
        }
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k && (k.includes('accesstoken') || k.includes('idtoken'))) {
                try {
                    const parsed = JSON.parse(sessionStorage.getItem(k));
                    if (parsed && parsed.secret) return parsed.secret;
                } catch {}
                return sessionStorage.getItem(k);
            }
        }
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.includes('accesstoken') || k.includes('idtoken'))) {
                try {
                    const parsed = JSON.parse(localStorage.getItem(k));
                    if (parsed && parsed.secret) return parsed.secret;
                } catch {}
                return localStorage.getItem(k);
            }
        }
        return null;
    }""")
    if token:
        log.info("Auth token extracted from browser storage")
        return token
    cookies = context.cookies()
    for cookie in cookies:
        if any(n in cookie["name"].lower() for n in (
            "access_token", "auth_token", "token", "jwt", "id_token",
        )):
            log.info("Auth token extracted from cookie: %s", cookie["name"])
            return cookie["value"]
    log.warning("No auth token found")
    return None


def _take_step_screenshot(page, check: SmokeCheck, output_dir: Path, domain: str) -> None:
    try:
        ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"smoke_{domain}_{check.id}_{ts}.png"
        filepath = output_dir / filename
        screenshot_bytes = page.screenshot(full_page=False)
        filepath.write_bytes(screenshot_bytes)
        check.screenshot_b64 = base64.b64encode(screenshot_bytes).decode("ascii")
    except Exception as exc:
        log.warning("Screenshot for %s failed: %s", check.id, exc)


# ── KF One Interactive Helpers ────────────────────────────────────────────────

def _find_and_click_client(page) -> str | None:
    """Find a client card/row on the page and click the first one.

    Searches for common patterns: cards with client names, list items,
    table rows, or any clickable element that looks like a client selector.
    """
    selectors = [
        # Card-based layouts
        '[class*="client"] [class*="card"]',
        '[class*="client"] [class*="item"]',
        '[class*="client-card"]',
        '[class*="client-list"] a',
        '[class*="client-list"] [class*="item"]',
        '[class*="clientCard"]',
        '[class*="ClientCard"]',
        # Tile / grid layouts
        '[class*="tile"]',
        '[class*="Tile"]',
        # Table-based
        'table tbody tr',
        # List-based
        '[class*="list"] [class*="item"] a',
        '[class*="list-item"] a',
        # Generic clickable containers with names
        '[data-testid*="client"]',
        '[data-cy*="client"]',
        # Fallback: any anchor inside a card-like container
        '.card a',
        '[class*="card"] a',
        '[role="listitem"] a',
        '[role="listitem"]',
        # Wide fallback: clickable rows/items
        '[class*="row"][class*="click"]',
        '[class*="selectable"]',
    ]

    for sel in selectors:
        try:
            elements = page.query_selector_all(sel)
            visible = [el for el in elements if el.is_visible()]
            if visible:
                chosen = visible[0]
                text = (chosen.inner_text() or "").strip()[:60]
                if not text:
                    text = chosen.get_attribute("title") or chosen.get_attribute("aria-label") or "Client"
                chosen.click()
                return text
        except Exception:
            continue

    # Last resort: look for any clickable element whose text suggests a client/company name
    try:
        candidates = page.evaluate("""() => {
            const items = [];
            document.querySelectorAll('a, [role="button"], [class*="card"], [class*="item"]')
                .forEach(el => {
                    const text = (el.innerText || '').trim();
                    const rect = el.getBoundingClientRect();
                    if (text.length > 2 && text.length < 80 && rect.width > 50 && rect.height > 30
                        && !['Home','Login','Sign','Settings','Help','Profile','Menu','Search',
                             'Close','Cancel','OK','Submit','Back'].some(s => text.startsWith(s))) {
                        items.push({ text: text.substring(0, 60), tag: el.tagName });
                    }
                });
            return items.slice(0, 10);
        }""")
        if candidates:
            first_text = candidates[0]["text"]
            page.click(f'text="{first_text}"')
            return first_text
    except Exception:
        pass

    return None


def _find_and_click_quick_link(page) -> str | None:
    """Find a 'Quick Links' section and click the first link in it."""
    selectors = [
        # Explicit Quick Links section
        '[class*="quick-link"] a',
        '[class*="quickLink"] a',
        '[class*="QuickLink"] a',
        '[class*="quick_link"] a',
        # By heading text proximity
        ':text("Quick Links") ~ a',
        ':text("Quick links") ~ a',
        ':text("quick links") ~ a',
        # Section/div containing "quick" in class with links
        '[class*="quick"] a',
        '[class*="Quick"] a',
        # Sidebar quick links
        '[class*="sidebar"] [class*="quick"] a',
        '[class*="shortcut"] a',
        '[class*="Shortcut"] a',
    ]

    for sel in selectors:
        try:
            elements = page.query_selector_all(sel)
            visible = [el for el in elements if el.is_visible()]
            if visible:
                chosen = visible[0]
                text = (chosen.inner_text() or "").strip()[:60]
                if not text:
                    text = chosen.get_attribute("title") or "Quick Link"
                chosen.click()
                return text
        except Exception:
            continue

    # Fallback: search for heading/label containing "Quick Link" and grab links near it
    try:
        ql_section = page.evaluate("""() => {
            const allEls = document.querySelectorAll('h1,h2,h3,h4,h5,h6,span,div,p,label');
            for (const el of allEls) {
                const text = (el.innerText || '').trim().toLowerCase();
                if (text.includes('quick link') || text.includes('quicklink')) {
                    const parent = el.closest('section, div, aside, nav')
                                   || el.parentElement;
                    if (parent) {
                        const links = parent.querySelectorAll('a');
                        const result = [];
                        links.forEach(a => {
                            const lt = (a.innerText || '').trim();
                            if (lt && a.offsetParent !== null) {
                                result.push(lt.substring(0, 60));
                            }
                        });
                        return result;
                    }
                }
            }
            return [];
        }""")
        if ql_section:
            link_text = ql_section[0]
            page.click(f'text="{link_text}"')
            return link_text
    except Exception:
        pass

    return None


def _open_hamburger_and_click(page) -> str | None:
    """Open the hamburger menu (three-line/dots icon) and click the first menu item."""
    hamburger_selectors = [
        # Common hamburger button patterns
        'button[class*="hamburger"]',
        'button[class*="Hamburger"]',
        '[class*="hamburger"]',
        'button[class*="menu-toggle"]',
        'button[class*="menuToggle"]',
        'button[class*="menu-btn"]',
        'button[aria-label*="menu" i]',
        'button[aria-label*="Menu" i]',
        'button[aria-label*="navigation" i]',
        'button[title*="menu" i]',
        '[class*="burger"]',
        '[class*="nav-toggle"]',
        '[class*="navToggle"]',
        # Three-line icon (≡)
        'button:has(svg)',
        '[class*="menu-icon"]',
        '[class*="menuIcon"]',
        # Material / common patterns
        'button[class*="MuiIconButton"]',
        '.mat-icon-button',
        # Generic icon buttons in the header area
        'header button',
        'nav button',
        '[class*="toolbar"] button',
        '[class*="Toolbar"] button',
        '[class*="appbar"] button',
        '[class*="AppBar"] button',
    ]

    opened = False
    for sel in hamburger_selectors:
        try:
            elements = page.query_selector_all(sel)
            for el in elements:
                if not el.is_visible():
                    continue
                # Check if this looks like a hamburger (small button, icon-like)
                box = el.bounding_box()
                if box and box["width"] < 80 and box["height"] < 80:
                    el.click()
                    page.wait_for_timeout(1500)
                    opened = True
                    break
            if opened:
                break
        except Exception:
            continue

    if not opened:
        return None

    # Now find and click a menu item from the opened menu/drawer/sidebar
    menu_item_selectors = [
        '[class*="drawer"] a',
        '[class*="Drawer"] a',
        '[class*="sidebar"] a',
        '[class*="Sidebar"] a',
        '[class*="menu-panel"] a',
        '[class*="menuPanel"] a',
        '[class*="nav-menu"] a',
        '[class*="navMenu"] a',
        '[role="menu"] [role="menuitem"]',
        '[role="menu"] a',
        '[class*="menu-item"] a',
        '[class*="MenuItem"] a',
        '[class*="menu"] li a',
        '[class*="slide"] a',
        'nav a',
    ]

    for sel in menu_item_selectors:
        try:
            items = page.query_selector_all(sel)
            visible = [el for el in items if el.is_visible()]
            if visible:
                chosen = visible[0]
                text = (chosen.inner_text() or "").strip()[:60]
                if not text:
                    text = chosen.get_attribute("title") or "Menu item"
                chosen.click()
                return text
        except Exception:
            continue

    return None


def _click_header_to_home(page, base_url: str) -> str | None:
    """Click the header/logo/brand to navigate back to the home page."""
    header_selectors = [
        # Logo / brand links
        'header a[class*="logo"]',
        'header a[class*="Logo"]',
        'header a[class*="brand"]',
        'header a[class*="Brand"]',
        'header [class*="logo"] a',
        'header [class*="Logo"] a',
        '[class*="header"] a[class*="logo"]',
        '[class*="Header"] a[class*="Logo"]',
        # Logo images wrapped in links
        'header a img',
        '[class*="header"] a img',
        '[class*="logo"] a',
        '[class*="Logo"] a',
        # Toolbar/appbar brand
        '[class*="toolbar"] a[class*="brand"]',
        '[class*="Toolbar"] a',
        '[class*="appbar"] a',
        '[class*="AppBar"] a',
        # Header link with home href
        'header a[href="/"]',
        'header a[href=""]',
        '[class*="header"] a[href="/"]',
        # First anchor in header
        'header a:first-of-type',
        '[class*="header"] a:first-of-type',
        # SVG/image logos
        'header svg',
        '[class*="header"] svg',
        '[class*="logo"]',
        '[class*="Logo"]',
    ]

    for sel in header_selectors:
        try:
            elements = page.query_selector_all(sel)
            for el in elements:
                if not el.is_visible():
                    continue
                text = (el.inner_text() or "").strip()[:40]
                if not text:
                    text = (el.get_attribute("alt") or el.get_attribute("title")
                            or el.get_attribute("aria-label") or "Logo/Header")
                el.click()
                page.wait_for_timeout(2000)
                return text
        except Exception:
            continue

    # Fallback: navigate directly to base URL
    try:
        page.goto(base_url, wait_until="domcontentloaded", timeout=15000)
        return "Direct navigation to home URL"
    except Exception:
        pass

    return None


def _find_and_click_logout(page) -> str | None:
    """Find and click the logout / sign-out button or link.

    Searches profile menus, avatar dropdowns, settings menus, and direct
    logout links in sidebars or headers.
    """
    # First try to open a user/profile dropdown that may contain logout
    profile_triggers = [
        '[class*="avatar"]',
        '[class*="Avatar"]',
        '[class*="profile"]',
        '[class*="Profile"]',
        '[class*="user-menu"]',
        '[class*="userMenu"]',
        '[class*="UserMenu"]',
        '[class*="account"]',
        '[class*="Account"]',
        'button[aria-label*="account" i]',
        'button[aria-label*="profile" i]',
        'button[aria-label*="user" i]',
        '[data-testid*="avatar"]',
        '[data-testid*="profile"]',
        '[class*="user-icon"]',
        '[class*="userIcon"]',
    ]

    for sel in profile_triggers:
        try:
            el = page.query_selector(sel)
            if el and el.is_visible():
                el.click()
                page.wait_for_timeout(1500)
                break
        except Exception:
            continue

    # Now search for the logout / sign-out action
    logout_selectors = [
        'a:has-text("Logout")',
        'a:has-text("Log out")',
        'a:has-text("Log Out")',
        'a:has-text("Sign out")',
        'a:has-text("Sign Out")',
        'a:has-text("Signout")',
        'button:has-text("Logout")',
        'button:has-text("Log out")',
        'button:has-text("Log Out")',
        'button:has-text("Sign out")',
        'button:has-text("Sign Out")',
        'button:has-text("Signout")',
        '[role="menuitem"]:has-text("Logout")',
        '[role="menuitem"]:has-text("Log out")',
        '[role="menuitem"]:has-text("Sign out")',
        '[class*="logout"]',
        '[class*="Logout"]',
        '[class*="signout"]',
        '[class*="SignOut"]',
        'a[href*="logout"]',
        'a[href*="signout"]',
        'a[href*="sign-out"]',
        'a[href*="log-out"]',
        '[data-testid*="logout"]',
        '[data-testid*="signout"]',
    ]

    for sel in logout_selectors:
        try:
            el = page.query_selector(sel)
            if el and el.is_visible():
                text = (el.inner_text() or "").strip()[:40] or "Logout"
                el.click()
                return text
        except Exception:
            continue

    # Fallback: JS scan for any element whose text contains logout/sign out
    try:
        found = page.evaluate("""() => {
            const all = document.querySelectorAll('a, button, [role="menuitem"], span, div');
            for (const el of all) {
                const text = (el.innerText || '').trim().toLowerCase();
                if ((text === 'logout' || text === 'log out' || text === 'sign out'
                     || text === 'signout') && el.offsetParent !== null) {
                    return (el.innerText || '').trim().substring(0, 40);
                }
            }
            return null;
        }""")
        if found:
            page.click(f'text="{found}"')
            return found
    except Exception:
        pass

    return None


def _detect_session_timeout_prompt(page, wait_minutes: int, _emit) -> dict:
    """Wait for the session timeout warning prompt to appear.

    KF One shows a "Continue session?" prompt 5 minutes before the 30-min
    session expires (i.e. at the 25-minute mark).

    Args:
        page: Playwright page object.
        wait_minutes: Maximum minutes to wait for the prompt.
        _emit: Progress callback.

    Returns:
        dict with keys: prompt_found (bool), prompt_text (str),
        continue_button_found (bool), waited_ms (int).
    """
    result = {
        "prompt_found": False,
        "prompt_text": "",
        "continue_button_found": False,
        "waited_ms": 0,
    }

    prompt_selectors = [
        # Modal / dialog patterns for session timeout
        '[class*="session"] [class*="modal"]',
        '[class*="Session"] [class*="Modal"]',
        '[class*="timeout"] [class*="modal"]',
        '[class*="Timeout"] [class*="Modal"]',
        '[class*="session-timeout"]',
        '[class*="sessionTimeout"]',
        '[class*="SessionTimeout"]',
        '[role="dialog"]',
        '[role="alertdialog"]',
        '[class*="modal"][class*="show"]',
        '[class*="Modal"][class*="open"]',
        '.modal.show',
        '.modal.active',
        '[class*="dialog"]',
        '[class*="Dialog"]',
        '[class*="overlay"][class*="active"]',
        '[class*="popup"]',
        '[class*="Popup"]',
    ]

    session_keywords = [
        "session", "timeout", "expire", "inactive", "idle",
        "continue", "extend", "stay signed in", "still there",
        "are you still", "session about to", "session will",
        "your session", "log out", "logged out",
    ]

    poll_interval_ms = 15000  # Check every 15 seconds
    max_polls = int((wait_minutes * 60 * 1000) / poll_interval_ms)

    _emit("log", f"Waiting up to {wait_minutes} min for session timeout prompt "
          f"(polling every {poll_interval_ms // 1000}s)...")

    start = time.perf_counter()

    for poll in range(max_polls):
        elapsed_min = (time.perf_counter() - start) / 60
        if poll > 0 and poll % 4 == 0:
            _emit("log", f"Session timeout watch: {elapsed_min:.1f} min elapsed, "
                  f"no prompt yet...")

        # Check for any visible modal/dialog
        for sel in prompt_selectors:
            try:
                el = page.query_selector(sel)
                if el and el.is_visible():
                    text = (el.inner_text() or "").strip().lower()
                    if any(kw in text for kw in session_keywords):
                        result["prompt_found"] = True
                        result["prompt_text"] = (el.inner_text() or "").strip()[:200]
                        result["waited_ms"] = int((time.perf_counter() - start) * 1000)

                        # Look for Continue / Extend button
                        continue_selectors = [
                            'button:has-text("Continue")',
                            'button:has-text("Extend")',
                            'button:has-text("Stay")',
                            'button:has-text("Yes")',
                            'button:has-text("OK")',
                            'button:has-text("Keep")',
                            'a:has-text("Continue")',
                            '[class*="primary"]',
                        ]
                        for btn_sel in continue_selectors:
                            try:
                                btn = page.query_selector(btn_sel)
                                if btn and btn.is_visible():
                                    result["continue_button_found"] = True
                                    break
                            except Exception:
                                continue

                        return result
            except Exception:
                continue

        # Also scan for text that just appeared anywhere on the page
        try:
            page_text = page.evaluate("""() => {
                const modals = document.querySelectorAll(
                    '[role="dialog"], [role="alertdialog"], [class*="modal"], '
                    + '[class*="Modal"], [class*="dialog"], [class*="Dialog"], '
                    + '[class*="popup"], [class*="Popup"], [class*="overlay"]'
                );
                for (const m of modals) {
                    if (m.offsetParent !== null || getComputedStyle(m).display !== 'none') {
                        return (m.innerText || '').trim().substring(0, 300);
                    }
                }
                return '';
            }""")
            if page_text:
                lower = page_text.lower()
                if any(kw in lower for kw in session_keywords):
                    result["prompt_found"] = True
                    result["prompt_text"] = page_text[:200]
                    result["waited_ms"] = int((time.perf_counter() - start) * 1000)
                    result["continue_button_found"] = "continue" in lower or "extend" in lower
                    return result
        except Exception:
            pass

        page.wait_for_timeout(poll_interval_ms)

    result["waited_ms"] = int((time.perf_counter() - start) * 1000)
    return result


def _click_continue_session(page) -> str | None:
    """Click the Continue / Extend / Stay button on the session timeout prompt."""
    selectors = [
        'button:has-text("Continue")',
        'button:has-text("Extend")',
        'button:has-text("Stay")',
        'button:has-text("Keep")',
        'button:has-text("Yes")',
        'button:has-text("OK")',
        'a:has-text("Continue")',
        'a:has-text("Extend")',
        '[role="dialog"] button[class*="primary"]',
        '[role="alertdialog"] button[class*="primary"]',
        '[class*="modal"] button[class*="primary"]',
        '[class*="Modal"] button[class*="primary"]',
    ]
    for sel in selectors:
        try:
            el = page.query_selector(sel)
            if el and el.is_visible():
                text = (el.inner_text() or "").strip()[:30] or "Continue"
                el.click()
                return text
        except Exception:
            continue
    return None


# ── Crawl Engine ─────────────────────────────────────────────────────────────

def _crawl_application(page, base_url: str, _emit, output_dir: Path, domain: str) -> CrawlResult:
    """Crawl the current page to discover navigation, forms, buttons, and internal links."""
    _emit("log", "Starting application crawl...")
    crawl = CrawlResult()
    crawl.current_url = page.url
    crawl.page_title = page.title()

    parsed_base = urlparse(base_url)
    base_origin = f"{parsed_base.scheme}://{parsed_base.netloc}"

    # Discover navigation items
    _emit("log", "Crawl: Discovering navigation elements...")
    try:
        nav_items = page.evaluate("""(baseOrigin) => {
            const items = [];
            const navEls = document.querySelectorAll(
                'nav a, [role="navigation"] a, header a, .sidebar a, .menu a, '
                + '.nav a, .navbar a, [class*="nav"] a, [class*="menu"] a, '
                + '[class*="sidebar"] a, aside a'
            );
            const seen = new Set();
            navEls.forEach(a => {
                const href = a.href || a.getAttribute('href') || '';
                const text = (a.innerText || a.textContent || '').trim().substring(0, 60);
                if (href && text && !seen.has(href) && !href.startsWith('javascript:')
                    && !href.startsWith('#') && !href.startsWith('mailto:')) {
                    seen.add(href);
                    items.push({
                        text: text,
                        href: href,
                        is_internal: href.startsWith(baseOrigin) || href.startsWith('/'),
                    });
                }
            });
            return items;
        }""", base_origin)
        crawl.navigation_items = nav_items[:50]
        _emit("log", f"Crawl: Found {len(nav_items)} navigation item(s)")
    except Exception as exc:
        log.warning("Nav crawl failed: %s", exc)

    # Discover all internal page links
    _emit("log", "Crawl: Discovering internal page links...")
    try:
        all_links = page.evaluate("""(baseOrigin) => {
            const links = [];
            const seen = new Set();
            document.querySelectorAll('a[href]').forEach(a => {
                const href = a.href || '';
                const text = (a.innerText || '').trim().substring(0, 60);
                if (href && !seen.has(href) && (href.startsWith(baseOrigin) || href.startsWith('/'))
                    && !href.startsWith('javascript:') && !href.startsWith('#')
                    && !href.startsWith('mailto:')) {
                    seen.add(href);
                    links.push({ text: text || href, href: href });
                }
            });
            return links;
        }""", base_origin)
        crawl.pages_discovered = all_links[:100]
        _emit("log", f"Crawl: Found {len(all_links)} internal link(s)")
    except Exception as exc:
        log.warning("Link crawl failed: %s", exc)

    # Discover forms
    _emit("log", "Crawl: Discovering forms...")
    try:
        forms = page.evaluate("""() => {
            const forms = [];
            document.querySelectorAll('form').forEach((f, idx) => {
                const inputs = [];
                f.querySelectorAll('input, select, textarea').forEach(el => {
                    inputs.push({
                        tag: el.tagName.toLowerCase(),
                        type: el.type || '',
                        name: el.name || el.id || '',
                        placeholder: el.placeholder || '',
                    });
                });
                forms.push({
                    id: f.id || f.name || 'form-' + idx,
                    action: f.action || '',
                    method: f.method || 'GET',
                    inputs: inputs,
                });
            });
            return forms;
        }""")
        crawl.forms = forms[:20]
        _emit("log", f"Crawl: Found {len(forms)} form(s)")
    except Exception as exc:
        log.warning("Form crawl failed: %s", exc)

    # Discover buttons and interactive elements
    _emit("log", "Crawl: Discovering interactive elements...")
    try:
        buttons = page.evaluate("""() => {
            const btns = [];
            const seen = new Set();
            document.querySelectorAll(
                'button, [role="button"], input[type="submit"], input[type="button"], '
                + '[class*="btn"], [class*="button"]'
            ).forEach(el => {
                const text = (el.innerText || el.value || el.title || el.getAttribute('aria-label') || '').trim().substring(0, 60);
                if (text && !seen.has(text)) {
                    seen.add(text);
                    btns.push({
                        text: text,
                        tag: el.tagName.toLowerCase(),
                        type: el.type || '',
                        id: el.id || '',
                        disabled: el.disabled || false,
                    });
                }
            });
            return btns;
        }""")
        crawl.buttons = buttons[:30]
        _emit("log", f"Crawl: Found {len(buttons)} button(s)/interactive element(s)")
    except Exception as exc:
        log.warning("Button crawl failed: %s", exc)

    # Discover headings
    try:
        headings = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('h1, h2, h3, h4'))
                .map(h => h.innerText.trim().substring(0, 80))
                .filter(t => t.length > 0);
        }""")
        crawl.headings = headings[:20]
    except Exception:
        pass

    _emit("log", f"Crawl complete — {len(crawl.pages_discovered)} pages, "
          f"{len(crawl.navigation_items)} nav items, {len(crawl.forms)} forms, "
          f"{len(crawl.buttons)} buttons")
    _emit("crawl", crawl.to_dict())

    return crawl


# ── Scenario Generator ──────────────────────────────────────────────────────

def _generate_scenarios(crawl: CrawlResult, base_url: str) -> list[SmokeCheck]:
    """Auto-generate smoke test scenarios from crawl data."""
    scenarios: list[SmokeCheck] = []
    idx = 12  # Continue from SM-011

    # Navigate to discovered internal pages (up to 10)
    internal_links = [p for p in crawl.pages_discovered if p.get("href")]
    for page_info in internal_links[:10]:
        idx += 1
        scenarios.append(SmokeCheck(
            id=f"SM-{idx:03d}",
            title=f"Navigate to: {page_info.get('text', page_info['href'][:50])}",
            detail=page_info["href"],
        ))

    # Click navigation menu items (up to 8)
    for nav in crawl.navigation_items[:8]:
        if nav.get("is_internal") and nav.get("href") not in [s.detail for s in scenarios]:
            idx += 1
            scenarios.append(SmokeCheck(
                id=f"SM-{idx:03d}",
                title=f"Nav menu: {nav.get('text', 'Unknown')}",
                detail=nav["href"],
            ))

    # Verify buttons are visible and clickable (non-destructive, up to 5)
    for btn in crawl.buttons[:5]:
        if not btn.get("disabled") and btn.get("text"):
            btn_text = btn["text"]
            if any(kw in btn_text.lower() for kw in ("delete", "remove", "drop", "destroy")):
                continue
            idx += 1
            scenarios.append(SmokeCheck(
                id=f"SM-{idx:03d}",
                title=f"Button visible: \"{btn_text}\"",
                detail=json.dumps(btn),
            ))

    # Verify forms are present and have expected fields
    for form in crawl.forms[:3]:
        idx += 1
        input_names = [i.get("name") or i.get("placeholder") for i in form.get("inputs", [])]
        scenarios.append(SmokeCheck(
            id=f"SM-{idx:03d}",
            title=f"Form present: {form.get('id', 'unknown')}",
            detail=f"Fields: {', '.join(input_names[:5])}",
        ))

    return scenarios


def _execute_scenario(page, context, scenario: SmokeCheck, base_url: str,
                      output_dir: Path, domain: str, _emit) -> None:
    """Execute a single generated scenario."""
    start = time.perf_counter()
    title_lower = scenario.title.lower()

    try:
        if title_lower.startswith("navigate to:") or title_lower.startswith("nav menu:"):
            target_url = scenario.detail
            if not target_url.startswith("http"):
                target_url = urljoin(base_url, target_url)

            resp = page.goto(target_url, wait_until="domcontentloaded", timeout=15000)
            elapsed = int((time.perf_counter() - start) * 1000)
            scenario.duration_ms = elapsed

            if resp and resp.ok:
                page_title = page.title()
                scenario.status = "pass"
                scenario.detail = f"HTTP {resp.status} — \"{page_title}\" loaded in {elapsed}ms"
            elif resp:
                scenario.status = "fail"
                scenario.detail = f"HTTP {resp.status} {resp.status_text}"
            else:
                scenario.status = "fail"
                scenario.detail = "No response received"

            # Navigate back to base after checking
            try:
                page.go_back(wait_until="domcontentloaded", timeout=10000)
            except Exception:
                page.goto(base_url, wait_until="domcontentloaded", timeout=10000)

        elif title_lower.startswith("button visible:"):
            btn_info = json.loads(scenario.detail)
            btn_text = btn_info.get("text", "")
            elapsed = 0

            selectors = []
            if btn_info.get("id"):
                selectors.append(f"#{btn_info['id']}")
            selectors.append(f'button:has-text("{btn_text}")')
            selectors.append(f'[role="button"]:has-text("{btn_text}")')
            selectors.append(f'input[value="{btn_text}"]')

            found = False
            for sel in selectors:
                try:
                    el = page.query_selector(sel)
                    if el and el.is_visible():
                        elapsed = int((time.perf_counter() - start) * 1000)
                        scenario.status = "pass"
                        scenario.detail = f'Button "{btn_text}" is visible and accessible'
                        scenario.duration_ms = elapsed
                        found = True
                        break
                except Exception:
                    continue

            if not found:
                scenario.status = "warn"
                scenario.detail = f'Button "{btn_text}" not found or not visible'
                scenario.duration_ms = int((time.perf_counter() - start) * 1000)

        elif title_lower.startswith("form present:"):
            form_id = scenario.title.split(": ", 1)[1] if ": " in scenario.title else ""
            selectors = [f"form#{form_id}", f'form[name="{form_id}"]', "form"]

            found = False
            for sel in selectors:
                try:
                    el = page.query_selector(sel)
                    if el:
                        inputs = el.query_selector_all("input, select, textarea")
                        elapsed = int((time.perf_counter() - start) * 1000)
                        scenario.status = "pass"
                        scenario.detail = f"Form found with {len(inputs)} field(s)"
                        scenario.duration_ms = elapsed
                        found = True
                        break
                except Exception:
                    continue

            if not found:
                scenario.status = "warn"
                scenario.detail = f"Form '{form_id}' not found"
                scenario.duration_ms = int((time.perf_counter() - start) * 1000)

        else:
            scenario.status = "warn"
            scenario.detail = "Scenario type not recognized"
            scenario.duration_ms = int((time.perf_counter() - start) * 1000)

    except Exception as exc:
        scenario.status = "fail"
        scenario.detail = str(exc)[:200]
        scenario.duration_ms = int((time.perf_counter() - start) * 1000)

    _take_step_screenshot(page, scenario, output_dir, domain)
    _emit("check", {
        "id": scenario.id, "title": scenario.title,
        "status": scenario.status, "detail": scenario.detail,
        "duration_ms": scenario.duration_ms,
    })


# ── HTML Report Generator ────────────────────────────────────────────────────

def _generate_html_report(report: SmokeReport, output_dir: Path, domain: str) -> str:
    """Generate a styled HTML report and return its file path."""
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"smoke_report_{domain}_{ts}.html"
    filepath = output_dir / filename

    checks_html = ""
    for c in report.checks:
        status_cls = {"pass": "pass", "fail": "fail", "warn": "warn"}.get(c.status, "")
        status_icon = {"pass": "&#10003;", "fail": "&#10007;", "warn": "&#9888;"}.get(c.status, "?")
        screenshot_block = ""
        if c.screenshot_b64:
            screenshot_block = (
                f'<details class="screenshot-toggle"><summary>Screenshot</summary>'
                f'<img src="data:image/png;base64,{c.screenshot_b64}" alt="{c.id}" /></details>'
            )
        checks_html += f"""
        <tr class="row-{status_cls}">
          <td class="status-cell"><span class="status-icon {status_cls}">{status_icon}</span></td>
          <td class="id-cell">{c.id}</td>
          <td>{html_mod.escape(c.title)}</td>
          <td class="detail-cell">{html_mod.escape(c.detail)}</td>
          <td class="time-cell">{c.duration_ms}ms</td>
        </tr>
        {f'<tr><td colspan="5">{screenshot_block}</td></tr>' if screenshot_block else ''}"""

    console_html = ""
    if report.console_errors:
        items = "".join(f"<li>{html_mod.escape(e)}</li>" for e in report.console_errors[:30])
        console_html = f'<div class="section"><h3>Console Errors ({len(report.console_errors)})</h3><ul>{items}</ul></div>'

    network_html = ""
    if report.network_failures:
        items = "".join(f"<li>{html_mod.escape(e)}</li>" for e in report.network_failures[:30])
        network_html = f'<div class="section"><h3>Network Failures ({len(report.network_failures)})</h3><ul>{items}</ul></div>'

    final_screenshot = ""
    if report.screenshot_b64:
        final_screenshot = (
            f'<div class="section"><h3>Final Page Screenshot</h3>'
            f'<img src="data:image/png;base64,{report.screenshot_b64}" class="final-screenshot" /></div>'
        )

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Smoke Test Report — {html_mod.escape(report.url)}</title>
<style>
:root {{ --bg: #0f1117; --surface: #1a1d27; --border: #2a2e3f; --text: #e4e6ed;
  --muted: #8b8fa3; --pass: #51cf66; --fail: #ff6b6b; --warn: #ffd93d;
  --primary: #6c63ff; --accent: #00d4aa; --font: 'Segoe UI', sans-serif;
  --mono: 'Cascadia Code', 'Consolas', monospace; }}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: var(--font); background: var(--bg); color: var(--text); padding: 32px; }}
h1 {{ font-size: 1.5rem; background: linear-gradient(135deg, var(--primary), var(--accent));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 4px; }}
.subtitle {{ color: var(--muted); font-size: 0.85rem; }}
.header {{ margin-bottom: 32px; }}
.summary {{ display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 28px; }}
.stat {{ padding: 8px 20px; border-radius: 99px; font-size: 0.85rem; font-weight: 600; }}
.stat-pass {{ background: rgba(81,207,102,0.12); color: var(--pass); }}
.stat-fail {{ background: rgba(255,107,107,0.12); color: var(--fail); }}
.stat-warn {{ background: rgba(255,217,61,0.12); color: var(--warn); }}
.stat-time {{ background: rgba(108,99,255,0.1); color: var(--primary); }}
.stat-total {{ background: rgba(0,212,170,0.1); color: var(--accent); }}
table {{ width: 100%; border-collapse: collapse; margin-bottom: 24px; }}
th {{ background: var(--surface); color: var(--accent); text-align: left; padding: 12px 16px;
  font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid var(--border); }}
td {{ padding: 10px 16px; border-bottom: 1px solid var(--border); font-size: 0.85rem; vertical-align: top; }}
.row-pass {{ border-left: 3px solid var(--pass); }}
.row-fail {{ border-left: 3px solid var(--fail); }}
.row-warn {{ border-left: 3px solid var(--warn); }}
.status-icon {{ display: inline-block; width: 22px; text-align: center; font-size: 1rem; }}
.status-icon.pass {{ color: var(--pass); }}
.status-icon.fail {{ color: var(--fail); }}
.status-icon.warn {{ color: var(--warn); }}
.id-cell {{ font-family: var(--mono); font-weight: 600; color: var(--muted); white-space: nowrap; }}
.detail-cell {{ font-family: var(--mono); font-size: 0.8rem; color: var(--muted); word-break: break-word; }}
.time-cell {{ font-family: var(--mono); font-size: 0.78rem; color: var(--muted); white-space: nowrap; }}
.section {{ background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  padding: 20px 24px; margin-bottom: 16px; }}
.section h3 {{ font-size: 0.9rem; color: var(--warn); margin-bottom: 12px; }}
.section ul {{ list-style: none; }}
.section li {{ padding: 6px 10px; background: var(--bg); border: 1px solid var(--border);
  border-radius: 6px; margin-bottom: 4px; font-family: var(--mono); font-size: 0.78rem; color: var(--muted); }}
.final-screenshot {{ max-width: 100%; border-radius: 8px; border: 1px solid var(--border); }}
.screenshot-toggle summary {{ color: var(--primary); font-size: 0.78rem; cursor: pointer; padding: 4px 0; }}
.screenshot-toggle img {{ max-width: 100%; border-radius: 8px; margin-top: 8px; border: 1px solid var(--border); }}
.url-tag {{ padding: 4px 12px; border-radius: 6px; font-size: 0.78rem; font-family: var(--mono);
  background: rgba(108,99,255,0.12); color: var(--primary); }}
.bar-container {{ display: flex; height: 8px; border-radius: 4px; overflow: hidden;
  background: var(--border); margin-bottom: 28px; }}
.bar {{ height: 100%; }}
.bar-pass {{ background: var(--pass); }}
.bar-fail {{ background: var(--fail); }}
.bar-warn {{ background: var(--warn); }}
.footer {{ margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border);
  color: var(--muted); font-size: 0.78rem; text-align: center; }}
</style>
</head>
<body>
<div class="header">
  <h1>Smoke Test Report</h1>
  <p class="subtitle">Generated by QA OneShop Stop &mdash; Playwright</p>
  <p style="margin-top:8px;"><span class="url-tag">{html_mod.escape(report.url)}</span>
     &nbsp; {report.timestamp}</p>
</div>
<div class="summary">
  <span class="stat stat-total">{len(report.checks)} Total</span>
  <span class="stat stat-pass">{report.passed} Passed</span>
  <span class="stat stat-fail">{report.failed} Failed</span>
  <span class="stat stat-warn">{report.warnings} Warnings</span>
  <span class="stat stat-time">&#9201; {report.total_duration_ms}ms</span>
</div>
<div class="bar-container">
  <div class="bar bar-pass" style="width:{report.passed / max(len(report.checks),1) * 100:.1f}%"></div>
  <div class="bar bar-fail" style="width:{report.failed / max(len(report.checks),1) * 100:.1f}%"></div>
  <div class="bar bar-warn" style="width:{report.warnings / max(len(report.checks),1) * 100:.1f}%"></div>
</div>
<table>
<thead><tr><th></th><th>ID</th><th>Test</th><th>Detail</th><th>Time</th></tr></thead>
<tbody>{checks_html}</tbody>
</table>
{console_html}
{network_html}
{final_screenshot}
<div class="footer">
  QA OneShop Stop &mdash; Smoke Test Report &mdash; {report.timestamp}
</div>
</body></html>"""

    filepath.write_text(html_content, encoding="utf-8")
    log.info("HTML report saved: %s", filepath)
    return str(filepath)


# ── Main Runner ──────────────────────────────────────────────────────────────

def run_smoke_test(url: str, on_progress=None, credentials: dict | None = None) -> dict:
    """Execute a full smoke test suite with crawl-driven scenario generation.

    Args:
        url: Target URL to test.
        on_progress: Optional callback ``(event_type, data)``.
        credentials: Optional dict with ``user_id`` and ``password``.
    """
    from playwright.sync_api import sync_playwright

    def _emit(event_type: str, data):
        if on_progress:
            try:
                on_progress(event_type, data)
            except Exception:
                pass

    report = SmokeReport(url=url, timestamp=datetime.utcnow().isoformat() + "Z")
    suite_start = time.perf_counter()
    _emit("log", f"Starting smoke test suite for {url}")
    if credentials and credentials.get("user_id"):
        _emit("log", f"Credentials provided for: {credentials['user_id']}")

    console_errors: list[str] = []
    network_failures: list[str] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1280, "height": 720},
            ignore_https_errors=True,
        )
        page = context.new_page()

        output_dir = Path(Config.OUTPUT_DIR)
        output_dir.mkdir(parents=True, exist_ok=True)
        domain = urlparse(url).netloc.replace(".", "_").replace(":", "_")

        page.on("console", lambda msg: (
            console_errors.append(f"[{msg.type}] {msg.text}")
            if msg.type in ("error", "warning") else None
        ))
        page.on("requestfailed", lambda req: (
            network_failures.append(f"{req.method} {req.url} — {req.failure}")
        ))

        failed_responses: list[str] = []
        page.on("response", lambda resp: (
            failed_responses.append(f"{resp.status} {resp.url}")
            if resp.status >= 400 else None
        ))

        iam_api_base_urls: list[str] = []
        def _capture_iam_url(resp):
            if "/v1/auth/" in resp.url:
                base = resp.url.split("/v1/auth/")[0]
                if base not in iam_api_base_urls:
                    iam_api_base_urls.append(base)
        page.on("response", _capture_iam_url)

        # ── SM-001  Page Load ────────────────────────────
        _emit("log", "Running SM-001: Navigating to target URL...")
        check = SmokeCheck(id="SM-001", title="Page loads successfully")
        try:
            def _navigate():
                return page.goto(url, wait_until="domcontentloaded", timeout=30000)
            response, elapsed = _timed(_navigate)
            check.duration_ms = elapsed
            if response and response.ok:
                check.status = "pass"
                check.detail = f"HTTP {response.status} — loaded in {elapsed}ms"
            elif response:
                check.status = "fail"
                check.detail = f"HTTP {response.status} {response.status_text}"
            else:
                check.status = "fail"
                check.detail = "No response received"
        except Exception as exc:
            check.status = "fail"
            check.detail = str(exc)
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        if check.status == "fail":
            report.total_duration_ms = int((time.perf_counter() - suite_start) * 1000)
            report.console_errors = console_errors
            report.network_failures = network_failures
            report.report_path = _generate_html_report(report, output_dir, domain)
            browser.close()
            _emit("complete", report.to_dict())
            return report.to_dict()

        # Dismiss consent popup
        _emit("log", "Checking for consent popups...")
        try:
            _dismiss_consent_popup(page)
        except Exception as exc:
            log.warning("Consent popup error: %s", exc)

        # ── Login ────────────────────────────────────────
        _emit("log", "Checking for login prompts...")
        auth_token = None
        try:
            _handle_login(page, credentials, url)
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                page.wait_for_timeout(5000)
            page.wait_for_timeout(3000)
            log.info("Post-login — page at %s", page.url)

            auth_token = _extract_auth_token(page, context)
            _emit("log", "Auth token captured" if auth_token else "No auth token found")
        except Exception as exc:
            log.warning("Login error: %s", exc)
            _emit("log", f"Login error: {exc}")

        # ── SM-002  Page Title ───────────────────────────
        _emit("log", "Running SM-002: Checking page title...")
        check = SmokeCheck(id="SM-002", title="Page has a title")
        try:
            title, elapsed = _timed(lambda: page.title())
            check.duration_ms = elapsed
            check.status = "pass" if title.strip() else "warn"
            check.detail = f'Title: "{title}"' if title.strip() else "Page title is empty"
        except Exception as exc:
            check.status = "fail"
            check.detail = str(exc)
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-003  Console Errors ───────────────────────
        _emit("log", "Running SM-003: Checking console errors...")
        page.wait_for_timeout(1500)
        check = SmokeCheck(id="SM-003", title="No JavaScript console errors")
        js_errors = [e for e in console_errors if e.startswith("[error]")]
        check.status = "pass" if not js_errors else "warn"
        check.detail = "No console errors" if not js_errors else f"{len(js_errors)} console error(s)"
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-004  Meta Viewport ────────────────────────
        _emit("log", "Running SM-004: Checking meta viewport tag...")
        check = SmokeCheck(id="SM-004", title="Meta viewport tag present")
        try:
            el, elapsed = _timed(lambda: page.query_selector('meta[name="viewport"]'))
            check.duration_ms = elapsed
            if el:
                check.status = "pass"
                check.detail = f'content="{el.get_attribute("content")}"'
            else:
                check.status = "warn"
                check.detail = 'No <meta name="viewport"> found'
        except Exception as exc:
            check.status = "fail"
            check.detail = str(exc)
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-005  Heading Structure ────────────────────
        _emit("log", "Running SM-005: Checking heading structure...")
        check = SmokeCheck(id="SM-005", title="Page contains heading elements")
        try:
            headings, elapsed = _timed(lambda: page.query_selector_all("h1, h2, h3"))
            check.duration_ms = elapsed
            if headings:
                texts = [h.inner_text().strip()[:50] for h in headings[:5]]
                check.status = "pass"
                check.detail = f'{len(headings)} heading(s): {", ".join(texts)}'
            else:
                check.status = "warn"
                check.detail = "No <h1>–<h3> elements found"
        except Exception as exc:
            check.status = "fail"
            check.detail = str(exc)
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-006  Links Validation ─────────────────────
        _emit("log", "Running SM-006: Validating links...")
        check = SmokeCheck(id="SM-006", title="All links have valid href attributes")
        try:
            links, elapsed = _timed(lambda: page.eval_on_selector_all(
                "a[href]",
                """els => els.map(a => ({
                    href: a.getAttribute('href'),
                    text: (a.innerText || '').trim().substring(0, 40)
                }))""",
            ))
            check.duration_ms = elapsed
            broken = [l for l in links if not l["href"] or l["href"].startswith("javascript:void")]
            if not links:
                check.status = "warn"
                check.detail = "No links found"
            elif broken:
                check.status = "warn"
                check.detail = f"{len(broken)} of {len(links)} link(s) have empty/void hrefs"
            else:
                check.status = "pass"
                check.detail = f"All {len(links)} link(s) valid"
        except Exception as exc:
            check.status = "fail"
            check.detail = str(exc)
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-007  Images Alt Text ──────────────────────
        _emit("log", "Running SM-007: Checking image alt attributes...")
        check = SmokeCheck(id="SM-007", title="Images have alt attributes")
        try:
            images, elapsed = _timed(lambda: page.eval_on_selector_all(
                "img", "els => els.map(i => ({ src: i.src, alt: i.alt }))",
            ))
            check.duration_ms = elapsed
            if not images:
                check.status = "pass"
                check.detail = "No images on the page"
            else:
                missing = [i for i in images if not i.get("alt")]
                check.status = "warn" if missing else "pass"
                check.detail = (f"{len(missing)} of {len(images)} missing alt text" if missing
                                else f"All {len(images)} image(s) have alt attributes")
        except Exception as exc:
            check.status = "fail"
            check.detail = str(exc)
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-008  Network Failures ─────────────────────
        _emit("log", "Running SM-008: Checking network failures...")
        check = SmokeCheck(id="SM-008", title="No failed network requests")
        all_failures = network_failures + failed_responses
        check.status = "pass" if not all_failures else "warn"
        check.detail = ("No failed network requests" if not all_failures
                        else f"{len(all_failures)} failed request(s)")
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-009  Interactive Elements ─────────────────
        _emit("log", "Running SM-009: Checking interactive elements...")
        check = SmokeCheck(id="SM-009", title="Interactive elements are present")
        try:
            count, elapsed = _timed(lambda: page.eval_on_selector_all(
                "button, input, select, textarea, [role='button']", "els => els.length",
            ))
            check.duration_ms = elapsed
            check.status = "pass" if count > 0 else "warn"
            check.detail = (f"{count} interactive element(s)" if count > 0
                            else "No interactive elements found")
        except Exception as exc:
            check.status = "fail"
            check.detail = str(exc)
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-010  Page Performance ─────────────────────
        _emit("log", "Running SM-010: Measuring page performance...")
        check = SmokeCheck(id="SM-010", title="Page load performance within threshold")
        try:
            perf, elapsed = _timed(lambda: page.evaluate("""() => {
                const t = performance.timing;
                return {
                    dns: t.domainLookupEnd - t.domainLookupStart,
                    connect: t.connectEnd - t.connectStart,
                    ttfb: t.responseStart - t.navigationStart,
                    dom_ready: t.domContentLoadedEventEnd - t.navigationStart,
                    load: t.loadEventEnd - t.navigationStart
                };
            }"""))
            check.duration_ms = elapsed
            load_time = perf.get("load", 0) or perf.get("dom_ready", 0)
            if load_time <= 0:
                check.status = "pass"
                check.detail = f"DOM ready: {perf.get('dom_ready', '?')}ms"
            elif load_time < 3000:
                check.status = "pass"
                check.detail = f"Load: {load_time}ms, TTFB: {perf.get('ttfb', '?')}ms"
            elif load_time < 5000:
                check.status = "warn"
                check.detail = f"Slow load: {load_time}ms (threshold 3s)"
            else:
                check.status = "fail"
                check.detail = f"Very slow: {load_time}ms (threshold 5s)"
        except Exception:
            check.status = "pass"
            check.detail = "Performance API not available (SPA)"
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-011  Validate Token ───────────────────────
        _emit("log", "Running SM-011: Validating auth token endpoint...")
        check = SmokeCheck(id="SM-011", title="validate-token endpoint returns 200")
        if not auth_token:
            check.status = "fail"
            check.detail = "No auth token available"
        elif not iam_api_base_urls:
            check.status = "fail"
            check.detail = "IAM API base URL not discovered"
        else:
            try:
                validate_url = f"{iam_api_base_urls[0]}/v1/auth/validate-token"
                def _validate():
                    return page.evaluate("""async (args) => {
                        const resp = await fetch(args.url, {
                            method: 'GET',
                            headers: { 'Authorization': 'Bearer ' + args.token, 'Accept': 'application/json' }
                        });
                        let body = null;
                        try { body = await resp.json(); } catch {}
                        return { status: resp.status, ok: resp.ok, statusText: resp.statusText, body: body };
                    }""", {"url": validate_url, "token": auth_token})
                result, elapsed = _timed(_validate)
                check.duration_ms = elapsed
                status = result.get("status", 0)
                check.status = "pass" if status == 200 else "fail"
                check.detail = (f"HTTP {status} — token valid" if status == 200
                                else f"HTTP {status} {result.get('statusText', '')}")
            except Exception as exc:
                check.status = "fail"
                check.detail = f"Failed: {exc}"
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-012  Select a Client ──────────────────────
        _emit("log", "Running SM-012: Selecting a client from the client list...")
        check = SmokeCheck(id="SM-012", title="Select a client from the client list")
        home_url = page.url
        try:
            start = time.perf_counter()
            client_el = _find_and_click_client(page)
            elapsed = int((time.perf_counter() - start) * 1000)
            check.duration_ms = elapsed
            if client_el:
                page.wait_for_timeout(3000)
                check.status = "pass"
                check.detail = f'Selected client: "{client_el}" — navigated to {page.url}'
            else:
                check.status = "warn"
                check.detail = "No client card/item found on the page"
        except Exception as exc:
            check.status = "fail"
            check.detail = str(exc)[:200]
            check.duration_ms = int((time.perf_counter() - start) * 1000)
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-013  Click a Quick Link ───────────────────
        _emit("log", "Running SM-013: Clicking a Quick Link...")
        check = SmokeCheck(id="SM-013", title="Click a link under Quick Links")
        try:
            start = time.perf_counter()
            ql_text = _find_and_click_quick_link(page)
            elapsed = int((time.perf_counter() - start) * 1000)
            check.duration_ms = elapsed
            if ql_text:
                page.wait_for_timeout(3000)
                check.status = "pass"
                check.detail = f'Clicked Quick Link: "{ql_text}" — page at {page.url}'
            else:
                check.status = "warn"
                check.detail = "No Quick Links section found on the page"
        except Exception as exc:
            check.status = "fail"
            check.detail = str(exc)[:200]
            check.duration_ms = int((time.perf_counter() - start) * 1000)
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # Navigate back before hamburger test
        try:
            page.go_back(wait_until="domcontentloaded", timeout=10000)
            page.wait_for_timeout(2000)
        except Exception:
            pass

        # ── SM-014  Hamburger Menu Navigation ────────────
        _emit("log", "Running SM-014: Opening hamburger menu and clicking a link...")
        check = SmokeCheck(id="SM-014", title="Access a link from the hamburger menu")
        try:
            start = time.perf_counter()
            menu_text = _open_hamburger_and_click(page)
            elapsed = int((time.perf_counter() - start) * 1000)
            check.duration_ms = elapsed
            if menu_text:
                page.wait_for_timeout(3000)
                check.status = "pass"
                check.detail = f'Hamburger menu item: "{menu_text}" — page at {page.url}'
            else:
                check.status = "warn"
                check.detail = "No hamburger menu found on the page"
        except Exception as exc:
            check.status = "fail"
            check.detail = str(exc)[:200]
            check.duration_ms = int((time.perf_counter() - start) * 1000)
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-015  Header Click — Navigate Home ─────────
        _emit("log", "Running SM-015: Clicking header/logo to navigate back to home...")
        check = SmokeCheck(id="SM-015", title="Click header/logo to navigate back to home")
        try:
            start = time.perf_counter()
            header_text = _click_header_to_home(page, url)
            elapsed = int((time.perf_counter() - start) * 1000)
            check.duration_ms = elapsed
            if header_text:
                page.wait_for_timeout(3000)
                current = page.url
                check.status = "pass"
                check.detail = f'Clicked header "{header_text}" — returned to {current}'
            else:
                check.status = "warn"
                check.detail = "No clickable header/logo found"
        except Exception as exc:
            check.status = "fail"
            check.detail = str(exc)[:200]
            check.duration_ms = int((time.perf_counter() - start) * 1000)
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-016  Session Timeout Prompt (25-min wait) ──
        _emit("log", "Running SM-016: Waiting for session timeout warning prompt...")
        _emit("log", "Session timeout: app expires at 30 min, prompt expected at ~25 min")
        check = SmokeCheck(id="SM-016", title="Session timeout prompt appears before expiry")
        start = time.perf_counter()
        try:
            timeout_result = _detect_session_timeout_prompt(page, wait_minutes=26, _emit=_emit)
            check.duration_ms = timeout_result["waited_ms"]

            if timeout_result["prompt_found"]:
                check.status = "pass"
                waited_min = timeout_result["waited_ms"] / 60000
                check.detail = (
                    f'Timeout prompt appeared after {waited_min:.1f} min — '
                    f'"{timeout_result["prompt_text"][:80]}"'
                )
                if timeout_result["continue_button_found"]:
                    check.detail += " (Continue button found)"
            else:
                check.status = "warn"
                waited_min = timeout_result["waited_ms"] / 60000
                check.detail = f"No session timeout prompt detected after waiting {waited_min:.1f} min"
        except Exception as exc:
            check.status = "fail"
            check.detail = str(exc)[:200]
            check.duration_ms = int((time.perf_counter() - start) * 1000)
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-017  Continue Session (dismiss prompt) ────
        _emit("log", "Running SM-017: Clicking Continue to extend the session...")
        check = SmokeCheck(id="SM-017", title="Continue/Extend session from timeout prompt")
        start = time.perf_counter()
        try:
            btn_text = _click_continue_session(page)
            elapsed = int((time.perf_counter() - start) * 1000)
            check.duration_ms = elapsed

            if btn_text:
                page.wait_for_timeout(3000)
                # Verify the page is still functional after continuing
                still_ok = not _needs_login(page.url) and not _has_login_form(page)
                if still_ok:
                    check.status = "pass"
                    check.detail = (
                        f'Clicked "{btn_text}" — session extended, '
                        f'page still active at {page.url}'
                    )
                else:
                    check.status = "fail"
                    check.detail = (
                        f'Clicked "{btn_text}" but redirected to login — '
                        f'session was not extended'
                    )
            else:
                check.status = "warn"
                check.detail = "No Continue/Extend button found (prompt may not have appeared)"
        except Exception as exc:
            check.status = "fail"
            check.detail = str(exc)[:200]
            check.duration_ms = int((time.perf_counter() - start) * 1000)
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # ── SM-018  Logout ───────────────────────────────
        _emit("log", "Running SM-018: Performing logout...")
        check = SmokeCheck(id="SM-018", title="Logout successfully")
        start = time.perf_counter()
        try:
            logout_text = _find_and_click_logout(page)
            elapsed = int((time.perf_counter() - start) * 1000)
            check.duration_ms = elapsed

            if logout_text:
                page.wait_for_timeout(5000)
                current = page.url.lower()
                # Verify we landed on a login page or the app's landing page
                is_logged_out = (
                    _needs_login(current)
                    or _has_login_form(page)
                    or "login" in current
                    or "sign" in current
                    or "auth" in current
                    or "logout" in current
                    or "logged-out" in current
                )
                if is_logged_out:
                    check.status = "pass"
                    check.detail = (
                        f'Clicked "{logout_text}" — redirected to login/landing page: '
                        f'{page.url}'
                    )
                else:
                    check.status = "warn"
                    check.detail = (
                        f'Clicked "{logout_text}" — page at {page.url} '
                        f'(may not have fully logged out)'
                    )
            else:
                check.status = "warn"
                check.detail = "No logout/sign-out button found on the page"
        except Exception as exc:
            check.status = "fail"
            check.detail = str(exc)[:200]
            check.duration_ms = int((time.perf_counter() - start) * 1000)
        report.checks.append(check)
        _take_step_screenshot(page, check, output_dir, domain)
        _emit("check", {"id": check.id, "title": check.title, "status": check.status,
                        "detail": check.detail, "duration_ms": check.duration_ms})

        # Re-login for crawl phase (if credentials were provided and we logged out)
        if credentials and credentials.get("user_id"):
            try:
                _emit("log", "Re-logging in for crawl phase...")
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(2000)
                _handle_login(page, credentials, url)
                try:
                    page.wait_for_load_state("networkidle", timeout=15000)
                except Exception:
                    page.wait_for_timeout(5000)
                page.wait_for_timeout(2000)
            except Exception as exc:
                _emit("log", f"Re-login failed: {exc}")

        # ── CRAWL — Discover Application ─────────────────
        # Navigate back to the base URL before crawling
        try:
            if page.url != url:
                page.goto(url, wait_until="domcontentloaded", timeout=15000)
                page.wait_for_timeout(2000)
        except Exception:
            pass

        crawl_result = _crawl_application(page, url, _emit, output_dir, domain)
        report.crawl_result = crawl_result

        # ── Generate & Execute Dynamic Scenarios ─────────
        dynamic_scenarios = _generate_scenarios(crawl_result, url)
        if dynamic_scenarios:
            _emit("log", f"Generated {len(dynamic_scenarios)} dynamic smoke scenario(s) from crawl")
            _emit("scenarios", [{"id": s.id, "title": s.title} for s in dynamic_scenarios])

            for scenario in dynamic_scenarios:
                _emit("log", f"Running {scenario.id}: {scenario.title}...")
                _execute_scenario(page, context, scenario, url, output_dir, domain, _emit)
                report.checks.append(scenario)
        else:
            _emit("log", "No additional scenarios generated from crawl")

        # ── Final Screenshot ─────────────────────────────
        _emit("log", "Capturing final screenshot...")
        try:
            if page.url != url:
                page.goto(url, wait_until="domcontentloaded", timeout=10000)
                page.wait_for_timeout(1000)
            ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            screenshot_path = output_dir / f"smoke_{domain}_final_{ts}.png"
            screenshot_bytes = page.screenshot(full_page=False)
            screenshot_path.write_bytes(screenshot_bytes)
            report.screenshot_path = str(screenshot_path)
            report.screenshot_b64 = base64.b64encode(screenshot_bytes).decode("ascii")
        except Exception as exc:
            log.warning("Final screenshot failed: %s", exc)

        browser.close()

    report.console_errors = console_errors
    report.network_failures = network_failures
    report.total_duration_ms = int((time.perf_counter() - suite_start) * 1000)

    # Generate HTML report
    _emit("log", "Generating HTML report...")
    report.report_path = _generate_html_report(report, output_dir, domain)
    _emit("log", f"Report saved: {report.report_path}")

    _emit("log", f"Smoke test complete — {report.passed} passed, {report.failed} failed, "
          f"{report.warnings} warnings in {report.total_duration_ms}ms")
    _emit("complete", report.to_dict())
    return report.to_dict()
