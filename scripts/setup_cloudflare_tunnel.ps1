<#
.SYNOPSIS
    Null-seerr Cloudflare Domain & Tunnel Setup Script (Windows)

.DESCRIPTION
    Automates the installation of cloudflared, sets up Cloudflare Tunnels
    for secure external access (no router port forwarding required),
    routes DNS for Null-seerr and Jellyfin, and configures the Windows service.

.PARAMETER Domain
    Your apex domain or full FQDN (e.g. "yourdomain.com" or "seerr.yourdomain.com").

.PARAMETER Token
    Optional Cloudflare Zero Trust Tunnel Token. If provided, installs the tunnel directly.

.PARAMETER Subdomain
    Subdomain for Null-seerr (default: "seerr").

.PARAMETER JellyfinSubdomain
    Subdomain for Jellyfin (default: "jellyfin").

.PARAMETER Port
    Local port for Null-seerr (default: 5055).
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Domain,

    [Parameter(Mandatory = $false)]
    [string]$Token,

    [Parameter(Mandatory = $false)]
    [string]$Subdomain = "nullseerr",

    [Parameter(Mandatory = $false)]
    [string]$JellyfinSubdomain = "jellyfin",

    [Parameter(Mandatory = $false)]
    [int]$Port = 5055
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "[*] NULL-SEERR CLOUDFLARE CUSTOM DOMAIN & TUNNEL SETUP [*]" -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. Locate or download cloudflared.exe
$cloudflaredCmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
$cloudflaredExe = ""

if ($cloudflaredCmd) {
    $cloudflaredExe = $cloudflaredCmd.Source
    Write-Host "[+] Found cloudflared in PATH: $cloudflaredExe" -ForegroundColor Green
} else {
    $installDir = "$env:LOCALAPPDATA\Programs\cloudflared"
    if (-not (Test-Path $installDir)) {
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    }
    $cloudflaredExe = Join-Path $installDir "cloudflared.exe"

    if (-not (Test-Path $cloudflaredExe)) {
        Write-Host "[*] Downloading cloudflared for Windows (64-bit)..." -ForegroundColor Cyan
        $downloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
        Invoke-WebRequest -Uri $downloadUrl -OutFile $cloudflaredExe -UseBasicParsing
        Write-Host "[OK] Downloaded cloudflared to: $cloudflaredExe" -ForegroundColor Green
    }

    # Add to current session PATH
    if ($env:PATH -notlike "*$installDir*") {
        $env:PATH = "$installDir;$env:PATH"
    }
}

# 2. Prompt for Domain if not provided
if (-not $Domain) {
    $Domain = Read-Host "`n[?] Enter your custom domain (e.g. https://www.nullraccoon.com/ or nullraccoon.com)"
    if (-not $Domain) {
        Write-Host "[ERROR] A domain name is required to proceed." -ForegroundColor Red
        Exit 1
    }
}

# Clean domain: strip https://, http://, www., and trailing slash/paths
$rawDomain = $Domain.Trim().ToLower() -replace "^https?://", "" -replace "/.*$", "" -replace "^www\.", ""
$parts = $rawDomain.Split('.')
$apexDomain = if ($parts.Count -gt 2) { ($parts[-2..-1]) -join '.' } else { $rawDomain }

if (-not $Subdomain) {
    $Subdomain = "nullseerr"
}

$fullSeerrHostname = "$Subdomain.$apexDomain"
$jellyfinHostname = "$JellyfinSubdomain.$apexDomain"

# 3. Setup Tunnel
if ($Token) {
    # Token-based setup (Cloudflare Zero Trust connector)
    Write-Host "`n[*] Configuring Cloudflare Tunnel using Zero Trust Token..." -ForegroundColor Cyan
    try {
        & $cloudflaredExe service uninstall 2>$null
    } catch { }

    & $cloudflaredExe service install $Token
    Start-Sleep -Seconds 2
    Start-Service -Name "cloudflared" -ErrorAction SilentlyContinue
    Write-Host "[OK] Cloudflare Tunnel service installed and started!" -ForegroundColor Green
} else {
    # Interactive CLI-based setup
    Write-Host "`n[*] Interactive Cloudflare CLI mode selected." -ForegroundColor Cyan
    Write-Host "[*] Step 1: Authorizing with Cloudflare in your browser..." -ForegroundColor Yellow
    Write-Host "    A browser window will open. Select your domain to grant permissions." -ForegroundColor Gray

    & $cloudflaredExe tunnel login

    $tunnelName = "null-seerr-tunnel"
    Write-Host "`n[*] Step 2: Creating tunnel '$tunnelName'..." -ForegroundColor Cyan
    $createOutput = & $cloudflaredExe tunnel create $tunnelName 2>&1
    Write-Host $createOutput -ForegroundColor Gray

    # Extract tunnel UUID
    $tunnelId = ""
    if ($createOutput -match "([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})") {
        $tunnelId = $matches[1]
    } else {
        # Check tunnel list
        $tunnelList = & $cloudflaredExe tunnel list 2>&1
        if ($tunnelList -match "([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\s+$tunnelName") {
            $tunnelId = $matches[1]
        }
    }

    if ($tunnelId) {
        Write-Host "[+] Tunnel ID: $tunnelId" -ForegroundColor Green

        # Create config.yml
        $cfDir = [System.IO.Path]::Combine($env:USERPROFILE, ".cloudflared")
        if (-not (Test-Path $cfDir)) { New-Item -ItemType Directory -Path $cfDir -Force | Out-Null }
        $configFile = Join-Path $cfDir "config.yml"
        $credFile = Join-Path $cfDir "$tunnelId.json"

        $configLines = @(
            "tunnel: $tunnelId",
            "credentials-file: $credFile",
            "",
            "ingress:",
            "  - hostname: $fullSeerrHostname",
            "    service: http://localhost:$Port",
            "  - hostname: seerr.$apexDomain",
            "    service: http://localhost:$Port",
            "  - hostname: $jellyfinHostname",
            "    service: http://localhost:8096",
            "  - hostname: radarr.$apexDomain",
            "    service: http://localhost:7878",
            "  - hostname: sonarr.$apexDomain",
            "    service: http://localhost:8989",
            "  - hostname: qbittorrent.$apexDomain",
            "    service: http://localhost:8089",
            "  - hostname: prowlarr.$apexDomain",
            "    service: http://localhost:9696",
            "  - service: http_status:404"
        )
        $configContent = $configLines -join [Environment]::NewLine
        Set-Content -Path $configFile -Value $configContent -Encoding UTF8
        Write-Host "[OK] Created tunnel configuration: $configFile" -ForegroundColor Green

        # Route DNS for all stack services
        Write-Host "`n[*] Step 3: Routing DNS records for hostnames..." -ForegroundColor Cyan
        & $cloudflaredExe tunnel route dns $tunnelName $fullSeerrHostname
        & $cloudflaredExe tunnel route dns $tunnelName "seerr.$apexDomain"
        & $cloudflaredExe tunnel route dns $tunnelName $jellyfinHostname
        & $cloudflaredExe tunnel route dns $tunnelName "radarr.$apexDomain"
        & $cloudflaredExe tunnel route dns $tunnelName "sonarr.$apexDomain"
        & $cloudflaredExe tunnel route dns $tunnelName "qbittorrent.$apexDomain"
        & $cloudflaredExe tunnel route dns $tunnelName "prowlarr.$apexDomain"

        # Install & start service
        Write-Host "`n[*] Step 4: Installing Cloudflare background Windows service..." -ForegroundColor Cyan
        try { & $cloudflaredExe service uninstall 2>$null } catch { }
        & $cloudflaredExe service install
        Start-Sleep -Seconds 2
        Start-Service -Name "cloudflared" -ErrorAction SilentlyContinue
        Write-Host "[OK] Cloudflare Windows Service installed and running!" -ForegroundColor Green
    } else {
        Write-Host "[!] Could not determine Tunnel ID automatically. Please verify 'cloudflared tunnel list'." -ForegroundColor Yellow
    }
}

# 4. Update Null-seerr settings.json
Write-Host "`n[*] Updating Null-seerr configuration with custom domain..." -ForegroundColor Cyan
$settingsLocations = @(
    "$env:STACK_ROOT\config\overseerr\settings.json",
    "C:\arr-stack\config\overseerr\settings.json",
    (Join-Path $PSScriptRoot "..\arr-stack\config\overseerr\settings.json")
)

$updated = $false
foreach ($loc in $settingsLocations) {
    if (Test-Path $loc) {
        try {
            $jsonContent = Get-Content -Path $loc -Raw | ConvertFrom-Json
            if ($jsonContent.main) {
                $jsonContent.main.applicationUrl = "https://$fullSeerrHostname"
            }
            if (-not $jsonContent.network) {
                $jsonContent | Add-Member -MemberType NoteProperty -Name "network" -Value ([PSCustomObject]@{})
            }
            if (-not $jsonContent.network.cloudflare) {
                $jsonContent.network | Add-Member -MemberType NoteProperty -Name "cloudflare" -Value ([PSCustomObject]@{
                    enabled = $true
                    domain = $fullSeerrHostname
                    subdomain = $Subdomain
                })
            } else {
                $jsonContent.network.cloudflare.enabled = $true
                $jsonContent.network.cloudflare.domain = $fullSeerrHostname
                $jsonContent.network.cloudflare.subdomain = $Subdomain
            }
            $jsonContent | ConvertTo-Json -Depth 10 | Set-Content -Path $loc -Encoding UTF8
            Write-Host "[OK] Updated Application URL in ${loc} -> https://$fullSeerrHostname" -ForegroundColor Green
            $updated = $true
        } catch {
            Write-Host "[!] Could not update ${loc}: $_" -ForegroundColor Yellow
        }
    }
}

Write-Host "`n=================================================================" -ForegroundColor Green
Write-Host "[OK] Cloudflare Domain & Tunnel Setup Complete!" -ForegroundColor Green
Write-Host "Your Null-seerr instance is accessible securely at:" -ForegroundColor Cyan
Write-Host "-> https://$fullSeerrHostname" -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Green
