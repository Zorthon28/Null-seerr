# ==============================================================================
# Null-seerr All-In-One Media Stack Interactive Setup Wizard
# ==============================================================================

$Host.UI.RawUI.WindowTitle = "Null-seerr Stack Setup Wizard"
Clear-Host

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "      NULL-SEERR ALL-IN-ONE MEDIA AUTOMATION SETUP WIZARD       " -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoDir = Split-Path -Parent $scriptDir

# 1. Pre-flight Check: Docker
Write-Host "[1/6] Checking Docker Engine..." -ForegroundColor White
try {
    $dockerCheck = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host " [!] Docker Desktop is not running or not responding." -ForegroundColor Red
        Write-Host "     Please start Docker Desktop and run this setup script again." -ForegroundColor Yellow
        Read-Host "Press Enter to exit..."
        exit 1
    }
    Write-Host " [+] Docker Desktop is active and ready." -ForegroundColor Green
} catch {
    Write-Host " [!] Docker executable not found in PATH." -ForegroundColor Red
    Read-Host "Press Enter to exit..."
    exit 1
}

# 2. Pre-flight Check: Python
Write-Host "[2/6] Checking Python 3..." -ForegroundColor White
try {
    $pyVer = python --version 2>&1
    Write-Host " [+] Python detected: $pyVer" -ForegroundColor Green
} catch {
    Write-Host " [!] Python 3 not found. Auto-wiring script requires Python 3." -ForegroundColor Yellow
}

# 3. Directory Configuration & Stack File Provisioning
Write-Host "`n[3/6] Setting Up Environment & Directories..." -ForegroundColor White
$defaultRoot = "C:\arr-stack"
$customRoot = Read-Host " Enter installation directory (Press Enter for default: '$defaultRoot')"
if ([string]::IsNullOrWhiteSpace($customRoot)) {
    $customRoot = $defaultRoot
}

$dirs = @(
    "$customRoot\config\overseerr",
    "$customRoot\config\plex",
    "$customRoot\config\jellyfin",
    "$customRoot\config\prowlarr",
    "$customRoot\config\qbittorrent",
    "$customRoot\config\radarr",
    "$customRoot\config\sonarr",
    "$customRoot\config\bazarr",
    "$customRoot\config\suggestarr",
    "$customRoot\config\shoko",
    "$customRoot\config\tdarr\server",
    "$customRoot\config\tdarr\configs",
    "$customRoot\config\tdarr\logs",
    "$customRoot\config\autobrr",
    "$customRoot\data\media\movies",
    "$customRoot\data\media\tv",
    "$customRoot\data\media\anime",
    "$customRoot\data\torrents\movies",
    "$customRoot\data\torrents\tv",
    "$customRoot\data\torrents\anime",
    "$customRoot\data\transcode_cache"
)

foreach ($d in $dirs) {
    if (!(Test-Path -Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
    }
}
Write-Host " [+] All directories created & verified." -ForegroundColor Green

# Copy docker-compose.yml into target folder
$srcCompose = Join-Path $repoDir "docker-compose.yml"
if (Test-Path -Path $srcCompose) {
    Copy-Item -Path $srcCompose -Destination (Join-Path $customRoot "docker-compose.yml") -Force
}

# Copy scripts into target folder
$srcWire = Join-Path $repoDir "scripts\wire_stack.py"
if (Test-Path -Path $srcWire) {
    Copy-Item -Path $srcWire -Destination (Join-Path $customRoot "wire_stack.py") -Force
}

$srcBoxarr = Join-Path $repoDir "scripts\boxarr.py"
if (Test-Path -Path $srcBoxarr) {
    Copy-Item -Path $srcBoxarr -Destination (Join-Path $customRoot "boxarr.py") -Force
}

# Copy .env.example & create .env if not present
$envFile = "$customRoot\.env"
if (!(Test-Path -Path $envFile)) {
    $envExample = Join-Path $repoDir ".env.example"
    if (Test-Path -Path $envExample) {
        Copy-Item -Path $envExample -Destination $envFile -Force
        Copy-Item -Path $envExample -Destination (Join-Path $customRoot ".env.example") -Force
        Write-Host " [+] Created .env configuration from template." -ForegroundColor Green
    }
}

# Create batch helpers in target folder
$startBatContent = @"
@echo off
echo Starting Null-seerr Media Stack...
cd /d $customRoot
docker compose up -d
pause
"@
Set-Content -Path "$customRoot\start-stack.bat" -Value $startBatContent

$stopBatContent = @"
@echo off
echo Stopping Null-seerr Media Stack...
cd /d $customRoot
docker compose down
pause
"@
Set-Content -Path "$customRoot\stop-stack.bat" -Value $stopBatContent

$wireBatContent = @"
@echo off
echo Auto-Wiring Null-seerr Media Stack...
cd /d $customRoot
python wire_stack.py
pause
"@
Set-Content -Path "$customRoot\wire-stack.bat" -Value $wireBatContent

$boxarrBatContent = @"
@echo off
echo Running Boxarr Autopilot Sync...
cd /d $customRoot
python boxarr.py
pause
"@
Set-Content -Path "$customRoot\run-boxarr.bat" -Value $boxarrBatContent

# 4. Launch Stack
Write-Host "`n[4/6] Starting Media Automation Stack..." -ForegroundColor White
Push-Location $customRoot
docker compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host " [!] Docker Compose failed to start services." -ForegroundColor Red
    Pop-Location
    Read-Host "Press Enter to exit..."
    exit 1
}
Write-Host " [+] Containers launched successfully!" -ForegroundColor Green

# 5. Service Liveness Check & Auto-Wiring
Write-Host "`n[5/6] Waiting for Services to initialize (15s)..." -ForegroundColor White
Start-Sleep -Seconds 15

Write-Host " Running Auto-Wiring CLI..." -ForegroundColor Yellow
if (Test-Path -Path "$customRoot\wire_stack.py") {
    python "$customRoot\wire_stack.py"
}

# 6. Run Boxarr Sync
Write-Host "`n[6/6] Syncing Initial Box Office & Popular Movies..." -ForegroundColor White
if (Test-Path -Path "$customRoot\boxarr.py") {
    python "$customRoot\boxarr.py"
}

Pop-Location

# Read generated credentials if present
$credFile = "$customRoot\CREDENTIALS.txt"
$adminUser = "admin"
$adminEmail = "admin@nullseerr.local"
$adminPass = "See $customRoot\CREDENTIALS.txt"
if (Test-Path -Path $credFile) {
    Get-Content $credFile | ForEach-Object {
        if ($_ -match "^USER:\s*(.+)") { $adminUser = $matches[1].Trim() }
        if ($_ -match "^EMAIL:\s*(.+)") { $adminEmail = $matches[1].Trim() }
        if ($_ -match "^PASSWORD:\s*(.+)") { $adminPass = $matches[1].Trim() }
    }
}

# Open Null-seerr in default browser
Start-Process "http://localhost:5055"

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host "          NULL-SEERR MEDIA STACK IS ONLINE & READY!              " -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  🔑 ADMIN USERNAME:          $adminUser" -ForegroundColor Yellow
Write-Host "  📧 ADMIN EMAIL:             $adminEmail" -ForegroundColor Yellow
Write-Host "  🔒 GENERATED TEMP PASSWORD:  $adminPass" -ForegroundColor Yellow
Write-Host "  📁 Saved in:                $credFile" -ForegroundColor Cyan
Write-Host "-----------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  * Null-seerr Portal:   http://localhost:5055" -ForegroundColor Yellow
Write-Host "  * Radarr (Movies):     http://localhost:7878" -ForegroundColor White
Write-Host "  * Sonarr (TV):         http://localhost:8989" -ForegroundColor White
Write-Host "  * Prowlarr (Indexers): http://localhost:9696" -ForegroundColor White
Write-Host "  * qBittorrent:         http://localhost:8089" -ForegroundColor White
Write-Host "  * Plex Media Server:   http://localhost:32400/web" -ForegroundColor White
Write-Host "  * Jellyfin Server:     http://localhost:8096" -ForegroundColor White
Write-Host "  * Tdarr Transcoder:    http://localhost:8265" -ForegroundColor White
Write-Host "  * Shoko Anime DB:      http://localhost:8111" -ForegroundColor White
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to close setup wizard..."
