<#
.SYNOPSIS
    Self-Healing maintenance script for Docker Desktop WSL2 storage.
.DESCRIPTION
    Prevents docker_data.vhdx from uncontrolled growth by:
    1. Pruning BuildKit cache (capping under 5 GB)
    2. Pruning dangling/untagged images
    3. (Optional -Compact) Compacting docker_data.vhdx via diskpart to reclaim GBs on Windows C:
.EXAMPLE
    .\scripts\docker-self-heal.ps1
    .\scripts\docker-self-heal.ps1 -Full
    .\scripts\docker-self-heal.ps1 -Compact
#>

[CmdletBinding()]
param(
    [switch]$Full,
    [switch]$Compact
)

$ErrorActionPreference = "Stop"

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

# 1. Clean BuildKit cache
if ($Full) {
    Write-Host "`n[1/3] Full BuildKit prune (-a)..." -ForegroundColor Green
    docker builder prune -a -f
} else {
    Write-Host "`n[1/3] Pruning BuildKit cache (keeping max 5 GB)..." -ForegroundColor Green
    docker builder prune -f --keep-storage 5GB
}

# 2. Clean dangling images
Write-Host "`n[2/3] Pruning dangling images..." -ForegroundColor Green
docker image prune -f

# 3. Compact VHDX if requested
if ($Compact) {
    Write-Host "`n[3/3] Compacting docker_data.vhdx with diskpart..." -ForegroundColor Green
    Write-Host "Stopping Docker Desktop and WSL..." -ForegroundColor Yellow
    
    # Gracefully stop WSL
    wsl --shutdown
    Start-Sleep -Seconds 3

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
        Write-Host "Running diskpart compaction (this may take 1-2 minutes)..." -ForegroundColor Cyan
        Start-Process -FilePath "diskpart.exe" -ArgumentList "/s `"$tempScript`"" -NoNewWindow -Wait
    } finally {
        if (Test-Path $tempScript) {
            Remove-Item -Path $tempScript -Force -ErrorAction SilentlyContinue
        }
    }

    $finalSize = Get-VhdxSizeGB
    $saved = [math]::Round($initialSize - $finalSize, 2)
    Write-Host "`nDone! New docker_data.vhdx size: $finalSize GB (Reclaimed: $saved GB)" -ForegroundColor Green
    Write-Host "You can now reopen Docker Desktop." -ForegroundColor Cyan
} else {
    Write-Host "`n[3/3] Compaction skipped (run with -Compact when you want to shrink the physical .vhdx file on C:)." -ForegroundColor Gray
    Write-Host "Self-heal routine completed successfully." -ForegroundColor Green
}
