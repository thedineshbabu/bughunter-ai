#Requires -Version 5.1
<#
.SYNOPSIS
    BugHunter.AI - Full stack startup script
.DESCRIPTION
    1. Starts Docker dependencies (PostgreSQL + Redis)
    2. Runs database migrations
    3. Verifies .env files for agent and backend
    4. Launches agent, backend, and frontend in separate windows
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root     = $PSScriptRoot
$Agent    = Join-Path $Root "agent"
$Backend  = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"

# ------------------------------------
# Helpers
# ------------------------------------
function Write-Step { param([string]$msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK   { param([string]$msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "    [WARN] $msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$msg) Write-Host "    [FAIL] $msg" -ForegroundColor Red }

function Require-Command {
    param([string]$cmd)
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Fail "'$cmd' not found in PATH. Please install it first."
        exit 1
    }
}

# ------------------------------------
# 1. Prerequisite checks
# ------------------------------------
Write-Step "Checking prerequisites"
Require-Command "docker"
Require-Command "node"
Require-Command "npm"
Require-Command "python"
Write-OK "docker, node, npm, python all found"

# ------------------------------------
# 2. Start Docker services
# ------------------------------------
Write-Step "Starting Docker containers (PostgreSQL + Redis)"
Push-Location $Root
docker compose up -d
$dockerExit = $LASTEXITCODE
Pop-Location
if ($dockerExit -ne 0) {
    Write-Fail "docker compose failed with exit code $dockerExit"
    exit 1
}
Write-OK "Containers started"

# ------------------------------------
# 3. Wait for PostgreSQL to be healthy
# ------------------------------------
Write-Step "Waiting for PostgreSQL to be ready"
$maxAttempts = 20
$attempt = 0
do {
    Start-Sleep -Seconds 2
    $attempt++
    $fmt = '{{.State.Health.Status}}'
    $status = docker inspect --format=$fmt bughunter-postgres 2>$null
    Write-Host "    Attempt $attempt/$maxAttempts - status: $status"
} while ($status -ne "healthy" -and $attempt -lt $maxAttempts)

if ($status -ne "healthy") {
    Write-Fail "PostgreSQL did not become healthy in time."
    exit 1
}
Write-OK "PostgreSQL is healthy"

# ------------------------------------
# 4. Run database migrations
# ------------------------------------
Write-Step "Running database migrations"
$migrations = @(
    "database/migrations/001_users.sql",
    "database/migrations/002_apps.sql",
    "database/migrations/003_test_runs.sql",
    "database/migrations/004_bug_reports.sql",
    "database/migrations/005_not_null_constraints.sql"
)

foreach ($migration in $migrations) {
    $fullPath = Join-Path $Root $migration
    if (Test-Path $fullPath) {
        $content = Get-Content $fullPath -Raw
        $content | docker exec -i bughunter-postgres psql -U postgres -d bughunter 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Migration $migration returned exit code $LASTEXITCODE (table may already exist, continuing)"
        } else {
            Write-OK "Applied: $migration"
        }
    } else {
        Write-Warn "Migration file not found, skipping: $migration"
    }
}

# ------------------------------------
# 5. Verify .env files
# ------------------------------------
Write-Step "Verifying .env files"

function Read-EnvFile {
    param([string]$path)
    $table = @{}
    Get-Content $path | Where-Object {
        $_ -notmatch '^\s*#' -and $_ -notmatch '^\s*$' -and $_ -match '='
    } | ForEach-Object {
        $parts = $_ -split '=', 2
        $table[$parts[0].Trim()] = $parts[1].Trim()
    }
    return $table
}

function Verify-EnvFile {
    param(
        [string]$dir,
        [string]$displayName,
        [string[]]$requiredKeys
    )

    $envFile     = Join-Path $dir ".env"
    $exampleFile = Join-Path $dir ".env.example"

    if (-not (Test-Path $envFile)) {
        if (Test-Path $exampleFile) {
            Copy-Item $exampleFile $envFile
            Write-Warn "$displayName/.env was missing - copied from .env.example. Fill in real values before production."
        } else {
            Write-Fail "$displayName/.env not found and no .env.example to copy from."
            exit 1
        }
    } else {
        Write-OK "$displayName/.env exists"
    }

    $envVars = Read-EnvFile $envFile
    $placeholders = @("change-me", "your-", "generate-with", "changeme")

    foreach ($key in $requiredKeys) {
        if (-not $envVars.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($envVars[$key])) {
            Write-Warn "$displayName/.env: '$key' is missing or empty"
        } else {
            $val = $envVars[$key]
            $isPlaceholder = $false
            foreach ($ph in $placeholders) {
                if ($val -like "*$ph*") {
                    $isPlaceholder = $true
                    break
                }
            }
            if ($isPlaceholder) {
                Write-Warn "$displayName/.env: '$key' still contains a placeholder value"
            } else {
                Write-OK "$displayName/.env: $key = OK"
            }
        }
    }
}

$agentRequired   = @("LLM_PROVIDER", "DATABASE_URL", "REDIS_URL", "BACKEND_URL", "AGENT_API_SECRET")
$backendRequired = @("PORT", "DATABASE_URL", "REDIS_URL", "JWT_SECRET", "FRONTEND_URL", "AGENT_API_SECRET", "CREDENTIALS_ENCRYPTION_KEY")

Verify-EnvFile $Agent   "agent"   $agentRequired
Verify-EnvFile $Backend "backend" $backendRequired

# Check that the LLM API key matches the configured provider
$agentEnv = Read-EnvFile (Join-Path $Agent ".env")
$provider = $agentEnv["LLM_PROVIDER"]
$llmKeyMap = @{
    "anthropic" = "ANTHROPIC_API_KEY"
    "openai"    = "OPENAI_API_KEY"
    "google"    = "GOOGLE_API_KEY"
    "groq"      = "GROQ_API_KEY"
    "mistral"   = "MISTRAL_API_KEY"
}
if ($llmKeyMap.ContainsKey($provider)) {
    $keyName = $llmKeyMap[$provider]
    if (-not $agentEnv.ContainsKey($keyName) -or $agentEnv[$keyName] -like "*your-*") {
        Write-Warn "agent/.env: LLM_PROVIDER=$provider but '$keyName' is not set or is a placeholder"
    } else {
        Write-OK "agent/.env: $keyName is set for provider '$provider'"
    }
} elseif ($provider -eq "ollama") {
    Write-OK "agent/.env: Ollama provider - no API key needed"
} else {
    Write-Warn "agent/.env: Unknown LLM_PROVIDER '$provider'"
}

# ------------------------------------
# 6. Set up Python virtual environment
# ------------------------------------
Write-Step "Preparing Python virtual environment"
$venv      = Join-Path $Agent ".venv"
$pip       = Join-Path $venv "Scripts\pip.exe"
$pythonExe = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $venv)) {
    Write-Host "    Creating .venv..."
    & python -m venv $venv
}
Write-Host "    Installing Python dependencies..."
& $pip install -r (Join-Path $Agent "requirements.txt") --quiet
Write-Host "    Installing Playwright chromium..."
& $pythonExe -m playwright install chromium 2>&1 | ForEach-Object { "    $_" } | Write-Host
Write-OK "Python environment ready"

# ------------------------------------
# 7. Install Node dependencies
# ------------------------------------
Write-Step "Installing Node.js dependencies"
foreach ($dir in @($Backend, $Frontend)) {
    $name = Split-Path $dir -Leaf
    if (-not (Test-Path (Join-Path $dir "node_modules"))) {
        Write-Host "    npm install in $name..."
        Push-Location $dir
        npm install --silent
        Pop-Location
    } else {
        Write-OK "$name/node_modules already present, skipping install"
    }
}

# ------------------------------------
# 8. Launch services in new windows
# ------------------------------------
Write-Step "Launching services"

$agentCmd   = "Set-Location '$Agent'; & '$pythonExe' '$Agent\main.py'"
$backendCmd = "Set-Location '$Backend'; npm run dev"
$frontendCmd = "Set-Location '$Frontend'; npm run dev"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $agentCmd   -WindowStyle Normal
Write-OK "Agent worker started in new window"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd  -WindowStyle Normal
Write-OK "Backend started in new window (http://localhost:5000)"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd -WindowStyle Normal
Write-OK "Frontend started in new window (http://localhost:5173)"

# ------------------------------------
# Done
# ------------------------------------
Write-Host ""
Write-Host "======================================" -ForegroundColor Magenta
Write-Host "  BugHunter.AI is starting up!" -ForegroundColor Magenta
Write-Host "======================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Frontend   ->  http://localhost:5173" -ForegroundColor White
Write-Host "  Backend    ->  http://localhost:5000" -ForegroundColor White
Write-Host "  PostgreSQL ->  localhost:5432  (bughunter)" -ForegroundColor White
Write-Host "  Redis      ->  localhost:6379" -ForegroundColor White
Write-Host ""
Write-Host "  Three PowerShell windows are running the services." -ForegroundColor Gray
Write-Host "  Close them to stop, or run:  docker compose down" -ForegroundColor Gray
Write-Host ""
