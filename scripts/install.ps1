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
    $dockerVersion = docker version --format '{{.Server.Version}}' 2>$null
    if (-not $dockerVersion) {
        Write-Host " [!] Docker Desktop is not running. Attempting to start Docker Desktop..." -ForegroundColor Yellow
        $dockerPath = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
        if (Test-Path $dockerPath) {
            Start-Process -FilePath $dockerPath
        } else {
            Start-Process "Docker Desktop" -ErrorAction SilentlyContinue
        }
        $timeout = 90
        $started = $false
        Write-Host "     Waiting for Docker Engine to initialize (up to 90 seconds)..." -ForegroundColor Cyan
        while ($timeout -gt 0) {
            Write-Host -NoNewline "."
            Start-Sleep -Seconds 3
            $timeout -= 3
            $dockerVersion = docker version --format '{{.Server.Version}}' 2>$null
            if ($dockerVersion) {
                $started = $true
                Write-Host ""
                break
            }
        }
        if (-not $started) {
            Write-Host "`n [!] Docker Desktop failed to start within 90s. Please open Docker Desktop manually and run setup again." -ForegroundColor Red
            Read-Host "Press Enter to exit..."
            exit 1
        }
    }
    Write-Host " [+] Docker Desktop is active and ready (v$dockerVersion)." -ForegroundColor Green
} catch {
    Write-Host " [!] Docker executable not found in PATH. Please install Docker Desktop from https://www.docker.com/products/docker-desktop/" -ForegroundColor Red
    Read-Host "Press Enter to exit..."
    exit 1
}

# 1.5 Pre-flight Port Conflict Check
Write-Host "`n Verifying network port availability..." -ForegroundColor White
$criticalPorts = @(5055, 8096, 8089, 7878, 8989, 9696)
$portConflicts = @()
foreach ($p in $criticalPorts) {
    try {
        $tcp = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
        if ($tcp) {
            $proc = Get-Process -Id $tcp[0].OwningProcess -ErrorAction SilentlyContinue
            $procName = if ($proc) { $proc.Name } else { "System" }
            if ($procName -notmatch "com.docker|wslhost|vmmem") {
                $portConflicts += "Port $p in use by '$procName'"
            }
        }
    } catch { }
}
if ($portConflicts.Count -gt 0) {
    Write-Host " [!] Note: The following local ports are currently in use:" -ForegroundColor Yellow
    foreach ($conflict in $portConflicts) {
        Write-Host "     - $conflict" -ForegroundColor Yellow
    }
    Write-Host "     If Docker fails to bind, please close the conflicting application." -ForegroundColor Yellow
} else {
    Write-Host " [+] All core media stack ports are available." -ForegroundColor Green
}

# 2. Pre-flight Check: Python
Write-Host "`n[2/6] Checking Python 3..." -ForegroundColor White
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

try {
    $driveLetter = [System.IO.Path]::GetPathRoot($customRoot).TrimEnd('\')
    $psDrive = Get-PSDrive -Name ($driveLetter.TrimEnd(':')) -ErrorAction SilentlyContinue
    if ($psDrive -and ($psDrive.Free / 1GB) -lt 20) {
        $freeGb = [Math]::Round($psDrive.Free / 1GB, 1)
        Write-Host " [!] WARNING: Drive $driveLetter has less than 20 GB free space ($freeGb GB free)." -ForegroundColor Yellow
        Write-Host "     Media downloads will fill up this disk quickly." -ForegroundColor Yellow
    }
} catch { }

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

# Master Authentication & .env configuration
$envFile = "$customRoot\.env"
$userMasterPass = $null
if (Test-Path -Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^MASTER_PASSWORD=(.+)") { $userMasterPass = $matches[1].Trim() }
    }
}

if (-not $userMasterPass) {
    $userMasterPass = Read-Host " Enter Master Password for admin account (Press Enter for auto-generated)"
    if ([string]::IsNullOrWhiteSpace($userMasterPass)) {
        $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$"
        $rng = New-Object System.Random
        $userMasterPass = -join ((1..16) | ForEach-Object { $chars[$rng.Next(0, $chars.Length)] })
        Write-Host " [+] Auto-generated secure Master Password: $userMasterPass" -ForegroundColor Yellow
    } else {
        Write-Host " [+] Using provided Master Password for all stack services." -ForegroundColor Green
    }
}
$env:MASTER_PASSWORD = $userMasterPass

if (!(Test-Path -Path $envFile)) {
    $envExample = Join-Path $repoDir ".env.example"
    if (Test-Path -Path $envExample) {
        $exampleContent = Get-Content $envExample -Raw
        $newContent = "MASTER_PASSWORD=$userMasterPass`r`n" + $exampleContent
        Set-Content -Path $envFile -Value $newContent -Force
        Copy-Item -Path $envExample -Destination (Join-Path $customRoot ".env.example") -Force
        Write-Host " [+] Created .env configuration from template with Master Password." -ForegroundColor Green
    }
} else {
    $existingEnv = Get-Content $envFile -Raw
    if ($existingEnv -notmatch "MASTER_PASSWORD=") {
        Set-Content -Path $envFile -Value ("MASTER_PASSWORD=$userMasterPass`r`n" + $existingEnv) -Force
    }
}

# Configure Windows Power Settings & Background Watcher
Write-Host "`n Configuring Windows Power Settings for 24/7 Media Server..." -ForegroundColor White
try {
    powercfg /change standby-timeout-ac 0 2>$null
    powercfg /change standby-timeout-dc 0 2>$null
    Write-Host " [+] Standby idle sleep disabled (Continuous media playback enabled)" -ForegroundColor Green
} catch {
    Write-Host " [!] Could not configure power settings automatically: $_" -ForegroundColor Yellow
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
            Write-Host " [+] Background Power & Subtitle Guard daemon registered for auto-start" -ForegroundColor Green
        }
    } catch {
        Write-Host " [!] Could not register Power Guard: $_" -ForegroundColor Yellow
    }
}

# Desktop Quick-Access Shortcut Prompt
Write-Host "`n Desktop Quick-Access:" -ForegroundColor White
$createShortcuts = Read-Host " Create Desktop shortcuts for 1-click access to Null-seerr & Jellyfin? [Y/n]"
if ([string]::IsNullOrWhiteSpace($createShortcuts) -or $createShortcuts.Trim().ToLower() -eq "y" -or $createShortcuts.Trim().ToLower() -eq "yes") {
    try {
        $desktopPath = [Environment]::GetFolderPath("Desktop")
        if (Test-Path $desktopPath) {
            $portalUrl = "[InternetShortcut]`r`nURL=http://localhost:5055`r`n"
            Set-Content -Path (Join-Path $desktopPath "Null-seerr Media Portal.url") -Value $portalUrl -Force
            
            $jellyfinUrl = "[InternetShortcut]`r`nURL=http://localhost:8096`r`n"
            Set-Content -Path (Join-Path $desktopPath "Jellyfin Streaming.url") -Value $jellyfinUrl -Force
            
            Write-Host " [+] Created Desktop shortcuts: 'Null-seerr Media Portal' and 'Jellyfin Streaming'" -ForegroundColor Green
        }
    } catch {
        Write-Host " [!] Could not create desktop shortcuts: $_" -ForegroundColor Yellow
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
Write-Host "`n[5/6] Waiting for Null-seerr Portal and media engine to be ready..." -ForegroundColor White
$readyTimeout = 45
$isReady = $false
while ($readyTimeout -gt 0) {
    Write-Host -NoNewline "."
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:5055/api/v1/status" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response -and $response.StatusCode -eq 200) {
            $isReady = $true
            Write-Host ""
            break
        }
    } catch { }
    Start-Sleep -Seconds 2
    $readyTimeout -= 2
}
if ($isReady) {
    Write-Host " [+] Null-seerr portal is live and ready!" -ForegroundColor Green
} else {
    Write-Host "`n [!] Services are still booting in background..." -ForegroundColor Yellow
}

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

# Detect LAN IP
$lanIp = "127.0.0.1"
try {
    $activeAdapter = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
        $_.InterfaceAlias -notmatch "vEthernet|Loopback|WSL|Docker" -and 
        $_.IPAddress -notmatch "^127\.|^169\.254\." 
    } | Select-Object -First 1
    if ($activeAdapter) {
        $lanIp = $activeAdapter.IPAddress
    }
} catch { }

# Read generated credentials if present
$credFile = "$customRoot\CREDENTIALS.txt"
$adminUser = "admin"
$adminEmail = "admin@nullseerr.local"
$adminPass = $userMasterPass
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
Write-Host "  🔒 MASTER PASSWORD:         $adminPass" -ForegroundColor Yellow
Write-Host "  📁 Saved in:                $credFile" -ForegroundColor Cyan
Write-Host "-----------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  Local PC Access:" -ForegroundColor Yellow
Write-Host "    * Null-seerr Portal:   http://localhost:5055" -ForegroundColor White
Write-Host "    * Jellyfin Streaming:  http://localhost:8096" -ForegroundColor White
Write-Host "    * Plex Media Server:   http://localhost:32400/web" -ForegroundColor White
Write-Host "    * Radarr (Movies):     http://localhost:7878" -ForegroundColor White
Write-Host "    * Sonarr (TV):         http://localhost:8989" -ForegroundColor White
Write-Host "    * Prowlarr (Indexers): http://localhost:9696" -ForegroundColor White
Write-Host "    * qBittorrent:         http://localhost:8089" -ForegroundColor White
Write-Host "    * Tdarr Transcoder:    http://localhost:8265" -ForegroundColor White
Write-Host "    * Shoko Anime DB:      http://localhost:8111" -ForegroundColor White
if ($lanIp -and $lanIp -ne "127.0.0.1") {
    Write-Host "`n  TV & Mobile Access (Connect devices on the same Wi-Fi):" -ForegroundColor Yellow
    Write-Host "    * Streaming Server:    http://$($lanIp):8096" -ForegroundColor Cyan
    Write-Host "    * Null-seerr Portal:   http://$($lanIp):5055" -ForegroundColor Cyan
    Write-Host "    * Living Room Guide:   See TV_SETUP_GUIDE.md" -ForegroundColor Gray
}
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to close setup wizard..."
