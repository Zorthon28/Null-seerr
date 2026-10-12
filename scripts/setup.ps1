# =====================================================================
# Null-seerr All-In-One Media Stack 1-Click Bootstrap Installer
# Automatically detects largest storage drive, seeds templates,
# starts Docker stack, and wires everything with ZERO host dependencies!
# =====================================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "✨ NULL-SEERR ALL-IN-ONE MEDIA STACK 1-CLICK INSTALLER ✨" -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. Check Docker status
Write-Host "`n[*] Checking Docker Engine status..." -ForegroundColor Cyan
try {
    $dockerVersion = docker version --format '{{.Server.Version}}' 2>$null
    if (-not $dockerVersion) {
        Write-Host "[!] Docker daemon is not running. Attempting to start Docker Desktop..." -ForegroundColor Yellow
        $dockerPath = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
        if (Test-Path $dockerPath) {
            Start-Process -FilePath $dockerPath
        } else {
            Start-Process "Docker Desktop" -ErrorAction SilentlyContinue
        }
        $timeout = 90
        $started = $false
        Write-Host "Waiting for Docker Engine to initialize (up to 90 seconds)..." -ForegroundColor Cyan
        while ($timeout -gt 0) {
            Write-Host -NoNewline "."
            Start-Sleep -Seconds 3
            $dockerVersion = docker version --format '{{.Server.Version}}' 2>$null
            if ($dockerVersion) {
                $started = $true
                Write-Host ""
                break
            }
            $timeout -= 3
        }
        if (-not $started) {
            Write-Host "`n[ERROR] Docker Desktop failed to start within 90s. Please open Docker Desktop manually and run setup again." -ForegroundColor Red
            Exit 1
        }
    }
    Write-Host "[OK] Docker Engine is active (v$dockerVersion)" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Docker command not found. Please install Docker Desktop from https://www.docker.com/products/docker-desktop/" -ForegroundColor Red
    Exit 1
}

# 2. Smart Drive & Storage Auto-Detection
Write-Host "`n[*] Scanning local storage drives for media library..." -ForegroundColor Cyan
$drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 0 } | Sort-Object Free -Descending

if (-not $drives -or $drives.Count -eq 0) {
    $selectedDrive = "C:"
} else {
    $bestDrive = $drives[0]
    $bestFreeGb = [Math]::Round($bestDrive.Free / 1GB, 1)
    Write-Host "`nDetected Storage Disks:" -ForegroundColor Yellow
    for ($i = 0; $i -lt $drives.Count; $i++) {
        $d = $drives[$i]
        $freeGb = [Math]::Round($d.Free / 1GB, 1)
        $isRec = if ($i -eq 0) { " [RECOMMENDED - Largest Free Space]" } else { "" }
        Write-Host "  [$($i+1)] Drive $($d.Name): ($freeGb GB free)$isRec" -ForegroundColor White
    }

    Write-Host "`nAuto-selecting Drive $($bestDrive.Name): ($bestFreeGb GB free)..." -ForegroundColor Green
    $selectedDrive = "$($bestDrive.Name):"
}

$stackRoot = "$selectedDrive\arr-stack"
Write-Host "`n[+] Target Media Stack Path: $stackRoot" -ForegroundColor Cyan

# 3. Create Folder Hierarchy
$folders = @(
    "$stackRoot\config\qbittorrent",
    "$stackRoot\config\radarr",
    "$stackRoot\config\sonarr",
    "$stackRoot\config\prowlarr",
    "$stackRoot\config\bazarr\config",
    "$stackRoot\config\overseerr",
    "$stackRoot\config\jellyfin",
    "$stackRoot\config\plex",
    "$stackRoot\config\shoko",
    "$stackRoot\config\suggestarr",
    "$stackRoot\config\tdarr",
    "$stackRoot\data\media\movies",
    "$stackRoot\data\media\tv",
    "$stackRoot\data\media\anime",
    "$stackRoot\data\torrents\incomplete",
    "$stackRoot\data\transcode_cache"
)

foreach ($f in $folders) {
    if (-not (Test-Path $f)) {
        New-Item -ItemType Directory -Path $f -Force | Out-Null
    }
}
Write-Host "[OK] Folder hierarchy provisioned" -ForegroundColor Green

# 4. Copy Pre-Seeded Configuration Templates
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoDir = Split-Path -Parent $scriptDir
$templatesDir = Join-Path $repoDir "templates"

if (Test-Path $templatesDir) {
    Write-Host "[*] Applying pre-seeded configuration templates..." -ForegroundColor Cyan
    
    $templateMap = @{
        "qbittorrent\qBittorrent.conf" = "$stackRoot\config\qbittorrent\qBittorrent\qBittorrent.conf"
        "radarr\config.xml" = "$stackRoot\config\radarr\config.xml"
        "sonarr\config.xml" = "$stackRoot\config\sonarr\config.xml"
        "prowlarr\config.xml" = "$stackRoot\config\prowlarr\config.xml"
        "bazarr\config\config.yaml" = "$stackRoot\config\bazarr\config\config.yaml"
        "overseerr\settings.json" = "$stackRoot\config\overseerr\settings.json"
    }

    foreach ($entry in $templateMap.GetEnumerator()) {
        $src = Join-Path $templatesDir $entry.Key
        $dst = $entry.Value
        if ((Test-Path $src) -and (-not (Test-Path $dst))) {
            $parent = Split-Path -Parent $dst
            if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
            Copy-Item -Path $src -Destination $dst -Force
            Write-Host "  [+] Seeded: $($entry.Key)" -ForegroundColor White
        }
    }
}

# 5. Master Authentication & .env file generation
Write-Host "`n[*] Stack Authentication Setup:" -ForegroundColor Cyan
$existingMaster = $null
if (Test-Path (Join-Path $repoDir ".env")) {
    $existingLines = Get-Content (Join-Path $repoDir ".env")
    foreach ($l in $existingLines) {
        if ($l -match "^MASTER_PASSWORD=(.+)") { $existingMaster = $matches[1].Trim() }
    }
}

if ($existingMaster) {
    Write-Host "  [+] Found existing Master Password in .env" -ForegroundColor Green
    $userMasterPass = $existingMaster
} else {
    $userMasterPass = Read-Host "  Enter Master Password for admin account (Press Enter for auto-generated)"
    if ([string]::IsNullOrWhiteSpace($userMasterPass)) {
        $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$"
        $rng = New-Object System.Random
        $userMasterPass = -join ((1..16) | ForEach-Object { $chars[$rng.Next(0, $chars.Length)] })
        Write-Host "  [+] Auto-generated secure Master Password: $userMasterPass" -ForegroundColor Yellow
    } else {
        Write-Host "  [+] Using provided Master Password for all stack services." -ForegroundColor Green
    }
}
$env:MASTER_PASSWORD = $userMasterPass

$envPath = Join-Path $repoDir ".env"
$envContent = @"
# Auto-generated by Null-seerr Setup
MASTER_PASSWORD=$userMasterPass
STACK_ROOT=$stackRoot
CONFIG_ROOT=$($stackRoot.Replace('\', '/'))/config
DATA_ROOT=$($stackRoot.Replace('\', '/'))/data
MEDIA_ROOT=$($stackRoot.Replace('\', '/'))/data/media
TV_DIR=$($stackRoot.Replace('\', '/'))/data/media/tv
TRANSCODE_CACHE=$($stackRoot.Replace('\', '/'))/data/transcode_cache
PUID=1000
PGID=1000
TZ=Etc/UTC
NULL_SEERR_PORT=5055
RADARR_PORT=7878
SONARR_PORT=8989
PROWLARR_PORT=9696
QBIT_WEBUI_PORT=8089
QBIT_TORRENT_PORT=6881
JELLYFIN_PORT=8096
PLEX_PORT=32400
BAZARR_PORT=6767
SHOKO_PORT=8111
SUGGESTARR_PORT=4455
TDARR_WEB_PORT=8265
TDARR_SERVER_PORT=8266
FLARESOLVERR_PORT=8191
"@

Set-Content -Path $envPath -Value $envContent -Encoding UTF8
Write-Host "[OK] .env configuration file generated with unified authentication" -ForegroundColor Green

# 6. Configure Windows Power Settings & Background Watcher
Write-Host "`n[*] Configuring Windows Power Settings for 24/7 Media Server..." -ForegroundColor Cyan
try {
    powercfg /change standby-timeout-ac 0 2>$null
    powercfg /change standby-timeout-dc 0 2>$null
    Write-Host "[OK] Standby idle sleep disabled (Continuous media playback enabled)" -ForegroundColor Green
} catch {
    Write-Host "[!] Could not configure power settings automatically: $_" -ForegroundColor Yellow
}

$powerGuardScript = Join-Path $repoDir "scripts\power_guard.pyw"
if (Test-Path $powerGuardScript) {
    try {
        $regKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
        $regName = "NullSeerrPowerGuard"
        $pywExe = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
        if ($pywExe) {
            $regCmd = "`"$pywExe`" `"$powerGuardScript`""
            Set-ItemProperty -Path $regKey -Name $regName -Value $regCmd -Force
            Start-Process -FilePath $pywExe -ArgumentList "`"$powerGuardScript`"" -WindowStyle Hidden -ErrorAction SilentlyContinue
            Write-Host "[OK] Background Power & Subtitle Guard daemon registered for auto-start" -ForegroundColor Green
        }
    } catch {
        Write-Host "[!] Could not register Power Guard: $_" -ForegroundColor Yellow
    }
}

# 7. Start Docker Compose Stack
Write-Host "`n[*] Starting Null-seerr Media Stack..." -ForegroundColor Cyan
Set-Location $repoDir
docker compose up -d

Write-Host "`n[*] Waiting for background auto-wiring engine..." -ForegroundColor Cyan
Start-Sleep -Seconds 15

# 8. Display Final Credentials & Open Browser
$credPath = "$stackRoot\CREDENTIALS.txt"
$password = $userMasterPass
if (Test-Path $credPath) {
    $lines = Get-Content $credPath
    foreach ($line in $lines) {
        if ($line -like "PASSWORD:*") {
            $password = $line.Substring(9).Trim()
        }
    }
}

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host "✨ INSTALLATION & WIRING COMPLETE!" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Admin User:     admin" -ForegroundColor White
Write-Host "  Admin Email:    admin@nullseerr.local" -ForegroundColor White
Write-Host "  Stack Password: $password" -ForegroundColor Yellow
Write-Host "  Saved in:       $credPath" -ForegroundColor Gray
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  * Null-seerr Portal:   http://localhost:5055" -ForegroundColor White
Write-Host "  * Jellyfin Streaming:  http://localhost:8096" -ForegroundColor White
Write-Host "  * Plex Media Server:   http://localhost:32400/web" -ForegroundColor White
Write-Host "  * qBittorrent:         http://localhost:8089" -ForegroundColor White
Write-Host "=================================================================" -ForegroundColor Cyan

Start-Process "http://localhost:5055"
