# BugHunter.AI — Testing Guide

This guide walks through adding an application to BugHunter.AI and running an AI-powered bug scan against it.

---

## Sample Sites Included

| Site | URL | Credentials | Purpose |
|------|-----|-------------|---------|
| **OWASP Juice Shop** | http://localhost:3000 | admin@juice-sh.op / admin123 | Modern Node.js app with intentional OWASP Top 10 vulnerabilities |
| **DVWA** | http://localhost:8080 | admin / password | Classic PHP app with configurable vulnerability levels |

Both start automatically when you run `./start.sh` (Linux/macOS) or `./start.ps1` (Windows).

All three sample apps — including any app configured in `backend/.env` (e.g. Korn Ferry) — are **auto-registered** on startup. No manual registration needed.

---

## Prerequisites

1. BugHunter.AI is running (`./start.sh` completed successfully)
2. Both sample sites are accessible in your browser
3. You have registered and logged in to the BugHunter.AI frontend at http://localhost:5173

---

## Step 1 — Register an Account

1. Open http://localhost:5173
2. Click **Register**
3. Fill in your name, email, and password
4. You are automatically logged in after registering

---

## Step 2 — Add a New Application

Navigate to **Application Inventory** in the left sidebar and click **Add Application**.

### Adding OWASP Juice Shop

| Field | Value |
|-------|-------|
| **Application Name** | `OWASP Juice Shop` |
| **URL** | `http://localhost:3000` |
| **Authentication** | Smart Login (Auto) |
| **Email** | `admin@juice-sh.op` |
| **Password** | `admin123` |

Click **Save Application**.

---

### Adding DVWA

| Field | Value |
|-------|-------|
| **Application Name** | `DVWA` |
| **URL** | `http://localhost:8080/login.php` |
| **Authentication** | Smart Login (Auto) |
| **Email** | `admin` |
| **Password** | `password` |

Click **Save Application**.

> **Note:** DVWA requires a one-time setup after first launch. Open http://localhost:8080/setup.php in your browser and click **Create / Reset Database** before running a test.

---

### Adding an Enterprise App (e.g. Korn Ferry Talent)

For apps with SSO or email-first login, use **Smart Login (Auto)** — just provide the email and password. The agent figures out the flow automatically.

| Field | Value |
|-------|-------|
| **Application Name** | `Korn Ferry Talent (SSO)` |
| **URL** | `https://home.kornferrytalent-dev.com/login` |
| **Authentication** | Smart Login (Auto) |
| **Email** | `user@company.com` |
| **Password** | Your IDP password |

The agent will handle: email-first page → SSO redirect to Microsoft/Okta IDP → password entry → redirect back to the app.

For **non-SSO users** on the same app, register a second entry with the non-SSO user's email and app password — the agent adapts automatically based on what it sees.

To auto-register an enterprise app on every `./start.sh`, add to `backend/.env`:
```env
KF_EMAIL=user@company.com
KF_IDP_PASSWORD=your-password
```

---

### Authentication Modes Explained

| Mode | When to use |
|------|-------------|
| **None** | Public sites that require no login |
| **Smart Login (Auto)** | Any login flow — the agent uses the LLM to navigate automatically. Handles standard forms, email-first pages, SSO/IDP redirects (Microsoft, Okta, Google), and more |
| **SSO / Multi-Step** | Manual override — you define each Playwright step explicitly. Use this only if Smart Login fails (e.g. login inside an iframe) |

#### How Smart Login Works

When given just an email and password, the agent runs an iterative loop (up to 12 steps):

1. Reads the current page HTML
2. Asks the LLM: *"What is the single next action to log in?"*
3. Executes the action (fill, click, wait for redirect, etc.)
4. Repeats until the URL leaves all login/auth pages or the LLM signals done

The real password is **never sent to the LLM** — a placeholder `__PASSWORD__` is used in prompts and substituted locally before browser execution.

#### SSO / Multi-Step (Manual Override)

If Smart Login fails, switch to **SSO / Multi-Step** and define each step explicitly:

| Step | Action | Selector | Value |
|------|--------|----------|-------|
| 1 | Fill input | `input[type="email"]` | `user@example.com` |
| 2 | Click element | `button[type="submit"]` | — |
| 3 | Wait for redirect | — | timeout: 15000 |
| 4 | Fill input | `input[type="password"]` | `password` |
| 5 | Click element | `button[type="submit"]` | — |
| 6 | Wait for redirect | — | timeout: 20000 |

---

## Step 3 — Start a Test Run

1. Click **Test Runs** in the left sidebar
2. Click **New Run** (or the **Start New Test Run** button)
3. Select the application from the dropdown
4. Configure the test (all fields optional):

| Field | Description | Example |
|-------|-------------|---------|
| **What to test** | Specific instructions for the agent | `Test the client listing page — search, filters, and pagination` |
| **Focus areas** | Areas to prioritize | `authentication, forms, navigation` |
| **Pages to explore** | Slider 1–20 (default 5) | `10` for deeper coverage |
| **Notes** | Run-level notes for your records | `Post-deployment smoke test` |
| **Capture login screenshots** | Toggle — screenshot after each auto-login step | Default: on |
| **Detailed AI report** | Toggle — AI enriches each bug with structured report. Off = quick mode (bugs logged instantly, no LLM enrichment) | Default: **off** |

5. Click **Start Test Run**

You are redirected to the Bug Reports page for that run where you can watch results appear in real time.

> **Tip:** More pages = deeper coverage but longer run time. For a quick smoke test use 3–5 pages; for thorough coverage use 10–15.

> **Quick mode** (Detailed AI report off) is faster — bugs are logged without LLM enrichment. Enable for thorough analysis when you want structured steps-to-reproduce.

> **Note:** You can also start a run directly from the **Applications** page — click the **Run** button on any app row to open the modal pre-configured for that app.

---

## Step 4 — What the Agent Does

Once a run starts, the LangGraph agent pipeline executes automatically (fixed order, no branching):

```
OrchestratorAgent  →  LLM JSON plan (pages, journeys, focus) — drives Explorer priorities; uses app memory + skills
       ↓
ExplorerAgent      →  Playwright navigation, screenshots, console/network errors; form fuzzing, perf checks, a11y audits; records visited URLs
       ↓
ValidatorAgent     →  LLM review of `observe` / `errors_detected` steps + multimodal vision analysis of screenshots; regression detection
       ↓
SecurityAgent      →  XSS / SQLi / secret patterns + HTTP header, cookie, CSRF checks; adaptive payloads from memory
       ↓
ReporterAgent      →  semantic + fingerprint deduplication, then LLM structured bug reports to PostgreSQL
```

The run’s **summary** JSON in PostgreSQL can include `strategic_plan`, `visited_urls`, `dedupe_stats`, and `pipeline_log` for debugging and tuning.

**Run status values:**

| Status | Meaning |
|--------|---------|
| `pending` | Job is queued in Redis, waiting for the agent worker |
| `running` | Agent is actively exploring and testing |
| `completed` | All agents finished; bug reports are ready |
| `failed` | An error occurred — check `logs/agent.log` |
| `paused` | Run is suspended — agent is waiting for resume signal |
| `cancelled` | Run was stopped mid-run — partial results saved |

---

## Stopping and Pausing a Run

You can control an active run from the run detail page or the Test Runs list.

| Control | Where available | Effect |
|---------|----------------|--------|
| **Stop** | Run detail + Test Runs list | Immediately signals the agent to stop. The run is marked `cancelled` and any bugs found so far are saved. |
| **Pause** | Run detail only (when `running`) | Signals the agent to pause after the current page. The run is marked `paused`. |
| **Resume** | Run detail only (when `paused`) | Clears the pause signal; run continues from where it left off. |

**How it works:** The backend sets a Redis key (`bughunter:control:{run_id}`). The agent checks this key at the start of each page and before each pipeline stage. On stop, partial bug results are saved to the database.

> **Note:** Stopping a run does not discard findings — bugs found up to the stop point are preserved and visible on the run detail page.

---

## Step 5 — View Bug Reports

After the run completes:

1. Go to **Test Runs** in the sidebar
2. Click on the completed run
3. On the run detail page you can use:
   - **Agent pipeline** — live stepper for Orchestrator → Explorer → Validator → Security → Reporter
   - **Live Activity** — flat SSE event stream (and retained log after completion)
   - **Agent logs** — the same events grouped by agent with filters
4. Each bug report shows:
   - **Title** — brief description of the issue
   - **Severity** — `critical`, `high`, `medium`, `low`, or `info`
   - **Status** — `open`, `confirmed`, or `false_positive`
   - **Page URL** — the exact URL where the bug was found
   - **Description** — detailed LLM analysis of the issue
   - **Screenshot** — visual evidence captured by Playwright

To read static descriptions of each agent and the pipeline order, open **AI Agents** in the sidebar (`/agents`).

---

## Expected Findings by Site

### OWASP Juice Shop
Juice Shop is intentionally vulnerable. Expect the agent to find some of:
- XSS in the search bar and product reviews
- SQL injection on login
- Broken access control (admin page accessible without auth)
- Sensitive data exposure (customer data in API responses)
- Insecure direct object references (accessing other users' orders)

### DVWA
DVWA has configurable difficulty levels (Low / Medium / High). At **Low** difficulty expect:
- SQL injection on the login and user lookup forms
- Reflected and stored XSS
- Command injection
- File upload bypass (uploading PHP shells)
- CSRF on forms

To change DVWA difficulty: log in → go to **DVWA Security** in the left menu → set the level → click **Submit**.

---

## Troubleshooting

### Test run stays in `pending` forever
The agent worker is not running. Check:
```bash
tail -f logs/agent.log
```
Ensure the Python worker started successfully — look for `Job runner started` in the log.

### Agent cannot log in to the site
- Verify the site is accessible at its URL in your browser and credentials are correct
- Check `logs/agent.log` for `Smart login step N:` lines to see where it stalled
- If the login page renders inside an **iframe**, Smart Login may not work — switch to **SSO / Multi-Step** and define each step with explicit CSS selectors (use browser DevTools F12 → Inspector to find them)

### DVWA shows a blank page or database error
Run the DVWA setup first:
1. Open http://localhost:8080/setup.php
2. Click **Create / Reset Database**
3. Log in again with `admin` / `password`

### Juice Shop container not healthy
```bash
docker logs bughunter-juice-shop
```
The image may still be pulling on first run. Wait 60 seconds and retry.

### No bugs found
- Increase **Pages to explore** (slider in New Run modal) — default is 5
- Use the **What to test** field to direct the agent to specific flows or pages
- Run multiple times targeting different areas — each run is independent
- Check `logs/agent.log` for the full exploration trace

---

## Tips for Better Results

- **Use "What to test"** to direct the agent: `"Test the client listing — search, filter, and pagination"`
- **Use "Focus areas"** for targeted scanning: `"authentication, forms, data display"`
- **Increase pages** for deeper coverage — set to 10–15 for production apps
- **Run multiple times** targeting different parts of the app — each run is independent and builds on memory from previous runs
- **DVWA Low difficulty** produces the most findings as security controls are disabled
- **Juice Shop** has over 100 challenges — each run will likely surface different issues
- **Enterprise apps**: register once per user type (SSO user / non-SSO user) with their respective credentials
- **Quick mode** is the default — enable "Detailed AI report" only when you need structured steps-to-reproduce per bug (it adds LLM enrichment time)
- **Self-improvement:** Each run builds memory — known bugs, login steps, page priority scores, and effective security payloads are carried over to the next run. Consecutive runs on the same app get progressively smarter.
- **Clear memory** if you want a fresh start: use `DELETE /api/apps/:id/memory` or the memory management UI

---

## Quick Reference — Credentials

```
OWASP Juice Shop  →  http://localhost:3000
  Email:    admin@juice-sh.op
  Password: admin123

DVWA              →  http://localhost:8080
  Username: admin
  Password: password
  Setup:    http://localhost:8080/setup.php  (run once after first launch)

Enterprise apps   →  set KF_EMAIL and KF_IDP_PASSWORD in backend/.env
                     auto-registered on ./start.sh
```

## Authentication Mode Quick Reference

| Scenario | Mode to use |
|----------|-------------|
| Public app, no login | None |
| Standard login form (email + password on one page) | Smart Login (Auto) |
| Email-first login (password on second page) | Smart Login (Auto) |
| SSO / IDP redirect (Microsoft, Okta, Google) | Smart Login (Auto) |
| Login inside an iframe | SSO / Multi-Step (manual) |
| MFA / OTP required | SSO / Multi-Step (manual) |
