# 🚀 Null-seerr All-In-One Media Stack: Setup & Wiring Guide

An automated, self-hosted media ecosystem powered by **Null-seerr**, connecting indexers, download clients, metadata automation, transcoders, and media playback servers via unified CLI tooling.

---

## 🏛 Architecture Overview

```mermaid
graph TD
    User([User / Browser]) -->|Requests / Discovery / Stream| Seerr[Null-seerr :5055]
    User -->|Stream Playback| Plex[Plex :32400]
    User -->|Stream Playback| Jellyfin[Jellyfin :8096]

    Seerr -->|Movie Requests| Radarr[Radarr :7878]
    Seerr -->|TV Requests| Sonarr[Sonarr :8989]
    Seerr -->|Anime Catalog| Shoko[Shoko :8111]

    Prowlarr[Prowlarr :9696] -->|Indexers Sync| Radarr
    Prowlarr -->|Indexers Sync| Sonarr
    Prowlarr -->|Bypass Protection| Flaresolverr[FlareSolverr :8191]

    Radarr -->|Torrents / Magnet| Qbit[qBittorrent :8089]
    Sonarr -->|Torrents / Magnet| Qbit

    Qbit -->|Downloads / Media| Storage[C:/arr-stack/data]
    Storage --> Plex
    Storage --> Jellyfin
    Storage -->|Auto Transcode| Tdarr[Tdarr :8265]
    Storage -->|Subtitles| Bazarr[Bazarr :6767]
```

---

## ⚡ Quick Start (1-Click Launch)

If you are inside `C:\arr-stack`, you can execute the pre-built launcher scripts:

1. **Start all services**: Double-click [`start-stack.bat`](file:///C:/arr-stack/start-stack.bat)
2. **Auto-wire everything**: Double-click [`wire-stack.bat`](file:///C:/arr-stack/wire-stack.bat)
3. **Run Box Office Autopilot**: Double-click [`run-boxarr.bat`](file:///C:/arr-stack/run-boxarr.bat)
4. **Stop stack**: Double-click [`stop-stack.bat`](file:///C:/arr-stack/stop-stack.bat)

---

## 💻 CLI Step-by-Step Setup Commands

Run these commands in PowerShell or Terminal to initialize the full stack from source.

### Step 1: Build Null-seerr Production Image
```powershell
cd C:\Users\zorthon28\Documents\GitHub\Null-seerr
docker build -t null-seerr:latest .
```

### Step 2: Initialize Folder Structure & Volumes
```powershell
$dirs = @(
    "C:\arr-stack\config\overseerr",
    "C:\arr-stack\config\plex",
    "C:\arr-stack\config\jellyfin",
    "C:\arr-stack\config\prowlarr",
    "C:\arr-stack\config\qbittorrent",
    "C:\arr-stack\config\radarr",
    "C:\arr-stack\config\sonarr",
    "C:\arr-stack\config\bazarr",
    "C:\arr-stack\config\suggestarr",
    "C:\arr-stack\config\shoko",
    "C:\arr-stack\config\tdarr\server",
    "C:\arr-stack\config\tdarr\configs",
    "C:\arr-stack\config\tdarr\logs",
    "C:\arr-stack\config\autobrr",
    "C:\arr-stack\data\media\movies",
    "C:\arr-stack\data\media\tv",
    "C:\arr-stack\data\media\anime",
    "C:\arr-stack\data\torrents\movies",
    "C:\arr-stack\data\torrents\tv",
    "C:\arr-stack\data\torrents\anime",
    "C:\arr-stack\data\transcode_cache"
)
foreach ($d in $dirs) {
    if (!(Test-Path -Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
    }
}
```

### Step 3: Launch Docker Containers
```powershell
cd C:\arr-stack
docker compose up -d
```

### Step 4: Run Automated CLI Wiring Tool
The auto-wiring script extracts all API keys from config files and programs the API endpoints across all services:
```powershell
cd C:\arr-stack
python wire_stack.py
```

### Step 5: Run Boxarr Box-Office Autopilot
Automatically detects trending box office releases and pushes monitored requests directly into Radarr:
```powershell
cd C:\arr-stack
python boxarr.py
```

---

## 🌐 Service Directory & Port Reference

| Service | Local URL | Container Port | Purpose | Default Credentials / Note |
| :--- | :--- | :--- | :--- | :--- |
| **Null-seerr** | [http://localhost:5055](http://localhost:5055) | `5055` | Unified Portal, Requests, Stream | Primary UI |
| **Radarr** | [http://localhost:7878](http://localhost:7878) | `7878` | Movie Management | API in `config/radarr/config.xml` |
| **Sonarr** | [http://localhost:8989](http://localhost:8989) | `8989` | TV Series Management | API in `config/sonarr/config.xml` |
| **Prowlarr** | [http://localhost:9696](http://localhost:9696) | `9696` | Indexer Sync & Torrent Aggregation | API in `config/prowlarr/config.xml` |
| **qBittorrent** | [http://localhost:8089](http://localhost:8089) | `8080` | Download Client | `admin` / `admin1234` |
| **FlareSolverr**| [http://localhost:8191](http://localhost:8191) | `8191` | Cloudflare Solver Proxy | API Proxy |
| **Plex** | [http://localhost:32400/web](http://localhost:32400/web) | `32400` | Media Streaming Server | Plex Account |
| **Jellyfin** | [http://localhost:8096](http://localhost:8096) | `8096` | Open Source Media Server | Local admin |
| **Bazarr** | [http://localhost:6767](http://localhost:6767) | `6767` | Subtitle Automation | Links to Radarr/Sonarr |
| **Suggestarr** | [http://localhost:4455](http://localhost:4455) | `5000` | AI Movie & TV Recommendations | Discovers recommendations |
| **Shoko** | [http://localhost:8111](http://localhost:8111) | `8111` | Dedicated Anime Catalog | Anime DB Scanner |
| **Tdarr** | [http://localhost:8265](http://localhost:8265) | `8265` | Video Transcoder & Optimizer | Transcode Cache |

---

## 🛠 Manual CLI & API Wiring Cheatsheet

If you want to manually interact with or customize service APIs via terminal commands:

### 1. Test Radarr Status via cURL
```bash
curl -X GET "http://localhost:7878/api/v3/system/status" \
     -H "X-Api-Key: 6d504b09cc2242d1a9ebbfb5a0e0753c"
```

### 2. Test Sonarr Status via cURL
```bash
curl -X GET "http://localhost:8989/api/v3/system/status" \
     -H "X-Api-Key: 0c4101ed9b1e4946b2b494d4e6ec4707"
```

### 3. Register Radarr in Prowlarr manually via API
```bash
curl -X POST "http://localhost:9696/api/v1/applications" \
     -H "X-Api-Key: 1f333be33e60414e8dbc728d2496f207" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Radarr",
       "syncLevel": "fullSync",
       "implementation": "Radarr",
       "configContract": "RadarrSettings",
       "fields": [
         {"name": "prowlarrUrl", "value": "http://prowlarr:9696"},
         {"name": "baseUrl", "value": "http://radarr:7878"},
         {"name": "apiKey", "value": "6d504b09cc2242d1a9ebbfb5a0e0753c"},
         {"name": "syncCategories", "value": [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060, 2070, 2080]}
       ]
     }'
```

### 4. Query Null-seerr Media API
```bash
curl -X GET "http://localhost:5055/api/v1/discover/movies?sortBy=popularity.desc" \
     -H "X-Api-Key: MTc4NjAzOTYzNTU3NTM3MGRmZTdmLWM2MTQtNDljZS04MDMwLWYxYTNmZjc4MTUzYQ=="
```

---

## 🔧 Troubleshooting & Routine Maintenance

### Check Stack Logs
```powershell
docker compose -f C:\arr-stack\docker-compose.yml logs -f null-seerr
docker compose -f C:\arr-stack\docker-compose.yml logs -f radarr
docker compose -f C:\arr-stack\docker-compose.yml logs -f sonarr
```

### Restart a Specific Container
```powershell
docker compose -f C:\arr-stack\docker-compose.yml restart null-seerr
```

### Clean Backup Configuration
All database files and configs are isolated inside [`C:\arr-stack\config`](file:///C:/arr-stack/config) and can be backed up with standard zip or robocopy commands.
