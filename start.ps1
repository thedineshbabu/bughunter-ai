#Requires -Version 5.1
<#
.SYNOPSIS
    BugHunter.AI - Full stack startup script (PowerShell)
.DESCRIPTION
    1. Checks prerequisites (docker, node, npm, python)
    2. Starts Docker containers (PostgreSQL + Redis)
    3. Waits for both services to be healthy
    4. Runs all database migrations (idempotent)
    5. Verifies and bootstraps .env files for agent and backend
    6. Sets up Python virtual environment and installs dependencies
    7. Installs Node.js dependencies for backend and frontend
    8. Launches agent, backend, and frontend in separate PowerShell windows
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root     = $PSScriptRoot
$Agent    = Join-Path $Root "agent"
$Backend  = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"

# ------------------------------------
# Colour helpers
# ------------------------------------
function Write-Step { param([string]$msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK   { param([string]$msg) Write-Host "    [OK]   $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "    [WARN] $msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$msg) Write-Host "    [FAIL] $msg" -ForegroundColor Red }
function Write-Info { param([string]$msg) Write-Host "    [INFO] $msg" -ForegroundColor Gray }

function Require-Command {
    param([string]$cmd)
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Fail "'$cmd' not found in PATH. Please install it first."
        exit 1
    }
}

function Test-PortFree {
    param([int]$port)
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return ($null -eq $conn)
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

$nodeVer   = node --version
$pythonVer = python --version 2>&1
$dockerVer = docker --version
Write-Info "node $nodeVer  |  $pythonVer  |  $dockerVer"

# ------------------------------------
# 2. Start Docker services
# ------------------------------------
Write-Step "Starting Docker containers (PostgreSQL + Redis + sample sites)"
Push-Location $Root
docker compose up -d
$dockerExit = $LASTEXITCODE
Pop-Location

if ($dockerExit -ne 0) {
    Write-Fail "docker compose failed (exit $dockerExit). Is Docker Desktop running?"
    exit 1
}
Write-OK "docker compose started"

# ------------------------------------
# 3. Wait for PostgreSQL to be healthy
# ------------------------------------
Write-Step "Waiting for PostgreSQL to be healthy"
$maxAttempts = 30
$attempt     = 0
$fmt         = '{{.State.Health.Status}}'

do {
    Start-Sleep -Seconds 2
    $attempt++
    $pgStatus = docker inspect --format=$fmt bughunter-postgres 2>$null
    Write-Info "Attempt $attempt/$maxAttempts - postgres: $pgStatus"
} while ($pgStatus -ne "healthy" -and $attempt -lt $maxAttempts)

if ($pgStatus -ne "healthy") {
    Write-Fail "PostgreSQL did not become healthy in time."
    Write-Info "Run 'docker compose logs postgres' for details."
    exit 1
}
Write-OK "PostgreSQL is healthy"

# ------------------------------------
# 4. Wait for Redis to be healthy
# ------------------------------------
Write-Step "Waiting for Redis to be healthy"
$attempt = 0

do {
    Start-Sleep -Seconds 2
    $attempt++
    $redisStatus = docker inspect --format=$fmt bughunter-redis 2>$null
    Write-Info "Attempt $attempt/$maxAttempts - redis: $redisStatus"
} while ($redisStatus -ne "healthy" -and $attempt -lt $maxAttempts)

if ($redisStatus -ne "healthy") {
    Write-Fail "Redis did not become healthy in time."
    Write-Info "Run 'docker compose logs redis' for details."
    exit 1
}
Write-OK "Redis is healthy"

# ------------------------------------
# 5. Wait for sample test sites (non-blocking)
# ------------------------------------
Write-Step "Waiting for sample test sites"

function Wait-Http {
    param([string]$name, [string]$url, [int]$maxAttempts = 20)
    $n = 0
    $up = $false
    do {
        $n++
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($resp.StatusCode -lt 400) { $up = $true; break }
        } catch { }
        Write-Info "Waiting for $name ($n/$maxAttempts)..."
        Start-Sleep -Seconds 3
    } while ($n -lt $maxAttempts)

    if ($up) {
        Write-OK "$name is up ($url)"
    } else {
        Write-Warn "$name not reachable after $maxAttempts attempts - it may still be starting"
    }
}

Wait-Http "Juice Shop" "http://localhost:3000"
Wait-Http "DVWA"       "http://localhost:8080"

# ------------------------------------
# 6. Run database migrations
# ------------------------------------
Write-Step "Running database migrations"

$migrations = @(
    "database/migrations/001_users.sql",
    "database/migrations/002_apps.sql",
    "database/migrations/003_test_runs.sql",
    "database/migrations/004_bug_reports.sql",
    "database/migrations/005_not_null_constraints.sql",
    "database/migrations/006_credentials_text.sql",
    "database/migrations/007_app_memory.sql",
    "database/migrations/008_run_status_enum.sql"
)

# Temporarily allow non-terminating errors so psql NOTICE/WARNING lines on stderr
# don't trigger $ErrorActionPreference = Stop.  We check $LASTEXITCODE manually.
$_savedPref = $ErrorActionPreference
$ErrorActionPreference = "Continue"

foreach ($migration in $migrations) {
    $fullPath = Join-Path $Root $migration
    if (Test-Path $fullPath) {
        Get-Content $fullPath -Raw | docker exec -i bughunter-postgres psql -U postgres -d bughunter 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Migration '$migration' exit $LASTEXITCODE (may already exist, continuing)"
        } else {
            Write-OK "Applied: $migration"
        }
    } else {
        Write-Warn "Not found, skipping: $migration"
    }
}

$ErrorActionPreference = $_savedPref

# ------------------------------------
# 6. Verify .env files
# ------------------------------------
Write-Step "Verifying .env files"

function Read-EnvFile {
    param([string]$path)
    $table = @{}
    if (-not (Test-Path $path)) { return $table }
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
        [string]   $dir,
        [string]   $displayName,
        [string[]] $requiredKeys
    )

    $envFile     = Join-Path $dir ".env"
    $exampleFile = Join-Path $dir ".env.example"

    if (-not (Test-Path $envFile)) {
        if (Test-Path $exampleFile) {
            Copy-Item $exampleFile $envFile
            Write-Warn "$displayName/.env missing - copied from .env.example. Fill in real values before production."
        } else {
            Write-Fail "$displayName/.env not found and no .env.example to copy from."
            exit 1
        }
    } else {
        Write-OK "$displayName/.env exists"
    }

    $envVars      = Read-EnvFile $envFile
    $placeholders = @("change-me", "your-", "generate-with", "changeme")

    foreach ($key in $requiredKeys) {
        if (-not $envVars.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($envVars[$key])) {
            Write-Warn "$displayName/.env: '$key' is missing or empty"
        } else {
            $val           = $envVars[$key]
            $isPlaceholder = $false
            foreach ($ph in $placeholders) {
                if ($val -like "*$ph*") { $isPlaceholder = $true; break }
            }
            if ($isPlaceholder) {
                Write-Warn "$displayName/.env: '$key' still has a placeholder value - update before production"
            } else {
                Write-OK "$displayName/.env: $key OK"
            }
        }
    }
}

$agentRequired   = @("LLM_PROVIDER", "DATABASE_URL", "REDIS_URL", "BACKEND_URL", "AGENT_API_SECRET")
$backendRequired = @("PORT", "DATABASE_URL", "REDIS_URL", "JWT_SECRET", "FRONTEND_URL", "AGENT_API_SECRET", "CREDENTIALS_ENCRYPTION_KEY")

Verify-EnvFile $Agent   "agent"   $agentRequired
Verify-EnvFile $Backend "backend" $backendRequired

# Validate the LLM API key matches the configured provider
$agentEnv = Read-EnvFile (Join-Path $Agent ".env")
$provider  = if ($agentEnv.ContainsKey("LLM_PROVIDER")) { $agentEnv["LLM_PROVIDER"] } else { "unknown" }

$llmKeyMap = @{
    "anthropic" = "ANTHROPIC_API_KEY"
    "openai"    = "OPENAI_API_KEY"
    "google"    = "GOOGLE_API_KEY"
    "groq"      = "GROQ_API_KEY"
    "mistral"   = "MISTRAL_API_KEY"
}

if ($provider -eq "ollama" -or $provider -eq "claude_cli") {
    Write-OK "agent/.env: provider '$provider' - no API key required"
} elseif ($llmKeyMap.ContainsKey($provider)) {
    $keyName = $llmKeyMap[$provider]
    if (-not $agentEnv.ContainsKey($keyName) -or $agentEnv[$keyName] -like "*your-*") {
        Write-Warn "agent/.env: LLM_PROVIDER=$provider but '$keyName' is missing or a placeholder"
    } else {
        Write-OK "agent/.env: $keyName set for provider '$provider'"
    }
} else {
    Write-Warn "agent/.env: Unknown LLM_PROVIDER '$provider'"
}

# ------------------------------------
# 7. Python virtual environment
# ------------------------------------
Write-Step "Preparing Python virtual environment"

$venv      = Join-Path $Agent ".venv"
$pip       = Join-Path $venv "Scripts\pip.exe"
$pythonExe = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $venv)) {
    Write-Info "Creating .venv..."
    & python -m venv $venv
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "python -m venv failed"
        exit 1
    }
}

Write-Info "Installing Python dependencies (this may take a moment)..."
& $pip install -r (Join-Path $Agent "requirements.txt") --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Fail "pip install failed"
    exit 1
}

Write-Info "Installing Playwright Chromium browser..."
& $pythonExe -m playwright install chromium 2>&1 | ForEach-Object { Write-Info $_ }

Write-OK "Python environment ready ($pythonExe)"

# ------------------------------------
# 8. Node.js dependencies
# ------------------------------------
Write-Step "Installing Node.js dependencies"

foreach ($dir in @($Backend, $Frontend)) {
    $name   = Split-Path $dir -Leaf
    $nmPath = Join-Path $dir "node_modules"
    if (-not (Test-Path $nmPath)) {
        Write-Info "npm install in $name..."
        Push-Location $dir
        npm install --silent
        $npmExit = $LASTEXITCODE
        Pop-Location
        if ($npmExit -ne 0) {
            Write-Fail "npm install failed in $name"
            exit 1
        }
        Write-OK "$name dependencies installed"
    } else {
        Write-OK "$name/node_modules present - skipping install"
    }
}

# ------------------------------------
# 9. Port availability checks
# ------------------------------------
Write-Step "Checking port availability"

$portMap = @{
    5000 = "Backend"
    5001 = "Agent API"
    5173 = "Frontend"
}

foreach ($p in $portMap.Keys) {
    if (Test-PortFree $p) {
        Write-OK "Port $p ($($portMap[$p])) is free"
    } else {
        Write-Warn "Port $p ($($portMap[$p])) is already in use - service may fail to bind"
    }
}

# ------------------------------------
# 10. Launch services in new windows
# ------------------------------------
Write-Step "Launching services in separate windows"

$logDir = Join-Path $Root "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$agentLog    = Join-Path $logDir "agent.log"
$backendLog  = Join-Path $logDir "backend.log"
$frontendLog = Join-Path $logDir "frontend.log"

$agentCmd    = "Set-Location '$Agent'; & '$pythonExe' '$Agent\main.py' *>&1 | Tee-Object -FilePath '$agentLog'"
$backendCmd  = "Set-Location '$Backend'; npm run dev *>&1 | Tee-Object -FilePath '$backendLog'"
$frontendCmd = "Set-Location '$Frontend'; npm run dev *>&1 | Tee-Object -FilePath '$frontendLog'"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $agentCmd    -WindowStyle Normal
Write-OK "Agent started     (logs: logs\agent.log)"

Start-Sleep -Seconds 1

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd  -WindowStyle Normal
Write-OK "Backend started   (logs: logs\backend.log  |  http://localhost:5000)"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd -WindowStyle Normal
Write-OK "Frontend started  (logs: logs\frontend.log  |  http://localhost:5173)"

# ------------------------------------
# 11. Create default BugHunter account
# ------------------------------------
Write-Step "Creating default account"

$defaultEmail = "admin@bughunter.local"
$defaultPass  = "BugHunter@123"
$defaultName  = "BugHunter Admin"
$backendApi   = "http://localhost:5000/api"

Write-Info "Waiting for backend API..."
$backendReady = $false
for ($i = 1; $i -le 15; $i++) {
    try {
        $check = Invoke-WebRequest -Uri "$backendApi/auth/me" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        $backendReady = $true; break
    } catch {
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -in @(401, 403)) {
            $backendReady = $true; break
        }
    }
    Start-Sleep -Seconds 2
}

$body = @{ name = $defaultName; email = $defaultEmail; password = $defaultPass } | ConvertTo-Json
try {
    $resp = Invoke-WebRequest -Uri "$backendApi/auth/register" -Method POST `
        -ContentType "application/json" -Body $body -UseBasicParsing -ErrorAction Stop
    Write-OK "Default account created"
} catch {
    $code = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { 0 }
    if ($code -eq 409) {
        Write-OK "Default account already exists"
    } else {
        Write-Warn "Could not create default account (HTTP $code) - register manually at http://localhost:5173"
    }
}

# Obtain a JWT for the default account
$authToken = $null
try {
    $loginBody = @{ email = $defaultEmail; password = $defaultPass } | ConvertTo-Json
    $loginResp = Invoke-WebRequest -Uri "$backendApi/auth/login" -Method POST `
        -ContentType "application/json" -Body $loginBody -UseBasicParsing -ErrorAction Stop
    $authToken = ($loginResp.Content | ConvertFrom-Json).token
} catch {
    Write-Warn "Could not obtain auth token - skipping sample app registration"
}

function Register-App {
    param([string]$appName, [string]$appUrl, [string]$credsJson)
    try {
        $existing = Invoke-WebRequest -Uri "$backendApi/apps" -UseBasicParsing `
            -Headers @{ Authorization = "Bearer $authToken" } -ErrorAction Stop
        $apps = ($existing.Content | ConvertFrom-Json).apps
        if ($apps | Where-Object { $_.url -eq $appUrl }) {
            Write-OK "App already registered: $appName"
            return
        }
    } catch { }

    $appBody = "{`"name`":`"$appName`",`"url`":`"$appUrl`",`"credentials`":$credsJson}"
    try {
        Invoke-WebRequest -Uri "$backendApi/apps" -Method POST -UseBasicParsing `
            -ContentType "application/json" -Body $appBody `
            -Headers @{ Authorization = "Bearer $authToken" } -ErrorAction Stop | Out-Null
        Write-OK "App registered: $appName ($appUrl)"
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        Write-Warn "Could not register app '$appName' (HTTP $code)"
    }
}

if ($authToken) {
    Write-Step "Registering sample apps"
    Register-App "OWASP Juice Shop" "http://localhost:3000" `
        '{"username":"admin@juice-sh.op","password":"admin123"}'
    Register-App "DVWA" "http://localhost:8080/login.php" `
        '{"username":"admin","password":"password"}'
}

# ------------------------------------
# Done
# ------------------------------------
Write-Host ""
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host "   BugHunter.AI is starting up!         " -ForegroundColor Magenta
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Frontend     ->  http://localhost:5173"  -ForegroundColor White
Write-Host "  Backend API  ->  http://localhost:5000"  -ForegroundColor White
Write-Host "  Agent API    ->  http://localhost:5001"  -ForegroundColor White
Write-Host "  PostgreSQL   ->  localhost:5432  (db: bughunter)" -ForegroundColor White
Write-Host "  Redis        ->  localhost:6379"          -ForegroundColor White
Write-Host ""                                           -ForegroundColor White
Write-Host "  Sample test sites:"                       -ForegroundColor White
Write-Host "  Juice Shop   ->  http://localhost:3000  (admin@juice-sh.op / admin123)" -ForegroundColor White
Write-Host "  DVWA         ->  http://localhost:8080  (admin / password)"              -ForegroundColor White
Write-Host ""                                           -ForegroundColor White
Write-Host "  Default BugHunter account:"               -ForegroundColor Cyan
Write-Host "  Email        ->  $defaultEmail"           -ForegroundColor Green
Write-Host "  Password     ->  $defaultPass"            -ForegroundColor Green
Write-Host ""
Write-Host "  Live logs in .\logs\ (agent.log / backend.log / frontend.log)" -ForegroundColor Gray
Write-Host "  Three PowerShell windows are running the services." -ForegroundColor Gray
Write-Host "  Close them to stop, then run:" -ForegroundColor Gray
Write-Host "    docker compose down" -ForegroundColor Gray
Write-Host ""
