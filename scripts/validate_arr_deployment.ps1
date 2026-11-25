param(
    [string]$StackRoot = 'C:/arr-stack',
    [string]$Manifest = 'C:/arr-stack/compose.reconciled.yml',
    [string]$ExpectedDataRoot = 'D:/arr-stack/data',
    [string]$ExpectedVolumeSerial,
    [switch]$Tunnel
)

$ErrorActionPreference = 'Stop'
$composeArgs = @('--project-directory', $StackRoot, '-f', $Manifest)
if ($Tunnel) { $composeArgs += @('--profile', 'tunnel') }
$raw = docker compose @composeArgs config --format json
if ($LASTEXITCODE -ne 0) { throw 'Compose configuration did not validate.' }
$config = ($raw -join "`n") | ConvertFrom-Json
if ($Tunnel -and [string]::IsNullOrWhiteSpace($config.services.cloudflared.environment.TUNNEL_TOKEN)) {
    throw 'The tunnel profile requires a valid token in the protected environment.'
}

$canonicalData = (Resolve-Path -LiteralPath $ExpectedDataRoot).Path
if ($ExpectedVolumeSerial) {
    $device = [IO.Path]::GetPathRoot($canonicalData).TrimEnd('\')
    $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID = '$device'"
    if ($disk.VolumeSerialNumber -ne $ExpectedVolumeSerial) { throw 'Unexpected media volume.' }
}
foreach ($part in @('media/movies', 'media/tv', 'media/anime', 'torrents', 'usenet')) {
    if (!(Test-Path -LiteralPath (Join-Path $canonicalData $part) -PathType Container)) {
        throw "Expected data directory is missing: $part"
    }
}

$running = @()
foreach ($name in @(docker ps -q)) {
    $rawContainer = docker inspect $name --format '{{json .NetworkSettings.Ports}}|{{.Name}}'
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify published Docker ports.' }
    $bindings, $containerName = $rawContainer -split '\|', 2
    foreach ($binding in ($bindings | ConvertFrom-Json).PSObject.Properties) {
        foreach ($endpoint in $binding.Value) {
            $running += [pscustomobject]@{ Port = $endpoint.HostPort; Protocol = ($binding.Name -split '/')[1]; Name = $containerName.TrimStart('/') }
        }
    }
}

foreach ($service in $config.services.PSObject.Properties) {
    $spec = $service.Value
    if ($spec.profiles -and !($Tunnel -and $spec.profiles -contains 'tunnel')) { continue }
    if ($service.Name -ne 'cloudflared' -and $spec.image -notmatch '@sha256:[a-f0-9]{64}$') {
        throw "Image must be pinned for $($service.Name)."
    }
    foreach ($mount in @($spec.volumes | Where-Object type -eq 'bind')) {
        if (!(Test-Path -LiteralPath $mount.source)) { throw "Missing bind source for $($service.Name): $($mount.source)" }
        if ($mount.target -in @('/data', '/data/media')) {
            $expected = if ($mount.target -eq '/data') { $canonicalData } else { Join-Path $canonicalData 'media' }
            if ((Resolve-Path -LiteralPath $mount.source).Path -ne $expected) {
                throw "Unexpected media bind source for $($service.Name)."
            }
        }
    }
    foreach ($port in @($spec.ports | Where-Object published)) {
        $conflict = $running | Where-Object { $_.Port -eq $port.published -and $_.Protocol -eq $port.protocol -and $_.Name -ne $spec.container_name }
        if ($conflict) { throw "Port $($port.published)/$($port.protocol) is already published by another container." }
    }
}

$webUi = $config.services.qbittorrent.ports | Where-Object { $_.target -eq 8080 -and $_.protocol -eq 'tcp' }
if (@($webUi | Where-Object { $_.host_ip -notin @('127.0.0.1', '::1') }).Count) {
    throw 'qBittorrent Web UI must remain bound to loopback.'
}
Write-Output 'Compose, data paths, media mounts, and Docker port assignments passed preflight.'
