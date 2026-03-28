#!/usr/bin/env bash
# BugHunter.AI - Full stack startup script (Bash / Linux / macOS)
#
# Steps:
#   1. Checks prerequisites (docker, node, npm, python3)
#   2. Starts Docker containers (PostgreSQL + Redis)
#   3. Waits for both services to be healthy
#   4. Runs all database migrations (idempotent)
#   5. Verifies and bootstraps .env files for agent and backend
#   6. Sets up Python virtual environment and installs dependencies
#   7. Installs Node.js dependencies for backend and frontend
#   8. Launches agent, backend, and frontend as background processes
#      (logs written to ./logs/{agent,backend,frontend}.log)
#   9. Prints a summary and waits; Ctrl-C kills all three services

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT="$SCRIPT_DIR/agent"
BACKEND="$SCRIPT_DIR/backend"
FRONTEND="$SCRIPT_DIR/frontend"
LOG_DIR="$SCRIPT_DIR/logs"

# ANSI colours
CYN='\033[0;36m'; GRN='\033[0;32m'; YLW='\033[0;33m'
RED='\033[0;31m'; GRY='\033[0;90m'; MAG='\033[0;35m'; RST='\033[0m'

step()  { echo -e "\n${CYN}==> $*${RST}"; }
ok()    { echo -e "${GRN}    [OK]   $*${RST}"; }
warn()  { echo -e "${YLW}    [WARN] $*${RST}"; }
fail()  { echo -e "${RED}    [FAIL] $*${RST}"; exit 1; }
info()  { echo -e "${GRY}    [INFO] $*${RST}"; }

# PID tracking for cleanup
PIDS=()

cleanup() {
    echo -e "\n${MAG}Stopping BugHunter.AI services...${RST}"
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" && info "Stopped PID $pid"
        fi
    done
    echo -e "${MAG}Done. Run 'docker compose down' to stop containers.${RST}"
}
trap cleanup SIGINT SIGTERM EXIT

# ------------------------------------
# Helpers
# ------------------------------------
require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "'$1' not found in PATH. Please install it first."
}

port_free() {
    ! (lsof -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | grep -q .)
}

read_env_key() {
    local file="$1" key="$2"
    grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d ' '
}

# ------------------------------------
# 1. Prerequisites
# ------------------------------------
step "Checking prerequisites"
require_cmd docker
require_cmd node
require_cmd npm
# Prefer python3; fall back to python
PYTHON_CMD="python3"
command -v python3 >/dev/null 2>&1 || PYTHON_CMD="python"
command -v "$PYTHON_CMD" >/dev/null 2>&1 || fail "Neither 'python3' nor 'python' found in PATH."
ok "docker, node, npm, $PYTHON_CMD all found"
info "node $(node --version)  |  $($PYTHON_CMD --version 2>&1)  |  $(docker --version)"

# ------------------------------------
# 2. Start Docker services
# ------------------------------------
step "Starting Docker containers (PostgreSQL + Redis)"
(cd "$SCRIPT_DIR" && docker compose up -d) || fail "docker compose failed. Is Docker running?"
ok "docker compose started"

# ------------------------------------
# 3. Wait for PostgreSQL
# ------------------------------------
step "Waiting for PostgreSQL to be healthy"
MAX=30; N=0
until [ "$(docker inspect --format='{{.State.Health.Status}}' bughunter-postgres 2>/dev/null)" = "healthy" ]; do
    N=$((N+1))
    [ $N -ge $MAX ] && { docker compose logs postgres; fail "PostgreSQL did not become healthy in time."; }
    info "Attempt $N/$MAX — $(docker inspect --format='{{.State.Health.Status}}' bughunter-postgres 2>/dev/null || echo 'starting')"
    sleep 2
done
ok "PostgreSQL is healthy"

# ------------------------------------
# 4. Wait for Redis
# ------------------------------------
step "Waiting for Redis to be healthy"
N=0
until [ "$(docker inspect --format='{{.State.Health.Status}}' bughunter-redis 2>/dev/null)" = "healthy" ]; do
    N=$((N+1))
    [ $N -ge $MAX ] && { docker compose logs redis; fail "Redis did not become healthy in time."; }
    info "Attempt $N/$MAX — $(docker inspect --format='{{.State.Health.Status}}' bughunter-redis 2>/dev/null || echo 'starting')"
    sleep 2
done
ok "Redis is healthy"

# ------------------------------------
# 5. Database migrations
# ------------------------------------
step "Running database migrations"

MIGRATIONS=(
    "database/migrations/001_users.sql"
    "database/migrations/002_apps.sql"
    "database/migrations/003_test_runs.sql"
    "database/migrations/004_bug_reports.sql"
    "database/migrations/005_not_null_constraints.sql"
)

for mig in "${MIGRATIONS[@]}"; do
    full="$SCRIPT_DIR/$mig"
    if [ -f "$full" ]; then
        if docker exec -i bughunter-postgres psql -U postgres -d bughunter < "$full" 2>/dev/null; then
            ok "Applied: $mig"
        else
            warn "Migration '$mig' returned non-zero (table may already exist — continuing)"
        fi
    else
        warn "Not found, skipping: $mig"
    fi
done

# ------------------------------------
# 6. Verify .env files
# ------------------------------------
step "Verifying .env files"

verify_env() {
    local dir="$1" name="$2"
    shift 2
    local required=("$@")
    local envfile="$dir/.env"
    local example="$dir/.env.example"

    if [ ! -f "$envfile" ]; then
        if [ -f "$example" ]; then
            cp "$example" "$envfile"
            warn "$name/.env missing — copied from .env.example. Fill in real values before production."
        else
            fail "$name/.env not found and no .env.example to copy from."
        fi
    else
        ok "$name/.env exists"
    fi

    local placeholders=("change-me" "your-" "generate-with" "changeme")
    for key in "${required[@]}"; do
        val="$(read_env_key "$envfile" "$key")"
        if [ -z "$val" ]; then
            warn "$name/.env: '$key' is missing or empty"
        else
            local is_ph=false
            for ph in "${placeholders[@]}"; do
                [[ "$val" == *"$ph"* ]] && { is_ph=true; break; }
            done
            if $is_ph; then
                warn "$name/.env: '$key' still contains a placeholder — update before production"
            else
                ok "$name/.env: $key OK"
            fi
        fi
    done
}

verify_env "$AGENT"   "agent"   LLM_PROVIDER DATABASE_URL REDIS_URL BACKEND_URL AGENT_API_SECRET
verify_env "$BACKEND" "backend" PORT DATABASE_URL REDIS_URL JWT_SECRET FRONTEND_URL AGENT_API_SECRET CREDENTIALS_ENCRYPTION_KEY

# Validate LLM provider key
provider="$(read_env_key "$AGENT/.env" LLM_PROVIDER)"
declare -A LLM_KEYS=( [anthropic]=ANTHROPIC_API_KEY [openai]=OPENAI_API_KEY
                       [google]=GOOGLE_API_KEY [groq]=GROQ_API_KEY [mistral]=MISTRAL_API_KEY )
if [[ "$provider" == "ollama" || "$provider" == "claude_cli" ]]; then
    ok "agent/.env: provider '$provider' — no API key required"
elif [[ -n "${LLM_KEYS[$provider]:-}" ]]; then
    keyname="${LLM_KEYS[$provider]}"
    keyval="$(read_env_key "$AGENT/.env" "$keyname")"
    if [[ -z "$keyval" || "$keyval" == *"your-"* ]]; then
        warn "agent/.env: LLM_PROVIDER=$provider but '$keyname' is missing or placeholder"
    else
        ok "agent/.env: $keyname set for provider '$provider'"
    fi
else
    warn "agent/.env: Unknown LLM_PROVIDER '$provider'"
fi

# ------------------------------------
# 7. Python virtual environment
# ------------------------------------
step "Preparing Python virtual environment"

VENV="$AGENT/.venv"
PIP="$VENV/bin/pip"
PYTHON_EXE="$VENV/bin/python"

if [ ! -d "$VENV" ]; then
    info "Creating .venv..."
    "$PYTHON_CMD" -m venv "$VENV" || fail "python -m venv failed"
fi

info "Installing Python dependencies..."
"$PIP" install -r "$AGENT/requirements.txt" --quiet || fail "pip install failed"

info "Installing Playwright Chromium..."
"$PYTHON_EXE" -m playwright install chromium 2>&1 | while IFS= read -r line; do info "$line"; done

ok "Python environment ready ($PYTHON_EXE)"

# ------------------------------------
# 8. Node.js dependencies
# ------------------------------------
step "Installing Node.js dependencies"

for dir in "$BACKEND" "$FRONTEND"; do
    name="$(basename "$dir")"
    if [ ! -d "$dir/node_modules" ]; then
        info "npm install in $name..."
        (cd "$dir" && npm install --silent) || fail "npm install failed in $name"
        ok "$name dependencies installed"
    else
        ok "$name/node_modules present — skipping install"
    fi
done

# ------------------------------------
# 9. Port availability
# ------------------------------------
step "Checking port availability"

declare -A PORTS=( [5000]="Backend" [5001]="Agent API" [5173]="Frontend" )
for port in "${!PORTS[@]}"; do
    if port_free "$port"; then
        ok "Port $port (${PORTS[$port]}) is free"
    else
        warn "Port $port (${PORTS[$port]}) is already in use — service may fail to bind"
    fi
done

# ------------------------------------
# 10. Launch services (background)
# ------------------------------------
step "Launching services"

mkdir -p "$LOG_DIR"

# Agent (includes Flask API on :5001 + Redis worker)
"$PYTHON_EXE" "$AGENT/main.py" > "$LOG_DIR/agent.log" 2>&1 &
PIDS+=($!)
ok "Agent started        (PID ${PIDS[-1]}  |  logs/agent.log)"

sleep 1   # let agent API bind before backend starts

# Backend
(cd "$BACKEND" && npm run dev) > "$LOG_DIR/backend.log" 2>&1 &
PIDS+=($!)
ok "Backend started      (PID ${PIDS[-1]}  |  logs/backend.log  |  http://localhost:5000)"

# Frontend
(cd "$FRONTEND" && npm run dev) > "$LOG_DIR/frontend.log" 2>&1 &
PIDS+=($!)
ok "Frontend started     (PID ${PIDS[-1]}  |  logs/frontend.log  |  http://localhost:5173)"

# ------------------------------------
# Done — wait and handle Ctrl-C
# ------------------------------------
echo ""
echo -e "${MAG}=========================================${RST}"
echo -e "${MAG}   BugHunter.AI is running!             ${RST}"
echo -e "${MAG}=========================================${RST}"
echo ""
echo -e "  Frontend     ->  http://localhost:5173"
echo -e "  Backend API  ->  http://localhost:5000"
echo -e "  Agent API    ->  http://localhost:5001"
echo -e "  PostgreSQL   ->  localhost:5432  (db: bughunter)"
echo -e "  Redis        ->  localhost:6379"
echo ""
echo -e "${GRY}  PIDs: agent=${PIDS[0]}  backend=${PIDS[1]}  frontend=${PIDS[2]}${RST}"
echo -e "${GRY}  Logs: tail -f logs/agent.log   (or backend.log / frontend.log)${RST}"
echo -e "${GRY}  Press Ctrl-C to stop all services.${RST}"
echo ""

# Wait for all background jobs; exit when any one exits unexpectedly
wait "${PIDS[@]}"
