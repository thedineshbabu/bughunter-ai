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

```
orchestrator ──▶ explorer ──▶ validator ──▶ [has_bugs?]
                                                │
                              ┌─────────────────┴──────────────────┐
                              ▼ yes                                  ▼ no
                           reporter ◀────── security ◀──────────────┘
                              │
                              ▼
                             END
```

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

## 🤖 Agent Descriptions

### OrchestratorAgent
Analyzes the target app URL, plans the testing strategy, identifies key user flows, and initializes the state for downstream agents. Uses the configured LLM to generate a structured test plan.

### ExplorerAgent
Uses Playwright to navigate the web application with `domcontentloaded` wait strategy for reliable page loading. At each page, it takes a screenshot, asks the LLM what to test, performs actions (clicks, form fills, navigation), captures console/network errors, and logs all steps. Explores up to 5 pages per run.

### ValidatorAgent
Reviews screenshots and interaction logs. Asks the LLM to identify bugs including 404s, broken layouts, JavaScript errors, incorrect data display, and failed form validations.

### SecurityAgent
Performs active security testing: XSS injection (5 payloads), SQL injection attempts (5 payloads), authentication bypass tests, and source code inspection for exposed secrets (API keys, passwords, AWS credentials).

### ReporterAgent
Takes the `bugs_found` list and uses the LLM to generate structured bug reports with title, description, reproduction steps, expected/actual behavior, and severity classification (critical/high/medium/low).

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
