# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 🏗️ Architecture Overview

BugHunter.AI is a **three-tier autonomous QA system** that deploys a multi-agent AI pipeline to detect bugs in web applications with zero manual intervention.

### Layers

**Frontend (React + Vite)**
- `frontend/src/` - React components, context, services
- User authentication (Login/Register), app management, test run creation, bug report viewing
- Real-time UI updates via API calls

**Backend (Node.js/Express)**
- `backend/src/` - Express API server, models, controllers, middleware, routes
- REST endpoints for auth, apps, test runs, bug reports
- Job enqueueing to Redis queue (uses BullMQ + raw Redis list for Python worker)
- Database interactions with PostgreSQL via `pg` library

**Agent (Python + LangGraph)**
- `agent/` - Multi-agent orchestration pipeline
- `graph/` - LangGraph StateGraph definition (nodes, edges, state flow)
- `agents/` - Individual agent implementations (Orchestrator, Explorer, Validator, Security, Reporter)
- `worker/runner.py` - Main job poller that listens to Redis for incoming jobs
- `tools/` - Browser automation (Playwright), S3 screenshots, utilities

### Data Flow

```
Frontend → Backend API → Redis Queue (BullMQ + raw list)
                                ↓
                        Python Worker (main.py)
                                ↓
                        LangGraph Agent Pipeline
                        (orchestrator → explorer → validator → security → reporter)
                                ↓
                        PostgreSQL (test_runs.summary JSON, bug_reports, app_memory)
                                ↓
                        Backend API → Frontend (user views results)
```

### Agent Pipeline Flow

Linear pipeline — every run executes all five agents in order.

- **OrchestratorAgent**: LLM produces JSON strategic plan (`strategic_plan`); parsed via `tools/json_utils.py`
- **ExplorerAgent**: Playwright exploration; merges plan URLs with memory priority list; sets `visited_urls`; `observe` / `errors_detected` steps for Validator; **form fuzzing** (edge-case payloads), **performance checks** (Navigation Timing API), **accessibility audits** (alt text, labels, headings, lang)
- **ValidatorAgent**: Text-based LLM analysis of `observe` / `errors_detected` steps + **multimodal vision analysis** of screenshots for visual bugs; regression detection via `app_memory.known_bugs`; strips screenshot base64 after run
- **SecurityAgent**: XSS/SQLi/secret scans on seed URL + `visited_urls` (see `SECURITY_MAX_URLS`); **adaptive payloads** from memory + skills; **HTTP header**, **cookie security**, and **CSRF** checks
- **ReporterAgent**: `tools/bug_dedupe.dedupe_bugs` (fingerprint + **semantic similarity**) then LLM structured reports; regression tagging; `dedupe_stats` on state

### Frontend (high level)

- Run detail (`BugReports.jsx`): SSE live activity, `AgentPipelineTracker`, `AgentActivityLog`
- Static `/agents` page: `AgentProfiles.jsx` + `data/agentProfiles.js`

---

## 🛠️ Core Technologies

| Component | Tech | Key Details |
|-----------|------|------------|
| **LLM Agents** | LangGraph + LangChain | Multi-provider support (Anthropic, OpenAI, Google, Groq, Mistral, Ollama) |
| **Browser Automation** | Playwright | Python-based, `domcontentloaded` wait strategy |
| **Job Queue** | Redis + BullMQ | Backend enqueues via BullMQ; Python worker polls raw Redis list |
| **Backend** | Express + Node.js | PostgreSQL driver (`pg`), bcrypt for auth, JWT tokens |
| **Frontend** | React + Vite | React Router for routing, Axios for API calls |
| **Database** | PostgreSQL 15 | Tables: `users`, `apps`, `test_runs`, `bug_reports`, `app_memory`, `agent_skills` |

---

## 🚀 Quick Start Commands

### Initial Setup

```bash
# 1. Start Docker containers (PostgreSQL + Redis)
docker-compose up -d

# 2. Run database migrations (see database/migrations/*.sql)
# Linux/macOS:
psql postgresql://postgres:postgres@localhost:5432/bughunter \
  -f database/migrations/001_users.sql \
  -f database/migrations/002_apps.sql \
  -f database/migrations/003_test_runs.sql \
  -f database/migrations/004_bug_reports.sql \
  -f database/migrations/005_not_null_constraints.sql \
  -f database/migrations/006_credentials_text.sql \
  -f database/migrations/007_app_memory.sql \
  -f database/migrations/007_agent_memory.sql \
  -f database/migrations/008_run_status_enum.sql

# Windows (PowerShell):
Get-Content database\migrations\001_users.sql | docker exec -i bughunter-postgres psql -U postgres -d bughunter
```

### Development Commands

**Python Agent:**
```bash
cd agent
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium

# Create agent/.env with:
# LLM_PROVIDER=anthropic (or openai, google, groq, mistral, ollama)
# ANTHROPIC_API_KEY=sk-...
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bughunter
# REDIS_URL=redis://localhost:6379

# Run agent worker:
python main.py
```

**Node.js Backend:**
```bash
cd backend
npm install

# Create backend/.env with:
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bughunter
# JWT_SECRET=your-secret-key
# REDIS_URL=redis://localhost:6379
# PORT=5000
# FRONTEND_URL=http://localhost:5173

# Development server (auto-reload with nodemon):
npm run dev

# Production:
npm run start
```

**React Frontend:**
```bash
cd frontend
npm install
npm run dev     # Runs on http://localhost:5173
npm run build   # Production build
npm run preview # Preview production build
```

---

## 📁 Key Files & Directory Structure

### Agent (`agent/`)
- **main.py** - Entry point; starts JobRunner loop
- **worker/runner.py** - Polls Redis for jobs, invokes LangGraph pipeline
- **graph/graph.py** - LangGraph StateGraph definition; defines agent flow (orchestrator → ... → reporter)
- **graph/state.py** - AgentState TypedDict; shared state object passed through all agents
- **graph/nodes.py** - Thin wrapper functions that instantiate agents and call `.run(state)`
- **agents/*.py** - Individual agent implementations:
  - `orchestrator.py` - Plans testing strategy using LLM
  - `explorer.py` - Playwright-based navigation, screenshot capture, action logging
  - `validator.py` - LLM vision analysis of screenshots for bugs
  - `security.py` - Active security testing (XSS, SQLi, auth bypass, secret scanning)
  - `reporter.py` - Structures findings into bug reports
- **tools/screenshot.py** - Playwright screenshot capture and base64 encoding
- **tools/storage.py** - S3 upload for screenshots (optional)
- **tools/memory.py** - Per-app memory load/save, fingerprinting, page priority, skill extraction
- **tools/bug_dedupe.py** - Semantic + fingerprint bug deduplication
- **tools/control.py** - Redis-based run control signals (stop/pause/resume)

### Backend (`backend/src/`)
- **index.js** - Express app setup; mounts routes, error handlers, rate limiting, request logging
- **queue/testQueue.js** - BullMQ Queue + raw Redis list for Python worker communication
- **jobs/staleRunReaper.js** - Background reaper for ghost runs (heartbeat-based)
- **config/db.js** - PostgreSQL connection pool
- **config/redis.js** - Redis client
- **middleware/auth.js** - JWT verification middleware
- **middleware/validate.js** - Request body validation with Zod
- **controllers/** - Request handlers (auth, apps, runs, bugs)
- **models/** - Database query functions (user, app, run, bug)
- **routes/** - Express route definitions

### Frontend (`frontend/src/`)
- **App.jsx** - Main router; defines Login, Register, ProtectedRoute, and page routes; wrapped in ErrorBoundary + NotificationProvider
- **context/AuthContext.jsx** - React context for user auth state and login/register functions
- **context/NotificationContext.jsx** - Global toast notification system (useNotification hook)
- **components/ErrorBoundary.jsx** - React error boundary with recovery UI
- **components/**:
  - `Dashboard.jsx` - Home page (quick stats)
  - `AppList.jsx` - CRUD for registered apps
  - `TestRuns.jsx` - List test runs, trigger new runs
  - `BugReports.jsx` - View bug details for a specific run
  - `Sidebar.jsx` - Navigation sidebar
  - `NewRunModal.jsx` - Modal to create a test run
- **services/api.js** - Axios client with base URL and interceptors

### Database (`database/migrations/`)
- `001_users.sql` - users table (email, password_hash, name)
- `002_apps.sql` - apps table (user_id, url, credentials as JSONB)
- `003_test_runs.sql` - test_runs table (app_id, status, started_at, completed_at, summary, error)
- `004_bug_reports.sql` - bug_reports table (run_id, app_id, title, description, severity, status, screenshot_url, page_url)

---

## 🧠 Key Architectural Patterns

### 1. LLM Provider Configuration
Set `LLM_PROVIDER` in `agent/.env`. Each provider requires its API key:

| Provider | Env Var | Default Model |
|----------|---------|---------------|
| `anthropic` | `ANTHROPIC_API_KEY` | claude-3-5-sonnet-20241022 |
| `openai` | `OPENAI_API_KEY` | gpt-4o |
| `google` | `GOOGLE_API_KEY` | gemini-2.0-flash |
| `groq` | `GROQ_API_KEY` | llama-3.3-70b-versatile |
| `mistral` | `MISTRAL_API_KEY` | mistral-large-latest |
| `ollama` | None (local) | llama3 |

### 2. Job Queue Architecture
- **Frontend/Backend**: Call `enqueueTestRun(runId, appUrl, credentials)` → pushes JSON to Redis list `bughunter:jobs`
- **Python Worker**: `runner.poll()` retrieves jobs from Redis, passes to LangGraph
- **Redis List vs BullMQ**: Raw list is consumed by Python; BullMQ is used for retries/observability

### 3. Agent State Flow
All agents receive/return `AgentState` (TypedDict in `graph/state.py`):
```python
{
  'run_id': str,
  'url': str,
  'credentials': Optional[Dict],
  'current_page': Optional[str],
  'screenshots': List[Dict],      # {label, base64, url, timestamp, local_path}
  'screenshot_paths': List[str],
  'bugs_found': List[Dict],       # raw observations
  'test_steps': List[Dict],       # {action, selector, value, result}
  'current_agent': Optional[str],
  'error': Optional[str],
  'status': str,
  'test_config': Optional[Dict],
  'report': Optional[List[Dict]], # final structured report
  'app_memory': Dict,             # per-app memory blob (known bugs, page scores, login steps)
  'skills': List[Dict],           # agent skills from agent_skills table
  'app_id': Optional[str],
  'login_steps_for_memory': Optional[List],
  'strategic_plan': Optional[Dict],
  'visited_urls': Optional[List[str]],
  'dedupe_stats': Optional[Dict],
}
```

### 4. Authentication
- **JWT-based**: Backend issues JWT on login (`jsonwebtoken` with bcrypt hashing)
- **Frontend**: Stores JWT in memory (context); passes via `Authorization: Bearer <token>` header
- **Backend**: Validates JWT in `auth.js` middleware

### 5. Request Validation
- Backend uses **Zod** for runtime schema validation in `middleware/validate.js`
- Example: `validate(z.object({ url: z.string().url() }))`

---

## 💡 Common Development Tasks

### Adding a New API Endpoint

1. **Create route** in `backend/src/routes/` (e.g., `newFeature.routes.js`)
2. **Create controller** in `backend/src/controllers/` with request handler
3. **Create model** in `backend/src/models/` for database queries
4. **Mount route** in `backend/src/index.js`: `app.use('/api/feature', featureRoutes)`
5. **Frontend**: Add axios call in `frontend/src/services/api.js`

### Testing a LangGraph Agent Locally

```python
from graph.graph import build_graph
from graph.state import AgentState

graph = build_graph()
state = {
    'url': 'https://example.com',
    'credentials': None,
    'current_page': None,
    'screenshots': [],
    'bugs_found': [],
    'test_steps': [],
    'current_agent': None,
    'error': None,
    'status': 'pending',
    'report': None,
}

result = graph.invoke(state)
print(result)
```

### Debugging Agent Runs

- Check `agent/main.py` logging (uses `logging` module)
- Check job status in Redis: `redis-cli LLEN bughunter:jobs` (raw list length)
- Check BullMQ queue: `npm run dev` in backend and view dashboard at `http://localhost:5000/bull` (if you add Bull Board)
- Database: Query `test_runs` and `bug_reports` tables to see stored results

### Adding a New LLM Provider

1. Install provider package: `pip install langchain-{provider}`
2. Update `agent/requirements.txt`
3. Add provider case in agent code (e.g., in agents that use `ChatLLM`)
4. Document in README (already lists all 6 providers)

---

## 🔍 Git & Commit Conventions

- **Conventional Commits**: `feat:`, `fix:`, `docs:`, `chore:`
- **Recent work**: See git log for context on recent changes
- **Branch naming**: `feat/` for features, `fix/` for bugs

---

## 📝 Notes for Future Work

- **TypeScript**: Currently JavaScript/Python; consider migrating to TypeScript in backend for type safety
- **Testing**: No test suite yet; consider adding Jest (backend) and Pytest (agent)
- **Error Handling**: Improve error messages in agent pipeline (currently logs errors but doesn't deeply contextualize failures)
- **Performance**: Playwright explores up to 5 pages per run; tune based on testing needs
- **S3 Storage**: Screenshot storage is optional; implement if storing large numbers of runs
