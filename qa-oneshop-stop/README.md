# QA OneShop Stop

A unified Quality Assurance hub built with Flask that brings together test generation, smoke testing, API test execution, and Confluence data export — all in one place.

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-3.0+-000000?logo=flask)
![Playwright](https://img.shields.io/badge/Playwright-Enabled-2EAD33?logo=playwright)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## Features

### 1. BDD Test Scenario Generator

AI-powered generation of Cucumber/Gherkin `.feature` files from multiple requirement sources:

| Source | Description |
|---|---|
| **User Story** | Paste free-text requirements or acceptance criteria |
| **Jira Issue** | Fetch a Jira ticket by key (e.g. `PROJ-1234`) |
| **Jira JQL** | Bulk-generate feature files from a JQL query |
| **Confluence** | Extract requirements from a Confluence page |
| **Figma** | Parse UI structure from a Figma design file |
| **Multi-Source** | Combine any of the above into one feature file |

Generated test cases can be pushed back to Jira as sub-tasks.

### 2. Smoke Test Suite

Playwright-based automated smoke testing with intelligent crawling:

- **Login handling** — supports credentials with auto-detection of SSO/login flows
- **Application crawling** — discovers pages, navigation items, forms, and interactive elements
- **Dynamic scenario generation** — auto-creates test cases based on crawl results
- **Built-in checks** — page load, SSL, console errors, broken links, responsive layout, performance metrics, accessibility basics
- **KF One specific tests** — client selection, quick links, hamburger menu, header navigation
- **Session management** — session timeout detection (30-min timeout with 5-min warning prompt) and logout testing
- **HTML report generation** — detailed report with screenshots, pass/fail summary, and timing data
- **Live streaming** — real-time execution logs via Server-Sent Events (SSE)

### 3. API Testing

Auto-detects and executes tests from any repository (local path or Git URL):

| Framework | Language |
|---|---|
| pytest | Python |
| unittest | Python |
| Jest | JavaScript/TypeScript |
| Mocha | JavaScript/TypeScript |
| Vitest | JavaScript/TypeScript |
| Newman | Postman Collections |
| Maven (JUnit/TestNG) | Java |
| Gradle | Java/Kotlin |
| dotnet test | C#/.NET |
| go test | Go |

Features live-streamed output, automatic framework detection, and structured result parsing.

**API Collection Testing** — Upload an OpenAPI/Swagger JSON specification and the system will:

- Parse all endpoints from the spec (methods, paths, parameters, schemas)
- Use AI to auto-generate positive and negative test cases per endpoint
- Execute each test case against your target server via HTTP requests
- Stream results in real time and publish a live dashboard with pass/fail metrics

### 4. Confluence to Excel Exporter

Standalone utility to fetch Confluence pages and export HTML tables to styled Excel workbooks:

```bash
python confluence_to_excel.py <page_url_or_id> [output_filename.xlsx]
```

Each HTML table on the page is exported to a separate worksheet with formatted headers and auto-sized columns.

---

## Quick Start

### Prerequisites

- Python 3.10+
- An OpenAI API key **or** Azure OpenAI deployment (for the BDD generator)

### Install

```bash
git clone https://github.com/KamatchiQA/QAShop.git
cd QAShop
pip install -r requirements.txt
playwright install chromium
```

### Configure

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

**Required** (for AI-powered generation):

| Variable | Description |
|---|---|
| `AI_PROVIDER` | `openai` or `azure` |
| `OPENAI_API_KEY` | Your OpenAI key (if provider = openai) |
| `AZURE_OPENAI_ENDPOINT` | Azure endpoint (if provider = azure) |
| `AZURE_OPENAI_API_KEY` | Azure key (if provider = azure) |
| `AZURE_OPENAI_DEPLOYMENT` | Deployment name (if provider = azure) |

**Optional** (enable integrations as needed):

| Variable | Description |
|---|---|
| `JIRA_BASE_URL` | e.g. `https://your-org.atlassian.net` |
| `JIRA_EMAIL` | Atlassian account email |
| `JIRA_API_TOKEN` | Jira API token |
| `CONFLUENCE_BASE_URL` | e.g. `https://your-org.atlassian.net/wiki` |
| `CONFLUENCE_EMAIL` | Atlassian account email |
| `CONFLUENCE_API_TOKEN` | Confluence API token |
| `FIGMA_ACCESS_TOKEN` | Figma personal access token |

### Run

```bash
python app.py
```

Open **http://localhost:5000** in your browser.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     QA OneShop Stop                         │
│                   http://localhost:5000                      │
├─────────────┬──────────────┬──────────────┬─────────────────┤
│  /generator │  /smoketest  │  /apitest    │  CLI tools      │
│  BDD Gen    │  Smoke Suite │  Test Runner │  confluence_to_ │
│             │              │              │  excel.py        │
├─────────────┴──────────────┴──────────────┴─────────────────┤
│                      Flask Backend                          │
│    SSE streaming · REST API · Report generation             │
├──────────────────┬──────────────────┬───────────────────────┤
│   AI Engine      │   Integrations   │   Test Execution      │
│   OpenAI/Azure   │   Jira           │   Playwright          │
│   GPT-4o         │   Confluence     │   pytest, Jest, etc.  │
│                  │   Figma          │   subprocess runner   │
└──────────────────┴──────────────────┴───────────────────────┘
```

---

## Project Structure

```
QA Oneshop Stop/
├── app.py                          # Flask application & all API routes
├── config.py                       # Environment-based configuration
├── confluence_to_excel.py          # Standalone Confluence → Excel exporter
├── requirements.txt                # Python dependencies
├── .env.example                    # Template for environment variables
│
├── generators/
│   ├── ai_engine.py                # OpenAI / Azure OpenAI wrapper
│   └── feature_generator.py        # Orchestrates fetch → transform → generate → save
│
├── integrations/
│   ├── jira_client.py              # Jira Cloud REST API client
│   ├── confluence_client.py        # Confluence Cloud REST API client
│   ├── figma_client.py             # Figma REST API client
│   ├── smoke_runner.py             # Playwright smoke test engine with crawling
│   └── api_test_runner.py          # Multi-framework test detection & execution
│
├── templates/
│   ├── qahub.html                  # Landing page / QA Hub
│   ├── index.html                  # BDD Generator UI
│   ├── smoketest.html              # Smoke Test Suite UI
│   └── apitest.html                # API Testing UI
│
├── static/
│   ├── style.css                   # Global styles
│   ├── app.js                      # BDD Generator frontend logic
│   ├── smoketest.js                # Smoke Test frontend logic
│   ├── apitest.js                  # API Testing frontend logic
│   └── apitest.css                 # API Testing styles
│
└── output/                         # Generated .feature files, reports, screenshots
```

---

## API Reference

### Health Check

```
GET /api/health
```

Returns `{"status": "ok", "provider": "openai|azure"}`.

### BDD Generation

```
POST /api/generate
```

| Field | Type | Description |
|---|---|---|
| `source` | string | `user_story`, `jira`, `jira_jql`, `confluence`, `figma`, `multi` |
| `story_text` | string | Free-text requirement |
| `issue_key` | string | Jira key like `PROJ-123` |
| `jql` | string | JQL query |
| `page_url` | string | Confluence URL or page ID |
| `figma_url` | string | Figma file URL |
| `extra_instructions` | string | Optional hints for the generator |

### Jira Integration

```
POST /api/jira/preview          # Fetch issue details
POST /api/jira/push-testcases   # Push generated test cases as sub-tasks
POST /api/parse-scenarios       # Parse feature content into scenarios
```

### Smoke Test

```
GET /api/smoketest/stream?url=<target>&user_id=<id>&password=<pw>
POST /api/smoketest/execute
```

SSE stream delivers real-time logs, crawl data, scenario updates, and check results.

### API Testing

```
POST /api/apitest/detect              # Detect frameworks in a repository
GET  /api/apitest/stream              # SSE stream for repo test execution
POST /api/apitest/upload              # Upload & parse OpenAPI spec
POST /api/apitest/collection-stream   # SSE stream for AI-generated API test execution
```

---

## Smoke Test Checks

| ID | Check | Description |
|---|---|---|
| SM-001 | Page Load | Target URL loads successfully |
| SM-002 | SSL Certificate | HTTPS certificate is valid |
| SM-003 | Console Errors | No critical JS errors in browser console |
| SM-004 | Broken Links | All links return valid HTTP responses |
| SM-005 | Responsive Layout | Page renders without horizontal overflow |
| SM-006 | Performance Metrics | Page load completes within acceptable thresholds |
| SM-007 | Basic Accessibility | Images have alt text, page has heading hierarchy |
| SM-008 | Login | Automated login with provided credentials |
| SM-009–011 | Dynamic Scenarios | Auto-generated from crawl (navigation, buttons, forms) |
| SM-012 | Client Selection | Select a client from the client list |
| SM-013 | Quick Links | Click links in the Quick Links section |
| SM-014 | Hamburger Menu | Open hamburger menu and click a menu item |
| SM-015 | Header Navigation | Click header/logo to return to home |
| SM-016 | Session Timeout | Detect the session timeout warning prompt |
| SM-017 | Continue Session | Click continue/extend on the timeout prompt |
| SM-018 | Logout | Perform logout and verify redirect |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, Flask, Flask-CORS |
| AI | OpenAI GPT-4o / Azure OpenAI |
| Browser Automation | Playwright (Chromium) |
| Integrations | Jira REST API, Confluence REST API, Figma REST API |
| Data Export | openpyxl, BeautifulSoup4 |
| Frontend | Vanilla HTML/CSS/JS, Inter + JetBrains Mono fonts |
| Streaming | Server-Sent Events (SSE) |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m "Add my feature"`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

This project is available under the [MIT License](LICENSE).
