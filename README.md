# 🐛 BugHunter.AI

> Autonomous AI-powered QA testing agent using LangGraph + Playwright

BugHunter.AI is a fully automated bug-detection platform that deploys a multi-agent AI pipeline to crawl, test, and report bugs in web applications — with zero manual intervention.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        BugHunter.AI                              │
│                                                                   │
│  ┌─────────┐    ┌─────────┐    ┌───────────────────────────┐    │
│  │ React   │───▶│ Node.js │───▶│     Redis Job Queue       │    │
│  │ Frontend│    │ Express │    └──────────────┬────────────┘    │
│  └─────────┘    │   API   │                   │                  │
│                 └────┬────┘                   ▼                  │
│                      │           ┌─────────────────────────┐    │
│                      │           │   Python LangGraph Agent │    │
│                 ┌────▼────┐      │                          │    │
│                 │ Postgres│      │  ┌──────────────────┐   │    │
│                 │   DB    │◀─────│  │  OrchestratorAgent│   │    │
│                 └─────────┘      │  └────────┬─────────┘   │    │
│                                  │           │              │    │
│                                  │  ┌────────▼─────────┐   │    │
│                                  │  │  ExplorerAgent   │   │    │
│                                  │  │  (Playwright)    │   │    │
│                                  │  └────────┬─────────┘   │    │
│                                  │           │              │    │
│                                  │  ┌────────▼─────────┐   │    │
│                                  │  │ ValidatorAgent   │   │    │
│                                  │  │  (LLM Vision)    │   │    │
│                                  │  └────────┬─────────┘   │    │
│                                  │           │              │    │
│                                  │  ┌────────▼─────────┐   │    │
│                                  │  │  SecurityAgent   │   │    │
│                                  │  │  (XSS/SQLi/Auth) │   │    │
│                                  │  └────────┬─────────┘   │    │
│                                  │           │              │    │
│                                  │  ┌────────▼─────────┐   │    │
│                                  │  │  ReporterAgent   │   │    │
│                                  │  │  (Bug Reports)   │   │    │
│                                  │  └──────────────────┘   │    │
│                                  └─────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Agent Flow

All five agents run in a **fixed linear order** (no branching on bug count):

```
orchestrator ──▶ explorer ──▶ validator ──▶ security ──▶ reporter ──▶ END
```

The orchestrator emits a **strategic plan** (JSON: pages, journeys, focus areas) that the Explorer uses for URL priority and LLM prompts. The Explorer records **visited URLs**; Security runs XSS/SQLi/secret checks across those URLs (capped). The Reporter **deduplicates** raw findings before generating structured reports.

---

## 🛠️ Tech Stack

| Layer       | Technology                                                        |
|-------------|-------------------------------------------------------------------|
| AI Agents   | LangGraph + LangChain + Multi-Provider LLM (see below)           |
| Browser     | Playwright (Python, `domcontentloaded` wait strategy)             |
| Backend API | Node.js + Express                                                 |
| Frontend    | React + Vite                                                      |
| Database    | PostgreSQL 15                                                     |
| Queue       | Redis 7 + BullMQ                                                  |
| Storage     | AWS S3 (screenshots)                                              |
| Auth        | JWT (bcrypt + jsonwebtoken)                                       |

---

## 📚 Documentation

| Document | Contents |
|----------|----------|
| [documents/TECHNICAL_SPEC.md](documents/TECHNICAL_SPEC.md) | Full system spec: frontend routes, agent pipeline, DB summary fields, env vars |
| [docs/testing-guide.md](docs/testing-guide.md) | End-to-end: register apps, run tests, interpret the UI |
| [CLAUDE.md](CLAUDE.md) | Short architecture reference for AI-assisted development |

---

## 🧠 Supported LLM Providers

BugHunter.AI supports **7 LLM providers** out of the box. Configure via `LLM_PROVIDER` and optionally `LLM_MODEL` in `agent/.env`:

| Provider       | `LLM_PROVIDER` | Default Model                  | API Key Env Var       |
|----------------|----------------|--------------------------------|-----------------------|
| Anthropic      | `anthropic`    | `claude-3-5-sonnet-20241022`   | `ANTHROPIC_API_KEY`   |
| OpenAI         | `openai`       | `gpt-4o`                       | `OPENAI_API_KEY`      |
| Google         | `google`       | `gemini-2.0-flash`             | `GOOGLE_API_KEY`      |
| Groq           | `groq`         | `llama-3.3-70b-versatile`      | `GROQ_API_KEY`        |
| Mistral        | `mistral`      | `mistral-large-latest`         | `MISTRAL_API_KEY`     |
| Ollama         | `ollama`       | `llama3`                       | None (local)          |
| Claude Code CLI| `claude_cli`   | `claude-sonnet-4-6`            | None (uses CLI auth)  |

> **Tip:** To override the default model, set `LLM_MODEL=your-model-name` in `agent/.env`.

### Claude Code CLI Provider

The `claude_cli` provider uses the [Claude Code](https://claude.ai/code) CLI subprocess instead of a direct API key. This is ideal if you have Claude Code installed and authenticated via SSO or browser — no `ANTHROPIC_API_KEY` needed.

```env
LLM_PROVIDER=claude_cli
# LLM_MODEL=claude-opus-4-6      # optional, defaults to claude-sonnet-4-6
# CLAUDE_CLI_TIMEOUT=300          # optional, seconds (default: 300)
```

Requires the `claude` binary to be on your `PATH`. Verify with:
```bash
claude --version
```

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 18+
- Python 3.11+
- An API key for at least one supported LLM provider **or** [Claude Code](https://claude.ai/code) installed and authenticated (for the `claude_cli` provider)

### 1. Clone the Repo

```bash
git clone https://github.com/thedineshbabu/bughunter-ai.git
cd bughunter-ai
```

### 2. Start Infrastructure

```bash
docker-compose up -d
```

This starts PostgreSQL and Redis.

### 3. Run Database Migrations

**Linux / macOS:**

```bash
psql postgresql://postgres:postgres@localhost:5432/bughunter \
  -f database/migrations/001_users.sql \
  -f database/migrations/002_apps.sql \
  -f database/migrations/003_test_runs.sql \
  -f database/migrations/004_bug_reports.sql
```

**Windows (PowerShell):**

```powershell
Get-Content database\migrations\001_users.sql | docker exec -i bughunter-postgres psql -U postgres -d bughunter
Get-Content database\migrations\002_apps.sql | docker exec -i bughunter-postgres psql -U postgres -d bughunter
Get-Content database\migrations\003_test_runs.sql | docker exec -i bughunter-postgres psql -U postgres -d bughunter
Get-Content database\migrations\004_bug_reports.sql | docker exec -i bughunter-postgres psql -U postgres -d bughunter
```

Verify tables were created:

```bash
docker exec bughunter-postgres psql -U postgres -d bughunter -c "\dt"
```

You should see: `users`, `apps`, `test_runs`, `bug_reports`.

### 4. Set Up the Agent (Python)

```bash
cd agent
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

Create `agent/.env` with your configuration. Choose one of the two LLM setup options:

**Option A — API key (any provider):**
```env
# LLM Provider (anthropic | openai | google | groq | mistral | ollama)
LLM_PROVIDER=google
GOOGLE_API_KEY=your-google-api-key-here

# Override default model (optional)
# LLM_MODEL=gemini-2.0-flash

# Database & Redis
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bughunter
REDIS_URL=redis://localhost:6379

# AWS S3 for screenshots (optional)
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
S3_BUCKET=bughunter-screenshots
S3_REGION=us-east-1
```

**Option B — Claude Code CLI (no API key required):**
```env
# Uses the installed `claude` CLI — no API key needed
LLM_PROVIDER=claude_cli
# LLM_MODEL=claude-sonnet-4-6     # optional
# CLAUDE_CLI_TIMEOUT=300           # optional, seconds

# Database & Redis
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bughunter
REDIS_URL=redis://localhost:6379
```

Start the agent worker:

```bash
python main.py
```

### 5. Set Up the Backend (Node.js)

```bash
cd backend
npm install
```

Create `backend/.env`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bughunter
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=7d
PORT=5000
FRONTEND_URL=http://localhost:5173
REDIS_URL=redis://localhost:6379
```

Start the server:

```bash
npm run dev
```

### 6. Set Up the Frontend (React)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

---

## 📋 Registering an App with Multi-Step / SSO Login

Some apps use an **email-first authentication flow** where the next step depends on the user type:
- **Non-SSO users**: Email → password page → app
- **SSO users**: Email → redirect to Identity Provider (IDP) → back to app

Since these are branching flows, register the app **twice** — once for each user path — using **SSO / Multi-Step** auth mode.

### Non-SSO User (email → password page → listing)

| Step | Action | Selector | Value |
|------|--------|----------|-------|
| 1 | Fill input | `input[type="email"]` | `user@example.com` |
| 2 | Click element | `button[type="submit"]` | *(leave blank)* |
| 3 | Wait for element | `input[type="password"]` | timeout: 10000 |
| 4 | Fill input | `input[type="password"]` | `yourpassword` |
| 5 | Click element | `button[type="submit"]` | *(leave blank)* |
| 6 | Wait for redirect | *(no selector)* | timeout: 15000 |

### SSO User (email → IDP redirect → listing)

| Step | Action | Selector | Value |
|------|--------|----------|-------|
| 1 | Fill input | `input[type="email"]` | `ssouser@company.com` |
| 2 | Click element | `button[type="submit"]` | *(leave blank)* |
| 3 | Wait for redirect | *(no selector)* | timeout: 15000 |
| 4 | Fill input | IDP's email/username field | `ssouser@company.com` |
| 5 | Fill input | `input[type="password"]` | `idppassword` |
| 6 | Click element | `button[type="submit"]` | *(leave blank)* |
| 7 | Wait for redirect | *(no selector)* | timeout: 20000 |

**Tips:**
- Use browser DevTools (F12 → Inspector) to find the exact CSS selectors for each field.
- `Wait for element` before the password field ensures the agent waits for the second page to load.
- `Wait for redirect` with a generous timeout (15–20s) handles slow IDP redirects.
- Name apps clearly, e.g. `"MyApp - Standard Login"` and `"MyApp - SSO Login"`, so you can run targeted tests on each flow.

---

## 🤖 Agent Descriptions

### OrchestratorAgent
Analyzes the target URL, credentials, app memory, and `test_config`. Produces **JSON** (`pages`, `user_journeys`, `focus_areas`, `notes`) stored as **`strategic_plan`** and used by the Explorer for URL priority and prompts.

### ExplorerAgent
Playwright navigation (`domcontentloaded`). Merges **strategic plan URLs** with memory-driven bug-prone pages. Per page: screenshot, LLM “what to test” (plan-aware), `observe` / `errors_detected` steps. Records **`visited_urls`** for Security. Page cap: `AGENT_MAX_PAGES` / `test_config.max_pages` (default 5).

### ValidatorAgent
Iterates `test_steps` with `action` in `observe` or `errors_detected` and asks the LLM to list functional/UI/data issues. Strips screenshot `base64` from state after validation.

### SecurityAgent
Runs XSS/SQLi/secret scans on the **seed URL plus `visited_urls`**, deduped and capped by **`SECURITY_MAX_URLS`** (default 6). One browser session per target URL.

### ReporterAgent
**Deduplicates** raw `bugs_found` by fingerprint, then uses the LLM to produce structured reports (title, description, steps, severity, regression vs app memory).

---

## 📡 API Endpoints

### Auth
| Method | Path              | Description        |
|--------|-------------------|--------------------|
| POST   | /api/auth/register| Register new user  |
| POST   | /api/auth/login   | Login + get JWT    |
| GET    | /api/auth/me      | Get current user   |

### Apps
| Method | Path           | Description         |
|--------|----------------|---------------------|
| GET    | /api/apps      | List apps           |
| POST   | /api/apps      | Register new app    |
| GET    | /api/apps/:id  | Get app details     |
| PUT    | /api/apps/:id  | Update app          |
| DELETE | /api/apps/:id  | Delete app          |

### Test Runs
| Method | Path          | Description               |
|--------|---------------|---------------------------|
| GET    | /api/runs     | List runs (paginated)     |
| POST   | /api/runs     | Create run + enqueue job  |
| GET    | /api/runs/:id | Get run + bug reports     |
| DELETE | /api/runs/:id | Delete run                |

### Bug Reports
| Method | Path                   | Description             |
|--------|------------------------|-------------------------|
| GET    | /api/bugs              | List bugs (filterable)  |
| GET    | /api/bugs/:id          | Get bug details         |
| PUT    | /api/bugs/:id/status   | Update bug status       |
| DELETE | /api/bugs/:id          | Delete bug              |

---

## 🗄️ Database Schema

```
users ──────────────── apps ─────────────── test_runs ──── bug_reports
  │                     │                        │               │
  │ id (UUID PK)        │ id (UUID PK)           │ id (UUID PK)  │ id (UUID PK)
  │ email               │ user_id (FK)           │ app_id (FK)   │ run_id (FK)
  │ password_hash       │ name                   │ user_id (FK)  │ app_id (FK)
  │ name                │ url                    │ status        │ title
  │ created_at          │ credentials (JSONB)    │ started_at    │ description
                        │ created_at             │ completed_at  │ severity
                        │ updated_at             │ summary       │ status
                                                 │ error         │ screenshot_url
                                                 │ created_at    │ page_url
```

---

## 🔧 Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `relation "test_runs" does not exist` | Database migrations not applied | Run the migration commands in Step 3 |
| `401 invalid x-api-key` | Invalid or expired LLM API key | Check your API key in `agent/.env` |
| `Page.goto: Timeout exceeded` | Slow page load with `networkidle` | Already fixed — uses `domcontentloaded` strategy |
| `No module named 'langchain_google_genai'` | Missing LLM provider package | `pip install langchain-google-genai` |
| `models/gemini-1.5-pro is not found` | Deprecated model | Updated default to `gemini-2.0-flash` |
| `claude CLI not found on PATH` | `claude_cli` provider selected but Claude Code not installed | Install Claude Code from https://claude.ai/code and ensure `claude` is on your PATH |
| `claude CLI exited with code 1` | Claude Code not authenticated | Run `claude` once interactively to complete browser/SSO login |
| Login succeeds but page doesn't redirect | Missing auth redirect in frontend | Fixed — `Login`/`Register` components now redirect on auth |
| PowerShell `curl` doesn't work | `curl` is aliased to `Invoke-WebRequest` | Use `curl.exe` or `Invoke-RestMethod` instead |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes and add tests
4. Commit: `git commit -m "feat: add your feature"`
5. Push: `git push origin feat/your-feature`
6. Open a Pull Request

### Commit Convention
We follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` – new feature
- `fix:` – bug fix
- `docs:` – documentation
- `chore:` – maintenance

---

## 📄 License

MIT © [Dinesh Babu](https://github.com/thedineshbabu)
