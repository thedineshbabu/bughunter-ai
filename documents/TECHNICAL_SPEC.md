# BugHunter.AI — Technical Specification

> Version: 1.0 | Date: 2026-03-26 | Codebase: `bughunter-ai`

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Directory Structure](#2-directory-structure)
3. [Infrastructure & Docker](#3-infrastructure--docker)
4. [Database Schema](#4-database-schema)
5. [Backend — Node.js/Express](#5-backend--nodejsexpress)
6. [Frontend — React/Vite](#6-frontend--reactvite)
7. [Agent — Python/LangGraph](#7-agent--pythonlanggraph)
8. [Queue Architecture](#8-queue-architecture)
9. [Environment Variables](#9-environment-variables)
10. [Security](#10-security)
11. [Deployment](#11-deployment)

---

## 1. System Overview

**BugHunter.AI** is a three-tier autonomous QA platform that deploys a multi-agent AI pipeline to detect bugs in web applications with zero manual intervention.

### High-Level Architecture

```
User (Browser)
      │
      ▼
React Frontend (Vite, port 5173)
      │  REST API calls
      ▼
Express Backend (Node.js, port 5000)
      │                     │
      │ PostgreSQL (pg)      │ Redis RPUSH
      ▼                     ▼
PostgreSQL 15          Redis 7 list: bughunter:jobs
(persistent data)           │
                            │ BLPOP
                            ▼
                  Python LangGraph Worker
                  (multi-agent pipeline)
                            │
                     ┌──────┼──────────────┐
                     ▼      ▼      ▼       ▼
               Orchestrator Explorer Validator Security
                                               │
                                               ▼
                                           Reporter
                                               │
                                        PostgreSQL write
                                        (bug_reports, test_runs)
```

### Technology Summary

| Layer | Language | Key Libraries |
|---|---|---|
| Frontend | JavaScript (React 18) | Vite, React Router 6, Axios, date-fns |
| Backend | JavaScript (Node.js 18+) | Express 4, pg, BullMQ, bcrypt, jsonwebtoken, Zod, Winston, Helmet |
| Agent | Python 3.11+ | LangGraph, LangChain, Playwright, psycopg2, redis-py |
| Database | SQL | PostgreSQL 15 |
| Queue | — | Redis 7 |
| Containers | — | Docker Compose |

---

## 2. Directory Structure

```
bughunter-ai/
├── agent/                            # Python LangGraph agent pipeline
│   ├── main.py                       # Entry point — starts JobRunner loop
│   ├── providers.py                  # LLM provider factory (6 providers)
│   ├── requirements.txt              # Python dependencies
│   ├── .env / .env.example
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── orchestrator.py           # Analyzes URL, plans test strategy
│   │   ├── explorer.py               # Playwright-based navigation & screenshots
│   │   ├── validator.py              # LLM vision analysis of screenshots
│   │   ├── security.py               # Active XSS/SQLi/secrets testing
│   │   └── reporter.py               # Structures findings into reports
│   ├── graph/
│   │   ├── __init__.py
│   │   ├── graph.py                  # LangGraph StateGraph definition
│   │   ├── state.py                  # AgentState TypedDict
│   │   └── nodes.py                  # Thin node wrapper functions
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── browser.py                # Synchronous Playwright wrapper
│   │   ├── screenshot.py             # Screenshot capture + S3 upload
│   │   └── storage.py                # PostgreSQL persistence (psycopg2)
│   ├── worker/
│   │   ├── __init__.py
│   │   └── runner.py                 # JobRunner — Redis BLPOP poller
│   └── screenshots/                  # Runtime screenshot artifacts
│
├── backend/                          # Node.js Express API
│   ├── package.json
│   ├── .env / .env.example
│   └── src/
│       ├── index.js                  # Express app bootstrap
│       ├── config/
│       │   ├── db.js                 # PostgreSQL connection pool
│       │   └── redis.js              # Redis client
│       ├── middleware/
│       │   ├── auth.js               # JWT verification middleware
│       │   └── validate.js           # Zod schema validation middleware
│       ├── lib/
│       │   └── crypto.js             # AES-256-GCM credential encryption
│       ├── models/
│       │   ├── user.model.js         # User DB queries
│       │   ├── app.model.js          # App DB queries
│       │   ├── run.model.js          # Test run DB queries
│       │   └── bug.model.js          # Bug report DB queries
│       ├── controllers/
│       │   ├── auth.controller.js    # Login / register / me
│       │   ├── apps.controller.js    # App CRUD
│       │   ├── runs.controller.js    # Test run CRUD + enqueue
│       │   └── bugs.controller.js    # Bug report CRUD
│       ├── routes/
│       │   ├── auth.routes.js
│       │   ├── apps.routes.js
│       │   ├── runs.routes.js
│       │   └── bugs.routes.js
│       └── queue/
│           └── testQueue.js          # BullMQ Queue + raw Redis list
│
├── frontend/                         # React + Vite SPA
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx                  # React entry point
│       ├── App.jsx                   # Router + auth pages
│       ├── index.css                 # Global styles
│       ├── services/
│       │   └── api.js                # Axios client with interceptors
│       ├── context/
│       │   └── AuthContext.jsx       # Auth state + login/register/logout
│       └── components/
│           ├── Dashboard.jsx         # Stats + recent runs home page
│           ├── Sidebar.jsx           # Navigation sidebar
│           ├── AppList.jsx           # App registration CRUD
│           ├── TestRuns.jsx          # Test run list + creation
│           ├── BugReports.jsx        # Bug view for a run
│           └── NewRunModal.jsx       # Modal to trigger a new run
│
├── database/
│   ├── migrations/
│   │   ├── 001_users.sql
│   │   ├── 002_apps.sql
│   │   ├── 003_test_runs.sql
│   │   ├── 004_bug_reports.sql
│   │   └── 005_not_null_constraints.sql
│   ├── migrate.sh
│   └── scripts/
│       └── re_encrypt_credentials.js # Credential key rotation utility
│
├── docker-compose.yml                # PostgreSQL 15 + Redis 7
├── start.ps1                         # PowerShell startup helper
├── CLAUDE.md                         # Architecture guide
└── README.md
```

---

## 3. Infrastructure & Docker

### `docker-compose.yml`

Two services are declared:

#### PostgreSQL 15

```yaml
postgres:
  image: postgres:15-alpine
  environment:
    POSTGRES_DB: bughunter
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: postgres
  ports:
    - "5432:5432"
  volumes:
    - postgres_data:/var/lib/postgresql/data
```

#### Redis 7

```yaml
redis:
  image: redis:7-alpine
  command: redis-server --requirepass changeme_in_production --appendonly yes
  ports:
    - "6379:6379"
  volumes:
    - redis_data:/data
```

Both use named volumes for data persistence. AOF persistence is enabled for Redis.

---

## 4. Database Schema

All tables use UUIDs as primary keys via `uuid_generate_v4()`.

### 4.1 `users`

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_users_email ON users(email);
```

| Column | Type | Notes |
|---|---|---|
| id | UUID | PK, auto-generated |
| email | VARCHAR(255) | Unique, indexed |
| password_hash | VARCHAR(255) | bcrypt, 12 salt rounds |
| name | VARCHAR(255) | Optional display name |
| created_at | TIMESTAMPTZ | Auto-set on insert |

---

### 4.2 `apps`

```sql
CREATE TABLE apps (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  url         TEXT NOT NULL,
  credentials JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_apps_user_id ON apps(user_id);
```

| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → users(id), NOT NULL, CASCADE delete |
| name | VARCHAR(255) | App label |
| url | TEXT | Target URL (validated as valid URL) |
| credentials | JSONB | **AES-256-GCM encrypted** blob (see §10) |
| created_at | TIMESTAMPTZ | Auto-set |
| updated_at | TIMESTAMPTZ | Updated on PATCH |

**Credentials JSONB Structure (decrypted):**
```json
{
  "username": "user@example.com",
  "password": "plaintext-password",
  "login_flow": [
    { "action": "fill",                "selector": "input[type='email']",    "value": "user@example.com" },
    { "action": "click",               "selector": "button[type='submit']"                               },
    { "action": "wait_for_navigation", "timeout": 15000                                                  },
    { "action": "fill",                "selector": "input[type='password']", "value": "password"         },
    { "action": "click",               "selector": "button[type='submit']"                               }
  ]
}
```

Login flow actions: `fill` | `click` | `wait_for_navigation` | `wait_for_selector` | `wait`

---

### 4.3 `test_runs`

```sql
CREATE TYPE run_status AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TABLE test_runs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  app_id       UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       run_status DEFAULT 'pending',
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  summary      JSONB,
  error        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_test_runs_user_id ON test_runs(user_id);
CREATE INDEX idx_test_runs_app_id  ON test_runs(app_id);
CREATE INDEX idx_test_runs_status  ON test_runs(status);
```

| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| app_id | UUID | FK → apps(id), NOT NULL |
| user_id | UUID | FK → users(id), NOT NULL |
| status | run_status ENUM | pending → running → completed/failed |
| started_at | TIMESTAMPTZ | Set when agent picks up job |
| completed_at | TIMESTAMPTZ | Set on completion/failure |
| summary | JSONB | `{ total_bugs, pages_explored, screenshots_taken }` |
| error | TEXT | Error message if status = 'failed' |
| created_at | TIMESTAMPTZ | Auto-set |

---

### 4.4 `bug_reports`

```sql
CREATE TYPE bug_severity AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE bug_status   AS ENUM ('open', 'confirmed', 'fixed', 'wontfix');

CREATE TABLE bug_reports (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id             UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  app_id             UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  title              VARCHAR(500) NOT NULL,
  description        TEXT,
  steps_to_reproduce TEXT,
  expected_behavior  TEXT,
  actual_behavior    TEXT,
  severity           bug_severity DEFAULT 'medium',
  status             bug_status   DEFAULT 'open',
  screenshot_url     TEXT,
  page_url           TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_bug_reports_run_id   ON bug_reports(run_id);
CREATE INDEX idx_bug_reports_app_id   ON bug_reports(app_id);
CREATE INDEX idx_bug_reports_severity ON bug_reports(severity);
CREATE INDEX idx_bug_reports_status   ON bug_reports(status);
```

| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| run_id | UUID | FK → test_runs(id), NOT NULL |
| app_id | UUID | FK → apps(id), NOT NULL |
| title | VARCHAR(500) | Short bug title |
| description | TEXT | Full description |
| steps_to_reproduce | TEXT | Numbered steps |
| expected_behavior | TEXT | What should happen |
| actual_behavior | TEXT | What actually happens |
| severity | bug_severity ENUM | critical / high / medium / low |
| status | bug_status ENUM | open / confirmed / fixed / wontfix |
| screenshot_url | TEXT | S3 URL or local file path |
| page_url | TEXT | URL where bug was found |
| created_at | TIMESTAMPTZ | Auto-set |

---

### 4.5 `schema_migrations`

```sql
CREATE TABLE schema_migrations (
  version    VARCHAR(50) PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
```

Records which migration files have been applied.

---

## 5. Backend — Node.js/Express

### 5.1 Entry Point (`src/index.js`)

- Creates Express app
- Mounts: `helmet`, `cors` (origin: `FRONTEND_URL`), `express.json()`
- Rate limiter on `/api/auth/*` (20 req / 15 min)
- Routes: `/api/auth`, `/api/apps`, `/api/runs`, `/api/bugs`
- `GET /health` — unauthenticated health check
- Winston logger with timestamps and colorized console output

---

### 5.2 API Reference

#### Auth (`/api/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /register | None | Create account → JWT |
| POST | /login | None | Authenticate → JWT |
| GET | /me | JWT | Current user info |

---

**POST /api/auth/register**

Request:
```json
{ "email": "user@example.com", "password": "min8chars", "name": "Optional" }
```

Validation: email format, password ≥ 8 chars.

Response `201`:
```json
{ "token": "<jwt>", "user": { "id": "uuid", "email": "...", "name": "..." } }
```

Error `409`: Email already registered.

---

**POST /api/auth/login**

Request:
```json
{ "email": "user@example.com", "password": "password" }
```

Response `200`:
```json
{ "token": "<jwt>", "user": { "id": "uuid", "email": "...", "name": "..." } }
```

Error `401`: Invalid credentials.

---

**GET /api/auth/me**

Header: `Authorization: Bearer <token>`

Response `200`:
```json
{ "user": { "id": "uuid", "email": "...", "name": "..." } }
```

---

#### Apps (`/api/apps`) — all require JWT

| Method | Path | Description |
|---|---|---|
| GET | /api/apps | List all user's apps |
| POST | /api/apps | Register a new app |
| GET | /api/apps/:id | Get single app |
| PUT | /api/apps/:id | Update app |
| DELETE | /api/apps/:id | Delete app (cascades runs + bugs) |

---

**GET /api/apps**

Response `200`:
```json
{
  "apps": [
    {
      "id": "uuid",
      "name": "My App",
      "url": "https://example.com",
      "credentials": { "username": "...", "password": "..." },
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

Credentials are **decrypted** in-memory before returning.

---

**POST /api/apps**

Request:
```json
{
  "name": "My App",
  "url": "https://example.com",
  "credentials": {
    "username": "user@example.com",
    "password": "password",
    "login_flow": [ ... ]
  }
}
```

Validation: `name` required, `url` must be valid URL, `credentials` optional.

Credentials are **encrypted** (AES-256-GCM) before INSERT.

Response `201`: `{ "app": { "id": "uuid", ... } }`

---

**PUT /api/apps/:id**

All fields optional (partial update). Credentials re-encrypted on update.

**DELETE /api/apps/:id**

Response `200`: `{ "message": "App deleted", "id": "uuid" }`

---

#### Test Runs (`/api/runs`) — all require JWT

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/runs | JWT | List runs with pagination + filters |
| POST | /api/runs | JWT | Create run + enqueue job |
| GET | /api/runs/:id | JWT | Get run + its bugs |
| PATCH | /api/runs/:id | Agent secret | Agent updates run status |
| DELETE | /api/runs/:id | JWT | Delete run + bugs |

---

**GET /api/runs**

Query params:
- `app_id` — filter by app
- `status` — pending / running / completed / failed
- `page` (default: 1), `limit` (default: 20, max: 100)

Response `200`:
```json
{
  "runs": [
    {
      "id": "uuid",
      "status": "completed",
      "app_name": "My App",
      "app_url": "https://...",
      "bug_count": 5,
      "started_at": "...",
      "completed_at": "...",
      "created_at": "..."
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

---

**POST /api/runs**

Request:
```json
{ "app_id": "uuid", "notes": "Optional notes" }
```

Flow:
1. Insert `test_runs` row with `status = 'pending'`
2. Decrypt app credentials
3. `RPUSH bughunter:jobs` (raw Redis list) + BullMQ `queue.add()`
4. Return created run

Response `201`: `{ "run": { "id": "uuid", "status": "pending", ... } }`

---

**PATCH /api/runs/:id**

Authentication via header: `x-agent-secret: <AGENT_API_SECRET>`

Request:
```json
{
  "status": "running" | "completed" | "failed",
  "summary": { "total_bugs": 5, "pages_explored": 3, "screenshots_taken": 10 },
  "error": "Optional error string"
}
```

Called internally by the Python agent after the LangGraph pipeline completes.

---

**GET /api/runs/:id**

Response `200`:
```json
{
  "run": { "id": "...", "status": "...", "summary": { ... }, ... },
  "bugs": [ { "id": "...", "title": "...", "severity": "...", ... } ]
}
```

---

#### Bug Reports (`/api/bugs`) — all require JWT

| Method | Path | Description |
|---|---|---|
| GET | /api/bugs | List bugs with filters + pagination |
| GET | /api/bugs/:id | Single bug detail |
| PUT | /api/bugs/:id/status | Update bug status |
| DELETE | /api/bugs/:id | Delete bug |

---

**GET /api/bugs**

Query params: `run_id`, `app_id`, `severity`, `status`, `page`, `limit`

Response `200`:
```json
{
  "bugs": [ { "id": "...", "title": "...", "severity": "critical", "status": "open", ... } ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

---

**PUT /api/bugs/:id/status**

Request:
```json
{ "status": "open" | "confirmed" | "fixed" | "wontfix" }
```

---

### 5.3 Middleware

#### `middleware/auth.js`

```
authenticate(req, res, next)
```

1. Extracts `Authorization: Bearer <token>`
2. Verifies JWT signature with `JWT_SECRET` (HS256)
3. Loads user from DB by JWT `sub` claim
4. Attaches `req.user = { id, email, name }`
5. Returns `401` on failure

---

#### `middleware/validate.js`

```javascript
validate(zodSchema)       // validates req.body
validateQuery(zodSchema)  // validates req.query (with type coercion)
```

Returns `400` with Zod error details on validation failure.

---

### 5.4 Credential Encryption (`lib/crypto.js`)

**Algorithm:** AES-256-GCM (authenticated encryption)
**Key:** 32 bytes, loaded as 64-char hex from `CREDENTIALS_ENCRYPTION_KEY`
**IV:** 12-byte random per encryption operation
**Auth Tag:** 16 bytes, provides tamper detection

**Stored format:** `<iv_hex>:<authTag_hex>:<encrypted_hex>`

```javascript
encrypt(obj)       // JS object → ciphertext string
decrypt(ciphertext) // ciphertext string → JS object
```

---

### 5.5 Queue (`queue/testQueue.js`)

**BullMQ Queue Name:** `test-runs`

**Job options:**
```javascript
{
  jobId: runId,
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 }
}
```

**`enqueueTestRun(runId, appUrl, credentials)`** does two things:
1. `RPUSH bughunter:jobs <json>` — consumed by Python via BLPOP
2. `queue.add('run', payload, options)` — BullMQ for monitoring/retries

---

### 5.6 Backend Dependencies (`package.json`)

| Package | Version | Purpose |
|---|---|---|
| express | ^4.19.0 | Web framework |
| pg | ^8.11.0 | PostgreSQL driver (raw SQL, no ORM) |
| redis | ^4.6.0 | Redis client |
| bcrypt | ^5.1.0 | Password hashing (12 salt rounds) |
| jsonwebtoken | ^9.0.0 | JWT sign/verify (HS256) |
| cors | ^2.8.5 | CORS middleware |
| dotenv | ^16.0.0 | .env loading |
| uuid | ^9.0.0 | UUID generation |
| bullmq | ^5.0.0 | BullMQ job queue |
| winston | ^3.11.0 | Structured logging |
| zod | ^3.22.0 | Runtime schema validation |
| helmet | ^8.0.0 | HTTP security headers |
| express-rate-limit | ^7.4.0 | Rate limiting |

---

## 6. Frontend — React/Vite

### 6.1 Technology Stack

| Package | Version | Purpose |
|---|---|---|
| react | 18.2.0 | UI framework |
| react-dom | 18.2.0 | DOM renderer |
| react-router-dom | 6.22.0 | Client-side routing |
| axios | 1.6.0 | HTTP client |
| date-fns | 3.3.0 | Date formatting |
| vite | 5.1.0 | Build tool / dev server |

### 6.2 Routing (`App.jsx`)

| Path | Component | Protected |
|---|---|---|
| /login | Login (inline) | No |
| /register | Register (inline) | No |
| / | Dashboard | Yes |
| /apps | AppList | Yes |
| /runs | TestRuns | Yes |
| /runs/:id | BugReports | Yes |
| * | → / redirect | — |

`ProtectedRoute` wrapper checks `user` context; redirects to `/login` if unauthenticated.

---

### 6.3 Auth Context (`context/AuthContext.jsx`)

**State:**
- `user` — current user object or `null`
- `loading` — initial session restore in progress

**Methods:**
- `login(email, password)` — POST `/api/auth/login`, stores JWT in `localStorage` key `bughunter_token`
- `register(email, password, name)` — POST `/api/auth/register`
- `logout()` — clears localStorage, resets `user` state

**Session Restore:** On mount, calls `GET /api/auth/me` using token from localStorage. Sets `user` if valid, clears token if 401.

---

### 6.4 API Service (`services/api.js`)

```javascript
const api = axios.create({
  baseURL: '/api',
  timeout: 30_000,
})
```

**Request interceptor:** Injects `Authorization: Bearer <token>` from localStorage.

**Response interceptor:** On 401, removes `bughunter_token` from localStorage and navigates to `/login`.

---

### 6.5 Components

#### `Dashboard.jsx`

- 4 stat cards: Total Apps, Total Runs, Total Bugs, Critical Bugs
- Recent test runs table (last 5 runs)
- Auto-polls every 5 seconds when any run is `pending` or `running`
- Displays run status badges with color coding

#### `Sidebar.jsx`

Navigation links:
- Dashboard (`/`)
- My Apps (`/apps`)
- Test Runs (`/runs`)
- Logout button

#### `AppList.jsx`

- Lists all registered apps with URL, creation date
- **Create/Edit modal** with three credential modes:
  1. **None** — no credentials
  2. **Simple** — username + password fields
  3. **SSO / Multi-Step** — `LoginFlowBuilder` component
- `LoginFlowBuilder` sub-component: dynamically add/remove/reorder login steps; each step has `action`, `selector`, `value`, `timeout` fields
- Delete app with confirmation

#### `TestRuns.jsx`

- Paginated list of test runs
- Filter by `app_id` and `status` via query params
- **New Run** button opens `NewRunModal`
- Auto-polls every 5 seconds while any run is pending/running
- Delete run button

#### `BugReports.jsx`

- Displays all bugs for a specific run (from `/api/runs/:id`)
- Filter bar: critical / high / medium / low severity buttons
- `BugCard` sub-component: expandable card showing full bug details (title, description, steps, expected/actual, severity badge, status dropdown, screenshot link)
- Status dropdown: update bug status inline via `PUT /api/bugs/:id/status`

#### `NewRunModal.jsx`

- Modal overlay
- Loads app list on mount
- Select app from dropdown
- Calls `POST /api/runs` on submit
- On success, redirects user to `/runs/:newRunId`

---

### 6.6 Vite Configuration (`vite.config.js`)

```javascript
{
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true }
    }
  }
}
```

Dev server proxies `/api/*` to backend port 5000.

---

## 7. Agent — Python/LangGraph

### 7.1 Entry Point (`main.py`)

```python
def main():
    runner = JobRunner()
    while True:
        try:
            runner.poll()
        except KeyboardInterrupt:
            break
        except Exception:
            time.sleep(5)  # exponential backoff on crash
```

- Loads `agent/.env` via `python-dotenv`
- Starts infinite JobRunner loop
- Restarts on unhandled exceptions with 5s delay

---

### 7.2 LLM Provider Factory (`providers.py`)

```python
def get_llm(provider: str = None, model: str = None, temperature: float = 0.2) -> BaseChatModel
```

Reads `LLM_PROVIDER` and `LLM_MODEL` from env. Returns a LangChain `Chat*` model instance.

| Provider | Package | Env Var | Default Model |
|---|---|---|---|
| anthropic | langchain-anthropic | ANTHROPIC_API_KEY | claude-3-5-sonnet-20241022 |
| openai | langchain-openai | OPENAI_API_KEY | gpt-4o |
| google | langchain-google-genai | GOOGLE_API_KEY | gemini-2.0-flash |
| groq | langchain-groq | GROQ_API_KEY | llama-3.3-70b-versatile |
| mistral | langchain-mistralai | MISTRAL_API_KEY | mistral-large-latest |
| ollama | langchain-ollama | OLLAMA_BASE_URL | llama3 |

Temperature is fixed at 0.2 for consistent, deterministic LLM outputs.

---

### 7.3 Agent State (`graph/state.py`)

```python
class AgentState(TypedDict):
    url: str                           # Target app URL
    credentials: Optional[Dict]        # Decrypted credentials from backend
    current_page: Optional[str]        # Last visited URL
    screenshots: List[Dict]            # {label, base64, url, timestamp, local_path}
    screenshot_paths: List[str]        # Paths (after base64 stripped)
    bugs_found: List[Dict]             # Raw bug observations (pre-report)
    test_steps: List[Dict]             # {action, selector, value, result}
    current_agent: Optional[str]       # Active agent name (for tracing)
    error: Optional[str]               # Error message if pipeline fails
    status: str                        # pending | running | completed | failed
    report: Optional[List[Dict]]       # Final structured bug reports
```

---

### 7.4 LangGraph Pipeline (`graph/graph.py`)

```python
def build_graph() -> CompiledGraph:
    graph = StateGraph(AgentState)
    graph.add_node("orchestrator", orchestrate_node)
    graph.add_node("explorer",     explore_node)
    graph.add_node("validator",    validate_node)
    graph.add_node("security",     security_node)
    graph.add_node("reporter",     report_node)

    graph.set_entry_point("orchestrator")
    graph.add_edge("orchestrator", "explorer")
    graph.add_edge("explorer",     "validator")
    graph.add_edge("validator",    "security")
    graph.add_edge("security",     "reporter")
    graph.add_edge("reporter",     END)

    return graph.compile()
```

All edges are **deterministic** — no conditional branching. Every run executes all five agents in sequence.

---

### 7.5 Nodes (`graph/nodes.py`)

Each node is a thin wrapper:

```python
def orchestrate_node(state: AgentState) -> AgentState:
    return OrchestratorAgent().run(state)

def explore_node(state: AgentState) -> AgentState:
    return ExplorerAgent().run(state)

# ... same pattern for validate_node, security_node, report_node
```

---

### 7.6 Agents

#### OrchestratorAgent (`agents/orchestrator.py`)

**Input:** `url`, `credentials`

**Process:**
1. Builds auth context description from credentials shape:
   - No credentials → "No authentication required"
   - Simple credentials → "Simple username/password at `url`"
   - Login flow → "Multi-step SSO/IDP flow"
2. Calls `get_llm().invoke(prompt)` with URL and auth context
3. LLM returns testing strategy: pages to test, user journeys, focus areas, notes

**Output mutations:**
- `test_steps`: Appended with `{ "action": "plan", "result": <llm_response> }`
- `status`: Set to `"running"`

---

#### ExplorerAgent (`agents/explorer.py`)

**Input:** `url`, `credentials`, `test_steps` (plan)

**Process:**
1. Launches headless Chromium (1280×800 viewport)
2. If credentials provided:
   - **Multi-step flow** (`credentials.login_flow`): Execute each step in sequence (fill, click, wait_for_navigation, wait_for_selector, wait). Dismiss overlays before each step. Retry with `force=True` on overlay-blocked clicks.
   - **Simple credentials**: Auto-fill email/username + password fields, click submit.
3. Navigate up to `AGENT_MAX_PAGES` pages within the same domain
4. For each page:
   - Capture full-page screenshot
   - Log console errors and network failures
   - Collect all links for further exploration
5. Close browser

**Input selectors tried for simple login:**
- Email: `input[type='email'], input[name='username'], input[name='email']`
- Password: `input[type='password']`
- Submit: `button[type='submit'], input[type='submit'], button:has-text('Login'), button:has-text('Sign in')`

**Output mutations:**
- `screenshots`: Array of `{ label, base64, url, timestamp, local_path }`
- `test_steps`: Array of navigation steps and error observations
- `current_page`: Last URL visited

---

#### ValidatorAgent (`agents/validator.py`)

**Input:** `screenshots`, `test_steps`

**Process:**
1. Iterates `test_steps` looking for `action == "observe"` or `action == "errors_detected"`
2. For each relevant step, calls LLM with step data and associated screenshot context
3. LLM identifies bugs from the categories:
   - HTTP 404 / 5xx errors
   - Broken layouts or missing UI elements
   - JavaScript console errors
   - Network request failures
   - Form validation failures
   - Incorrect or missing data
   - Accessibility violations

**Note:** Strips `base64` from screenshots at this stage (retains `local_path`) to reduce state size.

**Output mutations:**
- `bugs_found`: Appended with LLM-identified bug observations

---

#### SecurityAgent (`agents/security.py`)

**Input:** `url`, `screenshots`, `test_steps`

**Tests performed:**

**1. XSS Injection (`_test_xss`)**

Payloads (5 total, 2 tested per input):
```python
"<script>alert('XSS')</script>"
'"><script>alert(1)</script>'
"javascript:alert(1)"
"<img src=x onerror=alert(1)>"
"';alert(1)//"
```

- Tests first 3 form inputs on the page
- Checks if payload appears unescaped in response HTML

**2. SQL Injection (`_test_sqli`)**

Payloads (5 total, 2 tested per input):
```python
"' OR '1'='1"
"' OR 1=1--"
'" OR ""="'
"1; DROP TABLE users--"
"admin'--"
```

- Tests first 3 form inputs
- Checks page source for SQL error signatures: `SQL syntax`, `mysql_fetch`, `ORA-`, `syntax error`

**3. Exposed Secrets (`_check_exposed_secrets`)**

Regex patterns checked against page source:
```python
r"(?i)(api[_-]?key|apikey)\s*[=:]\s*['\"]?[\w\-]{16,}"
r"(?i)(secret[_-]?key|secretkey)\s*[=:]\s*['\"]?[\w\-]{16,}"
r"(?i)(password|passwd|pwd)\s*[=:]\s*['\"]?\w{6,}"
r"(?i)aws[_-]?(access[_-]?key|secret)\s*[=:]\s*['\"]?[\w/+=]{16,}"
```

All security bugs are marked `severity: "critical"`.

**Output mutations:**
- `bugs_found`: Appended with security findings

---

#### ReporterAgent (`agents/reporter.py`)

**Input:** `bugs_found`, `url`

**Process:**
1. For each entry in `bugs_found`, calls LLM with a structured prompt
2. LLM returns a fully structured bug report with:
   - `title` — concise bug title
   - `description` — full description
   - `steps_to_reproduce` — numbered steps
   - `expected_behavior` — what should happen
   - `actual_behavior` — what actually happens
   - `severity` — critical / high / medium / low
   - `type` — functional / security / performance / ux
   - `page_url` — URL where bug was observed
3. Builds final `report` list

**Output mutations:**
- `report`: Final list of structured bug report dicts
- `status`: Set to `"completed"`

---

### 7.7 Job Runner (`worker/runner.py`)

```python
class JobRunner:
    def __init__(self):
        self.redis = redis.Redis.from_url(REDIS_URL)
        self.graph = build_graph()

    def poll(self):
        # Blocks up to 5s waiting for a job
        result = self.redis.blpop('bughunter:jobs', timeout=5)
        if result is None:
            return

        _, raw = result
        job = json.loads(raw)

        # Mark run as "running"
        self._update_run_status(job['run_id'], 'running')

        try:
            initial_state = self._build_state(job)
            final_state = self.graph.invoke(initial_state)
            save_run_to_db(job['run_id'], 'completed', final_state)
        except Exception as exc:
            save_run_to_db(job['run_id'], 'failed', {'error': str(exc)})

    def _update_run_status(self, run_id, status):
        # PATCH /api/runs/:id with x-agent-secret header
        ...

    def _build_state(self, job) -> AgentState:
        return {
            'url': job['app_url'],
            'credentials': job.get('credentials'),
            'current_page': None,
            'screenshots': [],
            'screenshot_paths': [],
            'bugs_found': [],
            'test_steps': [],
            'current_agent': None,
            'error': None,
            'status': 'pending',
            'report': None,
        }
```

**Redis job format:**
```json
{
  "run_id": "uuid",
  "app_url": "https://example.com",
  "credentials": { "username": "...", "password": "...", "login_flow": [...] },
  "enqueued_at": "2026-03-26T12:00:00Z"
}
```

---

### 7.8 Tools

#### `tools/browser.py` — `BrowserTool`

Synchronous Playwright wrapper using `sync_playwright()`.

| Method | Description |
|---|---|
| `start()` | Launches headless Chromium, 1280×800 viewport |
| `navigate(url, wait_until)` | Navigate; default wait: `domcontentloaded` |
| `screenshot()` | Full-page PNG bytes |
| `fill_form(selector, value)` | Type text into selector |
| `click(selector, force=False)` | Click element |
| `dismiss_overlays()` | Close cookie banners / modals |
| `wait_for_selector(selector, timeout)` | Wait for DOM element |
| `wait_for_navigation(timeout)` | Wait for page navigation |
| `get_page_source()` | Return HTML string |
| `get_current_url()` | Return current URL |
| `get_title()` | Return page title |
| `get_all_links()` | Return all `<a href>` targets |
| `get_form_inputs()` | Return CSS selectors of form inputs |
| `get_console_errors()` | Return JS console error messages |
| `get_network_errors()` | Return failed network request URLs |
| `close()` | Close browser and Playwright context |

**Overlay dismissal selectors tried:**
- `#onetrust-accept-btn-handler`
- `#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll`
- `[class*='consent'] button`
- `[class*='modal'] button[class*='close']`
- `button[aria-label='Close']`

---

#### `tools/screenshot.py`

```python
def capture(page, label: str) -> Dict
```

- Captures full-page PNG
- Base64 encodes
- Saves to `agent/screenshots/<timestamp>_<label>.png`
- Returns: `{ label, base64, url, timestamp, local_path, screenshot_url }`

```python
def upload_to_s3(image_data, run_id: str, label: str) -> Optional[str]
```

- Uploads base64 image to S3 bucket
- Returns public URL or `None` if S3 not configured

---

#### `tools/storage.py`

```python
def save_run_to_db(run_id: str, status: str, results: Dict) -> bool
```

Uses `psycopg2.pool.ThreadedConnectionPool` (min=1, max=5).

**Operations:**

1. `UPDATE test_runs SET status=..., completed_at=NOW(), summary=..., error=... WHERE id=...`

   Summary JSONB:
   ```json
   {
     "total_bugs": <len(report)>,
     "pages_explored": <unique urls in test_steps>,
     "screenshots_taken": <len(screenshots)>
   }
   ```

2. For each item in `results['report']`:
   ```sql
   INSERT INTO bug_reports
     (run_id, app_id, title, description, steps_to_reproduce,
      expected_behavior, actual_behavior, severity, status,
      screenshot_url, page_url)
   VALUES (...)
   ```

---

### 7.9 Python Dependencies (`requirements.txt`)

```
langgraph>=0.2.0
langchain>=0.3.0
langchain-anthropic>=0.3.0
langchain-openai>=0.2.0
langchain-google-genai>=2.0.0
langchain-groq>=0.2.0
langchain-mistralai>=0.2.0
langchain-ollama>=0.2.0
playwright>=1.40.0
psycopg2-binary>=2.9.0
redis>=5.0.0
python-dotenv>=1.0.0
boto3>=1.34.0          # Optional S3 upload
pydantic>=2.0.0
```

---

## 8. Queue Architecture

### Dual-Queue Design

Two parallel mechanisms ensure compatibility and observability:

```
Backend (Node.js)
│
├─ RPUSH bughunter:jobs  ←── consumed by Python via BLPOP
└─ BullMQ queue.add()   ←── for monitoring, retries, dashboard
```

**Why dual?** BullMQ is a Node.js-native job queue with a web dashboard. Python cannot consume BullMQ jobs natively. The raw Redis list (`bughunter:jobs`) is the actual Python consumption channel. BullMQ runs in parallel for observability only.

### Job Lifecycle

```
POST /api/runs
    │
    ├── INSERT test_runs (status=pending)
    ├── RPUSH bughunter:jobs <job-json>
    └── BullMQ queue.add()

Python runner.poll()
    │
    ├── BLPOP bughunter:jobs (blocks up to 5s)
    ├── PATCH /api/runs/:id { status: "running" }
    ├── LangGraph pipeline...
    └── save_run_to_db() → UPDATE test_runs + INSERT bug_reports
```

### BullMQ Options

```javascript
{
  jobId: runId,           // Idempotent — prevents duplicate jobs
  attempts: 3,            // Retry on failure
  backoff: { type: 'exponential', delay: 5000 }
}
```

---

## 9. Environment Variables

### Agent (`agent/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| LLM_PROVIDER | Yes | — | anthropic / openai / google / groq / mistral / ollama |
| LLM_MODEL | No | Provider default | Override LLM model name |
| ANTHROPIC_API_KEY | If provider=anthropic | — | Anthropic API key |
| OPENAI_API_KEY | If provider=openai | — | OpenAI API key |
| GOOGLE_API_KEY | If provider=google | — | Google AI API key |
| GROQ_API_KEY | If provider=groq | — | Groq API key |
| MISTRAL_API_KEY | If provider=mistral | — | Mistral API key |
| OLLAMA_BASE_URL | If provider=ollama | http://localhost:11434 | Local Ollama endpoint |
| DATABASE_URL | Yes | — | PostgreSQL connection string |
| REDIS_URL | Yes | — | Redis connection string |
| BACKEND_URL | Yes | http://localhost:5000 | Backend base URL |
| AGENT_API_SECRET | Yes | — | Shared secret for PATCH /api/runs |
| AGENT_MAX_PAGES | No | 5 | Max pages to explore per run |
| AWS_ACCESS_KEY_ID | No | — | S3 screenshot upload |
| AWS_SECRET_ACCESS_KEY | No | — | S3 screenshot upload |
| S3_BUCKET | No | — | S3 bucket name |
| S3_REGION | No | — | S3 region |

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| PORT | No (default 5000) | Express listen port |
| DATABASE_URL | Yes | PostgreSQL connection string |
| REDIS_URL | Yes | Redis connection string |
| REDIS_PASSWORD | No | Redis password if standalone (not in URL) |
| JWT_SECRET | Yes | JWT signing secret (min 32 chars) |
| JWT_EXPIRES_IN | No (default 7d) | JWT lifetime (e.g. 7d, 24h) |
| CREDENTIALS_ENCRYPTION_KEY | Yes | 64-char hex string (32 bytes) |
| FRONTEND_URL | Yes | CORS allowed origin |
| AGENT_API_SECRET | Yes | Shared secret for agent auth |

### Generating Secrets

```bash
# JWT_SECRET and CREDENTIALS_ENCRYPTION_KEY
openssl rand -hex 32
```

---

## 10. Security

### 10.1 Credential Encryption

- **Algorithm:** AES-256-GCM
- **Key size:** 256-bit (32 bytes loaded from 64-char hex env var)
- **IV:** 96-bit random, generated per encryption call
- **Auth tag:** 128-bit — detects tampering
- **Stored as:** `iv:authTag:ciphertext` (all hex) in JSONB column
- **In-memory only:** Credentials decrypted just before passing to agent, never logged

### 10.2 Authentication

| Mechanism | Where | Algorithm |
|---|---|---|
| User login | Frontend ↔ Backend | JWT HS256, 7-day expiry |
| Agent ↔ Backend | PATCH /api/runs | Shared secret header `x-agent-secret` |
| JWT storage | Frontend | `localStorage` (`bughunter_token`) |

**Note:** Storing JWT in `localStorage` is susceptible to XSS attacks. For higher-security deployments, consider `httpOnly` cookie storage.

### 10.3 Rate Limiting

- Auth routes (`/api/auth/*`): 20 requests per 15 minutes per IP
- All other routes: No explicit limit (backend inherits express defaults)

### 10.4 Input Validation

Every API endpoint validates inputs with **Zod schemas** before processing. Validation covers:
- Email format (RFC 5321)
- URL format
- String length limits
- UUID format for ID params
- ENUM values for status/severity filters
- Integer coercion for pagination params

### 10.5 Security Headers

`helmet` middleware sets:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security`
- `Content-Security-Policy`
- (and other Helmet defaults)

### 10.6 CORS

`cors` middleware restricts origins to `FRONTEND_URL` env var. No wildcard `*` in production.

### 10.7 Secrets & .gitignore

Excluded from git:
```
.env
node_modules/
.venv/
__pycache__/
agent/screenshots/
*.pyc
```

---

## 11. Deployment

### Development Setup (Local)

```bash
# 1. Infrastructure
docker-compose up -d

# 2. Database migrations
psql postgresql://postgres:postgres@localhost:5432/bughunter \
  -f database/migrations/001_users.sql \
  -f database/migrations/002_apps.sql \
  -f database/migrations/003_test_runs.sql \
  -f database/migrations/004_bug_reports.sql \
  -f database/migrations/005_not_null_constraints.sql

# 3. Backend
cd backend && npm install
# create backend/.env
npm run dev          # nodemon, port 5000

# 4. Agent
cd agent
python -m venv .venv
source .venv/bin/activate  # or: .venv\Scripts\activate (Windows)
pip install -r requirements.txt
playwright install chromium
# create agent/.env
python main.py

# 5. Frontend
cd frontend && npm install
npm run dev          # Vite dev server, port 5173
```

### Windows PowerShell (`start.ps1`)

Convenience script that launches all three services in separate PowerShell windows.

### Production Considerations

| Concern | Recommendation |
|---|---|
| HTTPS | Terminate TLS at reverse proxy (nginx / Cloudflare) |
| JWT storage | Migrate to httpOnly cookie to prevent XSS token theft |
| Redis auth | Set strong `REDIS_PASSWORD`, disable bind 0.0.0.0 |
| Database | Use connection pooling (PgBouncer), restrict DB user permissions |
| Agent scaling | Run multiple Python workers; use BullMQ concurrency |
| Screenshot storage | Configure S3 to avoid local disk accumulation |
| Secrets rotation | Use `database/scripts/re_encrypt_credentials.js` to re-encrypt after key rotation |
| Monitoring | Add Bull Board (`@bull-board/express`) for queue visibility |

---

*This document was auto-generated from the BugHunter.AI source code on 2026-03-26.*
