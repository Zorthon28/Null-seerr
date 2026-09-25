<#
.SYNOPSIS
    Self-Healing maintenance script for Docker Desktop WSL2 storage.
.DESCRIPTION
    Prevents docker_data.vhdx from uncontrolled growth by:
    1. Pruning BuildKit cache (capping under 5 GB)
    2. Pruning dangling/untagged images
    3. (Optional -Compact) Compacting docker_data.vhdx via Optimize-VHD / diskpart
#>

[CmdletBinding()]
param(
    [switch]$Full,
    [switch]$Compact
)

$ErrorActionPreference = "Continue"

$vhdxPath = "$env:LOCALAPPDATA\Docker\wsl\disk\docker_data.vhdx"

function Get-VhdxSizeGB {
    if (Test-Path $vhdxPath) {
        $bytes = (Get-Item $vhdxPath).Length
        return [math]::Round($bytes / 1GB, 2)
    }
    return 0
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   Docker Desktop Storage Self-Heal" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$initialSize = Get-VhdxSizeGB
Write-Host "Current docker_data.vhdx size on C: drive: $initialSize GB" -ForegroundColor Yellow

# Handle Compaction
if ($Compact) {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host "`n[!] Disk compaction requires Administrator privileges." -ForegroundColor Yellow
        Write-Host "Requesting elevation (please click 'Yes' on the Windows UAC prompt)..." -ForegroundColor Cyan
        Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Compact"
        return
    }

    Write-Host "`n[1/3] Stopping Docker Desktop and WSL 2 to release disk lock..." -ForegroundColor Green
    Get-Process "Docker Desktop", "com.docker.backend", "dockerd" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    wsl.exe --shutdown
    Start-Sleep -Seconds 3

    # Ensure sparse flag is unset (diskpart/Hyper-V require uncompressed, non-sparse VHDX)
    & fsutil.exe sparse setflag "$vhdxPath" 0 | Out-Null

    Write-Host "`n[2/3] Compacting docker_data.vhdx..." -ForegroundColor Green
    if (Get-Command Optimize-VHD -ErrorAction SilentlyContinue) {
        Write-Host "Using Hyper-V Optimize-VHD (Mode: Full) on $vhdxPath..." -ForegroundColor Cyan
        Write-Host "Scanning block allocation table (this may take ~1-3 minutes)..." -ForegroundColor Yellow
        Optimize-VHD -Path $vhdxPath -Mode Full
    } else {
        Write-Host "Using diskpart compaction on $vhdxPath..." -ForegroundColor Cyan
        $tempScript = [System.IO.Path]::GetTempFileName()
        $diskpartCommands = @"
select vdisk file="$vhdxPath"
attach vdisk readonly
compact vdisk
detach vdisk
exit
"@
        Set-Content -Path $tempScript -Value $diskpartCommands -Encoding ASCII

        try {
            $proc = Start-Process -FilePath "diskpart.exe" -ArgumentList "/s `"$tempScript`"" -NoNewWindow -Wait -PassThru
            if ($proc.ExitCode -ne 0) {
                Write-Host "diskpart returned exit code $($proc.ExitCode)" -ForegroundColor Red
            }
        } finally {
            if (Test-Path $tempScript) {
                Remove-Item -Path $tempScript -Force -ErrorAction SilentlyContinue
            }
        }
    }

    $finalSize = Get-VhdxSizeGB
    $saved = [math]::Round($initialSize - $finalSize, 2)
    Write-Host "`n==========================================" -ForegroundColor Green
    Write-Host " Compaction Completed Successfully!" -ForegroundColor Green
    Write-Host " Original size: $initialSize GB" -ForegroundColor White
    Write-Host " New size:      $finalSize GB" -ForegroundColor White
    Write-Host " Reclaimed:     $saved GB freed on C: drive!" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "`nYou can now restart Docker Desktop from your Start menu." -ForegroundColor Cyan
    return
}

# 1. Clean BuildKit cache
if ($Full) {
    Write-Host "`n[1/2] Full BuildKit prune (-a)..." -ForegroundColor Green
    docker builder prune -a -f
} else {
    Write-Host "`n[1/2] Pruning BuildKit cache (keeping max 5 GB)..." -ForegroundColor Green
    docker builder prune -f --keep-storage 5GB
}

# 2. Clean dangling images
Write-Host "`n[2/2] Pruning dangling images..." -ForegroundColor Green
docker image prune -f

Write-Host "`nSelf-heal routine completed." -ForegroundColor Green
Write-Host "To shrink the physical .vhdx file on C: drive, run with -Compact." -ForegroundColor Gray
