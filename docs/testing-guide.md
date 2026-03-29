# BugHunter.AI — Testing Guide

This guide walks through adding a sample test site to BugHunter.AI and running an AI-powered bug scan against it. The two sample sites included in the Docker Compose setup are used as examples.

---

## Sample Sites Included

| Site | URL | Credentials | Purpose |
|------|-----|-------------|---------|
| **OWASP Juice Shop** | http://localhost:3000 | admin@juice-sh.op / admin123 | Modern Node.js app with intentional OWASP Top 10 vulnerabilities |
| **DVWA** | http://localhost:8080 | admin / password | Classic PHP app with configurable vulnerability levels |

Both start automatically when you run `./start.sh` (Linux/macOS) or `./start.ps1` (Windows).

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
| **Authentication** | Simple Login |
| **Username / Email** | `admin@juice-sh.op` |
| **Password** | `admin123` |

Click **Save Application**.

---

### Adding DVWA

DVWA uses a standard HTML login form. Use **Simple Login**:

| Field | Value |
|-------|-------|
| **Application Name** | `DVWA` |
| **URL** | `http://localhost:8080/login.php` |
| **Authentication** | Simple Login |
| **Username / Email** | `admin` |
| **Password** | `password` |

Click **Save Application**.

> **Note:** DVWA requires a one-time setup after first launch. Open http://localhost:8080/setup.php in your browser and click **Create / Reset Database** before running a test.

---

### Authentication Modes Explained

BugHunter.AI supports three authentication modes when registering an app:

| Mode | When to use |
|------|-------------|
| **None** | Public sites that require no login |
| **Simple Login** | Standard username + password forms — the agent fills them automatically |
| **SSO / Multi-Step** | Complex flows (MFA, SSO redirects, token entry) — you define each Playwright step manually |

#### SSO / Multi-Step Flow Example (Juice Shop)

If Simple Login doesn't work for your target, switch to **SSO / Multi-Step** and define the steps manually:

| Step | Action | Selector | Value |
|------|--------|----------|-------|
| 1 | Fill input | `input[type="email"]` | `admin@juice-sh.op` |
| 2 | Fill input | `input[type="password"]` | `admin123` |
| 3 | Click element | `button[type="submit"]` | — |
| 4 | Wait for redirect | — | timeout: 5000 |

---

## Step 3 — Start a Test Run

1. Click **Test Runs** in the left sidebar
2. Click **New Run** (or the **Start New Test Run** button)
3. Select the application from the dropdown — e.g. `OWASP Juice Shop — http://localhost:3000`
4. Optionally add notes to guide the agent, for example:
   - `Focus on the shopping cart and checkout flow`
   - `Test XSS in the search bar and product reviews`
   - `Check for authentication bypass on admin routes`
5. Click **Start Test Run**

You are redirected to the Bug Reports page for that run where you can watch results appear in real time.

---

## Step 4 — What the Agent Does

Once a run starts, the LangGraph agent pipeline executes automatically:

```
OrchestratorAgent  →  plans which pages and flows to test
       ↓
ExplorerAgent      →  navigates the site using Playwright, takes screenshots
       ↓
ValidatorAgent     →  analyzes screenshots with LLM vision for functional bugs
       ↓
SecurityAgent      →  runs active tests: XSS payloads, SQL injection, auth bypass, secret scanning
       ↓
ReporterAgent      →  structures all findings into bug reports saved to the database
```

**Run status values:**

| Status | Meaning |
|--------|---------|
| `pending` | Job is queued in Redis, waiting for the agent worker |
| `running` | Agent is actively exploring and testing |
| `completed` | All agents finished; bug reports are ready |
| `failed` | An error occurred — check `logs/agent.log` |

---

## Step 5 — View Bug Reports

After the run completes:

1. Go to **Test Runs** in the sidebar
2. Click on the completed run
3. Each bug report shows:
   - **Title** — brief description of the issue
   - **Severity** — `critical`, `high`, `medium`, `low`, or `info`
   - **Status** — `open`, `confirmed`, or `false_positive`
   - **Page URL** — the exact URL where the bug was found
   - **Description** — detailed LLM analysis of the issue
   - **Screenshot** — visual evidence captured by Playwright

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
- Verify the site is accessible at its URL in your browser
- Try switching to **SSO / Multi-Step** auth and define each login step explicitly with exact CSS selectors
- Use browser DevTools (F12 → Inspector) to find the correct selectors for input fields

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
- The agent explores up to 5 pages per run by default; complex apps may need multiple runs targeting different flows
- Add specific notes when creating the run to focus the agent on known-vulnerable areas
- Check `logs/agent.log` for the full exploration trace

---

## Tips for Better Results

- **Use notes** when starting a run to direct the agent: `"Focus on the login form and user registration flow"`
- **Run multiple times** targeting different parts of the app — each run is independent
- **DVWA Low difficulty** produces the most findings as security controls are disabled
- **Juice Shop** has over 100 challenges — each run will likely surface different issues

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
```
