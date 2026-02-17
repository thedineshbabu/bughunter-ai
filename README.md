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
│                                  │  │ (Claude Vision)  │   │    │
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

| Layer       | Technology                          |
|-------------|-------------------------------------|
| AI Agents   | LangGraph + LangChain + Claude AI   |
| Browser     | Playwright (Python)                 |
| Backend API | Node.js + Express                   |
| Frontend    | React + Vite                        |
| Database    | PostgreSQL 15                       |
| Queue       | Redis 7 + BullMQ                    |
| Storage     | AWS S3 (screenshots)                |
| Auth        | JWT                                 |

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 18+
- Python 3.11+
- `gh` CLI (for GitHub setup)

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

```bash
psql postgresql://postgres:postgres@localhost:5432/bughunter \
  -f database/migrations/001_users.sql \
  -f database/migrations/002_apps.sql \
  -f database/migrations/003_test_runs.sql \
  -f database/migrations/004_bug_reports.sql
```

### 4. Set Up the Agent (Python)

```bash
cd agent
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY and AWS credentials
python main.py
```

### 5. Set Up the Backend (Node.js)

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your JWT_SECRET
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
Analyzes the target app URL, plans the testing strategy, identifies key user flows, and initializes the state for downstream agents.

### ExplorerAgent
Uses Playwright to navigate the web application. At each page, it takes a screenshot, asks Claude what to test, performs actions (clicks, form fills, navigation), and logs all steps.

### ValidatorAgent
Reviews screenshots and interaction logs. Asks Claude to identify bugs including 404s, broken layouts, JavaScript errors, incorrect data display, and failed form validations.

### SecurityAgent
Performs active security testing: XSS injection, SQL injection attempts, authentication bypass tests, and source code inspection for exposed secrets.

### ReporterAgent
Takes the `bugs_found` list and uses Claude to generate structured bug reports with title, description, reproduction steps, expected/actual behavior, and severity classification.

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
