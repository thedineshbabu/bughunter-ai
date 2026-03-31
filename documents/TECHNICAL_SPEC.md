# BugHunter.AI — Technical Specification

> Version: 1.4 | Date: 2026-03-31 | Codebase: `bughunter-ai`

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
│   │   ├── storage.py                # PostgreSQL persistence (psycopg2)
│   │   ├── events.py                 # Redis pub/sub for SSE progress
│   │   ├── memory.py                 # Per-app memory load/save + fingerprints
│   │   ├── json_utils.py             # Extract JSON from LLM output
│   │   ├── bug_dedupe.py             # Deduplicate bugs before reporting
│   │   └── pipeline_log.py           # Compact test_steps timeline for DB summary
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
│       ├── jobs/
│       │   └── staleRunReaper.js     # Background reaper for ghost runs
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
│       │   ├── AuthContext.jsx       # Auth state + login/register/logout
│       │   ├── SidebarContext.jsx    # Collapsed sidebar state
│       │   └── NotificationContext.jsx # Global toast notifications
│       ├── data/
│       │   ├── agentProfiles.js      # Static copy for AI Agents page
│       │   └── liveEventConfig.js    # SSE event type icons/colors (shared)
│       └── components/
│           ├── Dashboard.jsx         # Stats + recent runs home page
│           ├── Sidebar.jsx           # Navigation sidebar
│           ├── AppList.jsx           # App registration CRUD
│           ├── TestRuns.jsx          # Test run list + creation
│           ├── BugReports.jsx        # Run detail: pipeline, live activity, agent logs, bugs
│           ├── AgentPipelineTracker.jsx  # 5-step agent progress (run + overview modes)
│           ├── AgentActivityLog.jsx  # Events grouped/filtered by agent
│           ├── AgentProfiles.jsx     # /agents — cards for each pipeline agent
│           ├── NewRunModal.jsx       # Modal to trigger a new run
│           ├── ErrorBoundary.jsx      # React error boundary with recovery UI
│           ├── AppHeader.jsx / AppFooter.jsx / UserProfile.jsx / ApiTesting.jsx
│           └── ...
│
├── database/
│   ├── migrations/
│   │   ├── 001_users.sql
│   │   ├── 002_apps.sql
│   │   ├── 003_test_runs.sql
│   │   ├── 004_bug_reports.sql
│   │   ├── 005_not_null_constraints.sql
│   │   ├── 006_credentials_text.sql
│   │   └── 007_app_memory.sql
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

*Smart Login (Auto-detect)* — just email and password; the agent figures out the flow:
```json
{ "username": "user@example.com", "password": "plaintext-password" }
```

*SSO / Multi-Step (manual override)* — explicit Playwright step sequence:
```json
{
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
CREATE TYPE run_status AS ENUM ('pending', 'running', 'completed', 'failed', 'paused', 'cancelled');

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
| status | run_status ENUM | pending → running → completed / failed / cancelled; paused (mid-run suspension) |
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
| POST | /api/runs/:id/stop    | JWT | Stop active run (sets Redis signal, marks cancelled) |
| POST | /api/runs/:id/pause   | JWT | Pause active run (sets Redis signal, marks paused) |
| POST | /api/runs/:id/resume  | JWT | Resume paused run (clears Redis signal, marks running) |

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
{
  "app_id": "uuid",
  "notes": "Optional notes",
  "test_config": {
    "max_pages": 10,
    "instructions": "Test the client listing page — search, filters, and pagination",
    "focus_areas": "authentication, forms, navigation"
  }
}
```

`test_config` is optional. All sub-fields are optional. Defaults: `max_pages=5`, empty instructions/focus_areas.

Flow:
1. Insert `test_runs` row with `status = 'pending'`
2. Decrypt app credentials
3. `RPUSH bughunter:jobs` (raw Redis list) + BullMQ `queue.add()` — both include `test_config`
4. Return created run

Response `201`: `{ "run": { "id": "uuid", "status": "pending", ... } }`

---

**PATCH /api/runs/:id**

Authentication via header: `x-agent-secret: <AGENT_API_SECRET>`

Request:
```json
{
  "status": "running" | "completed" | "failed" | "paused" | "cancelled",
  "summary": { "total_bugs": 5, "pages_explored": 3, "screenshots_taken": 10 },
  "error": "Optional error string"
}
```

Called internally by the Python agent after the LangGraph pipeline completes.
The persisted `test_runs.summary` JSON (written by the agent via `save_run_to_db`, not only this PATCH) may include: `strategic_plan`, `visited_urls`, `dedupe_stats`, `pipeline_log` — see §7.8.

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

**BullMQ Queue Name:** `bughunter-tests`

**Job options:**
```javascript
{
  jobId: runId,
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 }
}
```

**`enqueueTestRun(runId, appUrl, credentials, testConfig)`** does two things:
1. `RPUSH bughunter:jobs <json>` — consumed by Python via BLPOP
2. `queue.add('run-test', payload, options)` — BullMQ for monitoring/retries

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
| /agents | AgentProfiles | Yes |
| /apitest | ApiTesting | Yes |
| /profile | UserProfile | Yes |
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
- AI Agents (`/agents`) — static agent descriptions + pipeline overview
- API Testing (`/apitest`)
- Profile (`/profile`)
- Logout button

#### `AppList.jsx`

- Lists all registered apps with URL, creation date
- **Create/Edit modal** with three credential modes:
  1. **None** — no credentials
  2. **Smart Login (Auto)** — email + password; agent drives login via LLM
  3. **SSO / Multi-Step** — `LoginFlowBuilder` component (manual override)
- `LoginFlowBuilder` sub-component: dynamically add/remove/reorder login steps; each step has `action`, `selector`, `value`, `timeout` fields
- **Run** button per app row opens NewRunModal pre-selected with that app
- Delete app with confirmation

#### `TestRuns.jsx`

- Paginated list of test runs
- Filter by `app_id` and `status` via query params
- **New Run** button opens `NewRunModal`
- Auto-polls every 5 seconds while any run is pending/running/paused
- Active rows (pending/running/paused) show a **Stop** button instead of delete

#### `BugReports.jsx`

- Loads run + bugs from `GET /api/runs/:id`
- **Agent pipeline** — `AgentPipelineTracker` (live progress from SSE `agent_start` / `agent_done` with optional `clientTs` on events)
- **Live Activity / Activity Log** — flat chronological SSE stream (`GET /api/runs/:id/stream?token=…`); events cached in `localStorage` (last 500)
- **Agent logs** — `AgentActivityLog`: same events grouped by agent phase with filter pills
- Filter bar: critical / high / medium / low severity buttons
- `BugCard` sub-component: expandable card (title, description, steps, severity, status, screenshot)
- Status updates via `PUT /api/bugs/:id/status`
- **Stop** button shown for `pending`/`running` runs; **Pause** button for `running` only; **Resume** + **Stop** for `paused`
- SSE event types handled: `run_stopped`, `run_cancelled`, `run_paused`, `run_resumed`

#### `AgentProfiles.jsx` (`/agents`)

- Static content from `src/data/agentProfiles.js`: pipeline order, capability chips, tools per agent

#### `NewRunModal.jsx`

- Modal overlay
- Accepts optional `defaultAppId` prop — when passed, that app is pre-selected in the dropdown (used by the **Run** button on `AppList`)
- Loads app list on mount
- Select app from dropdown
- **Test Configuration section:**
  - *What to test* — free-text instructions passed to the agent (e.g. `"Test client listing page — search, filters, pagination"`)
  - *Focus areas* — comma-separated areas to prioritize (e.g. `"authentication, forms"`)
  - *Pages to explore* — range slider 1–20 (default 5)
  - *Capture login step screenshots* toggle — screenshot after each auto-login step (default **on**)
  - *Detailed AI report* toggle — AI enriches each bug with structured report; off = **quick mode** (bugs logged directly without LLM enrichment, uses `SimpleReporterAgent`) (default **off**)
- Optional *Notes* field for run-level record-keeping
- Sends `test_config` object in `POST /api/runs` body
- On success, redirects user to `/runs/:newRunId`

---

### 6.6 Vite Configuration (`vite.config.js`)

```javascript
{
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
      '/screenshots': { target: 'http://localhost:5000', changeOrigin: true }
    }
  }
}
```

Dev server proxies `/api/*` and `/screenshots/*` to backend port 5000.

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
| claude_cli | subprocess CLI | — | claude-sonnet-4-6 (see `providers.py`) |

Temperature is fixed at 0.2 for consistent, deterministic LLM outputs.

**SSE progress:** `tools/events.publish_event` writes to Redis channel `bughunter:run:{run_id}:progress`; the backend exposes `GET /api/runs/:id/stream` for the frontend.

---

### 7.3 Agent State (`graph/state.py`)

```python
class AgentState(TypedDict):
    run_id: Optional[str]              # UUID of the test run (for SSE publishing)
    url: str                           # Target app URL
    credentials: Optional[Dict]        # Decrypted credentials from backend
    test_config: Optional[Dict]        # {max_pages, instructions, focus_areas}
    current_page: Optional[str]        # Last visited URL
    screenshots: List[Dict]            # {label, base64, url, timestamp, local_path}
    screenshot_paths: List[str]        # Paths (after base64 stripped)
    bugs_found: List[Dict]             # Raw observations; deduped before reporting
    test_steps: List[Dict]             # plan, observe, errors_detected, login_*, etc.
    current_agent: Optional[str]       # Active agent name (for tracing)
    error: Optional[str]               # Error message if pipeline fails
    status: str                        # pending | running | completed | failed
    report: Optional[List[Dict]]       # Final structured bug reports
    app_memory: Optional[Dict]         # Per-app memory from PostgreSQL
    login_steps_for_memory: Optional[List[Dict]]  # Persisted login flow for next run
    strategic_plan: Optional[Dict]     # Parsed orchestrator JSON (pages, journeys, focus_areas, notes)
    visited_urls: Optional[List[str]]  # Explorer URLs — drives SecurityAgent multi-scan
    dedupe_stats: Optional[Dict]       # {before, after, removed} from ReporterAgent
```

**`test_config` shape:**
```python
{
    "max_pages": 10,           # Override AGENT_MAX_PAGES for this run
    "instructions": "...",     # Free-text guidance for Orchestrator + Explorer
    "focus_areas": "...",      # Comma-separated areas to prioritise
}
```

---

### 7.4 LangGraph Pipeline (`graph/graph.py`)

```python
def build_graph() -> CompiledGraph:
    graph = StateGraph(AgentState)
    graph.add_node("orchestrator", orchestrator_node)
    graph.add_node("explorer",     explorer_node)
    graph.add_node("validator",    validator_node)
    graph.add_node("security",     security_node)
    graph.add_node("reporter",     reporter_node)

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
def orchestrator_node(state: AgentState) -> AgentState:
    return OrchestratorAgent().run(state)

def explorer_node(state: AgentState) -> AgentState:
    return ExplorerAgent().run(state)

# ... same pattern for validator_node, security_node, reporter_node
```

---

### 7.6 Agents

#### OrchestratorAgent (`agents/orchestrator.py`)

**Input:** `url`, `credentials`, `test_config`, `app_memory`

**Process:**
1. Builds auth context description from credentials shape:
   - No credentials → anonymous testing
   - `{username, password}` → simple credentials
   - `{login_flow}` → "Multi-step SSO/IDP flow (N steps)"
2. Incorporates `test_config` and **app memory** (known bugs, bug-prone pages) into the planning prompt.
3. Asks the LLM for **JSON** with keys: `pages`, `user_journeys`, `focus_areas`, `notes` (paths may be relative or absolute).
4. Parses JSON via `tools/json_utils.extract_json_from_text` into **`strategic_plan`**. On parse failure, stores raw text in `notes`.

**Output mutations:**
- `strategic_plan`: `{ pages, user_journeys, focus_areas, notes }`
- `test_steps`: `{ "action": "plan", "detail": <raw_llm_text>, "agent": "orchestrator" }`
- `status`: `"running"`

---

#### ExplorerAgent (`agents/explorer.py`)

**Input:** `url`, `credentials`, `test_config`, `test_steps` (includes plan step), **`strategic_plan`**

**Process:**
1. Launches headless Chromium (1280×800 viewport)
2. Reads `test_config.max_pages` (falls back to `AGENT_MAX_PAGES` env var, default 5)
3. **URL priority:** Normalizes `strategic_plan.pages` to same-origin absolute URLs, then **merges** with `build_page_priority_list(app_memory)` (historically bug-prone pages). Orchestrator URLs are tried first.
4. If credentials provided, selects login strategy:
   - **Option A — SSO / Multi-Step** (`credentials.login_flow`): Execute each pre-configured step in sequence. Dismiss overlays before each step. Retry with `force=True` on overlay-blocked clicks.
   - **Option B — Smart Login (Auto)** (`credentials.username` + `credentials.password`): LLM-driven iterative login loop (see below).
4. Navigate up to `max_pages` pages within the same domain
5. For each page:
   - Capture full-page screenshot
   - Call `inspect_page_structure()` — runs DOM queries via `page.evaluate()` to extract structured data: headings, forms with field labels/types, tables with headers + row count, and key-value pairs
   - Ask LLM what to test (`_ask_what_to_test(page_structure)`) — prompt now shows structured sections (Page sections, Forms, Data tables, Key data) instead of raw truncated HTML; also includes **`strategic_plan`** (notes, user journeys, orchestrator `focus_areas`) and `test_config.instructions` / `focus_areas`
   - Append `observe` step (including `"page_structure"` key alongside `detail`, `screenshot_label`, etc.) and (when present) `errors_detected` steps for ValidatorAgent
   - Log console errors and network failures
   - Collect all links for further exploration
   - Check control signal (`check_run_control`) at the top of each page loop iteration; call `wait_while_paused()` on pause signal
6. Close browser

**Smart Login loop (Option B):**

Replaces the old dumb single-attempt login. Runs up to 12 iterations:
1. Dismiss overlays, read current page HTML
2. If URL is no longer a login/auth page (after first step) → success
3. Build prompt with current HTML + email (never password) using `__PASSWORD__` placeholder
4. LLM returns one action: `{action, selector, value, done}`
5. Substitute `__PASSWORD__` → real password locally before execution
6. Execute action (fill / click / wait_for_navigation / wait_for_selector)
7. Repeat; stop when LLM sets `done=true`, URL escapes auth pages, or 12 iterations reached

The real password is **never sent to the LLM**. Works for:
- Standard single-page login forms
- Email-first pages (password appears on second page)
- SSO/IDP redirects (Microsoft Entra, Okta, Google)

**Additional per-page checks:**
- **Form Fuzzing** (`_fuzz_forms()`): Tests up to 3 form inputs with edge-case payloads (empty string, 5000-char string, special characters, unicode, negative numbers, `<script>` tag, SQL single quote). Submits form and checks for error indicators in page source and console errors.
- **Performance Checks** (`_check_performance()`): Uses Navigation Timing API via `page.evaluate()` to measure `dom_content_loaded`, `load_complete`, and `ttfb`. Flags pages with >5000ms load time or >2000ms TTFB.
- **Accessibility Audits** (`_check_accessibility()`): Uses `page.evaluate()` to check for: images without alt text, form inputs without labels/aria-labels, buttons without accessible text, missing `<html lang>` attribute, heading level skips (e.g. h1 → h3).

**Output mutations:**
- `screenshots`: Array of `{ label, base64, url, timestamp, local_path }`
- `test_steps`: Navigation steps, per-iteration smart login records, error observations, fuzz/perf/a11y results
- `bugs_found`: Appended with form fuzzing, performance, and accessibility bugs
- `current_page`: Last URL visited
- `visited_urls`: Ordered list of URLs visited (used by SecurityAgent)

---

#### ValidatorAgent (`agents/validator.py`)

**Input:** `screenshots`, `test_steps`, `app_memory`

**Process:**

Phase 1 — Text-based analysis:
1. Iterates `test_steps` looking for `action == "observe"` or `action == "errors_detected"`
2. For each relevant step, calls LLM with step data and known bug context from `app_memory.known_bugs`
3. LLM identifies bugs from the categories:
   - HTTP 404 / 5xx errors
   - Broken layouts or missing UI elements
   - JavaScript console errors
   - Network request failures
   - Form validation failures
   - Incorrect or missing data
   - Accessibility violations

Phase 2 — Vision-based analysis:
1. Iterates `screenshots` that have `base64` data
2. Sends each screenshot as a **multimodal `HumanMessage`** with `image_url` content type
3. LLM analyzes the visual screenshot for visual-only bugs:
   - Broken or misaligned layouts
   - Missing images or icons
   - Text overflow or truncation
   - Visual inconsistencies
4. Filters out low-confidence results
5. Checks `SIGNAL_STOP` between screenshots for cancellation support

**Note:** Strips `base64` from screenshots after validation to reduce state size.

**Output mutations:**
- `bugs_found`: Appended with both text-based and vision-identified bug observations

---

#### SecurityAgent (`agents/security.py`)

**Input:** `url`, **`visited_urls`** (from Explorer), `app_memory`, `skills`

**Target URLs:** Deduped list of `url` plus `visited_urls`, capped by **`SECURITY_MAX_URLS`** (default `6`; set in `agent/.env`).

**Adaptive Payloads:** Before scanning, builds XSS and SQLi payload lists from:
- Default hardcoded payloads
- Previously effective payloads from `app_memory.known_bugs` (security type bugs)
- Learned payloads from `agent_skills` table (skill_type = `effective_payload`)

**Per URL:** One browser session runs XSS probes, then SQLi probes, then a regex **secret** scan on the final HTML. First 3 form inputs; adaptive XSS and SQLi payloads per input.

**Additional checks** (run once on seed URL after URL scanning):
- **HTTP Security Headers:** Checks for HSTS, X-Content-Type-Options, X-Frame-Options, Content-Security-Policy
- **Cookie Security:** Checks HttpOnly, Secure (on HTTPS), SameSite flags on all cookies
- **CSRF Protection:** Uses `page.evaluate()` to find POST forms missing CSRF tokens (checks for input names containing csrf/token/_token/authenticity_token)

**Secret findings:** Severity **`high`** (not critical) with copy noting possible false positives.

**Output mutations:**
- `bugs_found`: Appended with security findings (XSS, SQLi, secrets, headers, cookies, CSRF)

---

#### ReporterAgent (`agents/reporter.py`)

**Input:** `bugs_found`, `app_memory` (for regression fingerprints)

**Process:**
1. **`dedupe_bugs`** (`tools/bug_dedupe.py`) — removes duplicate observations using both fingerprint matching and **semantic similarity** (SequenceMatcher, threshold 0.70 for titles and descriptions on same page/type); records **`dedupe_stats`** `{ before, after, removed, semantic_removed }`.
2. For each remaining entry, calls LLM with a structured prompt
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
- `bugs_found`: Replaced with deduped list (aligned with reports)
- `report`: Final list of structured bug report dicts
- `dedupe_stats`: Deduplication counts
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
            # Determine final status: cancelled if a stop signal was set, otherwise completed
            was_stopped = check_run_control(job['run_id']) == SIGNAL_STOP
            final_status = 'cancelled' if was_stopped else 'completed'
            save_run_to_db(job['run_id'], final_status, final_state)
        except Exception as exc:
            save_run_to_db(job['run_id'], 'failed', {'error': str(exc)})
        finally:
            clear_run_control(job['run_id'])  # Always clear the control key

    def _update_run_status(self, run_id, status):
        # PATCH /api/runs/:id with x-agent-secret header
        ...

    def _build_state(self, job) -> AgentState:
        return {
            'run_id': job['run_id'],
            'url': job['app_url'],
            'credentials': job.get('credentials'),
            'test_config': job.get('test_config'),
            'current_page': None,
            'screenshots': [],
            'screenshot_paths': [],
            'bugs_found': [],
            'test_steps': [],
            'current_agent': None,
            'error': None,
            'status': 'running',
            'report': None,
            'app_memory': load_memory(app_id) if app_id else {},
            'skills': load_agent_skills(app_id, 'all') if app_id else [],
            'app_id': app_id,
            'login_steps_for_memory': None,
            'strategic_plan': None,
            'visited_urls': None,
            'dedupe_stats': None,
        }
```

**Heartbeat:** During pipeline execution, a background thread writes a Redis key `bughunter:heartbeat:{run_id}` every 30 seconds with a 90-second TTL. This allows the backend's stale run reaper to detect crashed workers.

**Post-run memory/skills:** After a successful (non-cancelled) run:
1. `extract_memory_updates(final_state, app_memory)` — updates login steps, page priority scores, known bug fingerprints, run metadata
2. `save_memory(app_id, updated_memory)` — persists to `app_memory` table
3. `extract_and_save_skills(run_id, app_id, final_state)` — extracts page→bug_type patterns and effective security payloads into `agent_skills` table

**Redis job format:**
```json
{
  "run_id": "uuid",
  "app_url": "https://example.com",
  "credentials": { "username": "...", "password": "..." },
  "test_config": {
    "max_pages": 10,
    "instructions": "Test the client listing page",
    "focus_areas": "authentication, forms"
  },
  "enqueued_at": "2026-03-29T12:00:00Z"
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
| `inspect_page_structure()` | Return structured page data: headings, forms with field labels/types, tables with headers + row count, key-value pairs. Runs DOM queries via `page.evaluate()` |
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

#### `tools/control.py` — Run Control Signals

Redis-based mechanism for stopping or pausing active runs.

**Key:** `bughunter:control:{run_id}` — set by the backend; TTL 1 hour.

**Values:** `"stop"` | `"pause"`

| Function | Description |
|---|---|
| `check_run_control(run_id)` | Returns current signal string or `None` |
| `wait_while_paused(run_id)` | Blocks until signal is no longer `"pause"`; returns `True` if stopped while waiting |
| `clear_run_control(run_id)` | Deletes the key (called in `finally` block of `runner.poll()`) |

All five agents check the stop signal at entry and return early if stopped. ExplorerAgent additionally checks at the top of every page loop iteration and calls `wait_while_paused()` on pause.

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

#### `tools/bug_dedupe.py` / `tools/pipeline_log.py` / `tools/json_utils.py`

- **`dedupe_bugs(bugs)`** — three-tier deduplication: (1) exact fingerprint match, (2) same page + title similarity >= 0.70 via `SequenceMatcher`, (3) same page + same type + description similarity >= 0.70. Merges severity (keeps highest). Tracks `semantic_removed` count.
- **`build_pipeline_log(test_steps)`** — compact step timeline stored in `test_runs.summary`.
- **`extract_json_from_text(text)`** — used by OrchestratorAgent to parse strategic JSON.

#### `tools/storage.py`

```python
def save_run_to_db(run_id: str, status: str, results: Dict) -> bool
```

Uses `psycopg2.pool.ThreadedConnectionPool` (min=1, max=5).

**Operations:**

1. `UPDATE test_runs SET status=..., completed_at=NOW(), summary=..., error=... WHERE id=...`

   Summary JSONB (extended):
   ```json
   {
     "total_bugs": <len(bugs_found after dedupe)>,
     "pages_explored": <unique pages from screenshots>,
     "screenshots_taken": <len(screenshots)>,
     "pages_visited": [ ... ],
     "strategic_plan": { "pages": [], "user_journeys": [], "focus_areas": "", "notes": "" },
     "visited_urls": [ "https://..." ],
     "dedupe_stats": { "before": 12, "after": 9, "removed": 3 },
     "pipeline_log": [ { "agent": "explorer", "action": "observe", "url": "..." } ]
   }
   ```
   `pipeline_log` is produced by `tools/pipeline_log.build_pipeline_log(test_steps)` (truncated list for tuning/debugging).

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
| AGENT_MAX_PAGES | No | 5 | Default max pages per run (overridable per-run via `test_config.max_pages`) |
| SECURITY_MAX_URLS | No | 6 | Max URLs for XSS/SQLi/secret scans (seed + explorer `visited_urls`) |
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
| LOG_LEVEL | No (default info) | Winston log level (error/warn/info/debug) |
| RATE_LIMIT_MAX | No (default 100) | Max API requests per 15 minutes per IP |
| KF_EMAIL | No | Email for Korn Ferry Talent auto-registration on startup |
| KF_IDP_PASSWORD | No | IDP password for Korn Ferry Talent auto-registration on startup |

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

- **Global API limiter** (`/api/*`): 100 requests per 15 minutes per IP (configurable via `RATE_LIMIT_MAX` env var)
- Auth routes (`/api/auth/*`): Stricter — 20 requests per 15 minutes per IP
- Health endpoint (`/health`): Excluded from rate limiting

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
  -f database/migrations/005_not_null_constraints.sql \
  -f database/migrations/006_credentials_text.sql \
  -f database/migrations/007_app_memory.sql

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
| Rate limiting | Tune `RATE_LIMIT_MAX` env var for production traffic patterns |
| Logging | Set `LOG_LEVEL=warn` in production to reduce log volume; logs are structured JSON |

### Observability

**Request logging:** Every HTTP request is logged with method, path, status code, duration (ms), and client IP. Status >= 500 logged as `error`, >= 400 as `warn`.

**Deep health check:** `GET /health` probes PostgreSQL (`SELECT 1`) and Redis (`PING`). Returns `503` with `status: "degraded"` if either fails, including uptime in seconds.

**Stale run reaper** (`backend/src/jobs/staleRunReaper.js`): Runs every 60 seconds. Finds runs in `running` status older than 3 minutes, checks their Redis heartbeat key (`bughunter:heartbeat:{run_id}`). If the heartbeat is missing or stale (> 90s), marks the run as `failed` with a descriptive error message. Prevents ghost runs when agent workers crash.

---

*Document maintained against the BugHunter.AI source code. Last updated: 2026-03-31.*
