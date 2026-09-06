# =====================================================================
# Null-seerr Power Guard Setup Script (Windows)
# Configures Wake-on-Wi-Fi and installs the background power manager
# into the user's Startup folder.
# =====================================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "⚡ NULL-SEERR HOST POWER GUARD & WAKE-ON-WI-FI SETUP ⚡" -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. Locate pythonw.exe
$pythonExe = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
if (-not $pythonExe) {
    Write-Host "[ERROR] python.exe not found in PATH." -ForegroundColor Red
    Exit 1
}
$pythonwExe = $pythonExe -replace "python\.exe", "pythonw.exe"
if (-not (Test-Path $pythonwExe)) {
    $pythonwExe = $pythonExe
}

$scriptPath = (Resolve-Path "$PSScriptRoot\power_guard.pyw").Path
Write-Host "[+] Python runner: $pythonwExe" -ForegroundColor Green
Write-Host "[+] Power Guard script: $scriptPath" -ForegroundColor Green

# 2. Configure Windows Power Scheme for Sleep & Wake
Write-Host "`n[*] Configuring Windows Power Scheme..." -ForegroundColor Cyan
try {
    # Set default standby timeout to 30 minutes (active when Power Guard permits sleep)
    powercfg /change standby-timeout-ac 30
    powercfg /change hibernate-timeout-ac 0
    powercfg /change monitor-timeout-ac 15
    powercfg /setacvalueindex SCHEME_CURRENT 238c9fa8-0aad-41ed-83f4-97be242c8f20 bd3b718a-0680-4d9d-8ab2-e1d2b4ac806d 1
    powercfg /setactive SCHEME_CURRENT
    Write-Host "[OK] Standby timeout configured to 30 min (Screen turns off after 15 min)" -ForegroundColor Green
} catch {
    Write-Host "[!] Warning setting powercfg: $_" -ForegroundColor Yellow
}

# 3. Create Startup Shortcut
$startupFolder = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
$shortcutPath = Join-Path $startupFolder "NullSeerrPowerGuard.lnk"

Write-Host "`n[*] Installing Power Guard into Windows Startup folder..." -ForegroundColor Cyan
$wscript = New-Object -ComObject WScript.Shell
$shortcut = $wscript.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pythonwExe
$shortcut.Arguments = "`"$scriptPath`""
$shortcut.WorkingDirectory = "$PSScriptRoot"
$shortcut.Description = "Null-seerr Host Power Guard Daemon"
$shortcut.Save()

Write-Host "[OK] Startup shortcut created: $shortcutPath" -ForegroundColor Green

# 4. Launch Power Guard right now in background
Write-Host "`n[*] Starting Power Guard daemon in the background..." -ForegroundColor Cyan
Start-Process -FilePath $pythonwExe -ArgumentList "`"$scriptPath`"" -WindowStyle Hidden

Write-Host "`n=================================================================" -ForegroundColor Green
Write-Host "✅ Power Guard is now active and will automatically launch on boot!" -ForegroundColor Green
Write-Host "You can toggle 'Host Power Management' ON/OFF anytime in Null-seerr Settings > General." -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Green
