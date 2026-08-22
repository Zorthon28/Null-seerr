# null-arr-stack: Architecture, Installation & Operations Guide

This guide provides a comprehensive technical reference for deploying, configuring, and maintaining the null-arr-stack all-in-one media ecosystem.

---

## 1. System Architecture

The ecosystem operates as a containerized mesh of specialized services communicating across an internal Docker bridge network (`arr-stack`). Media acquisition, processing, and playback follow a structured workflow:

```mermaid
graph TD
    User([User / Browser / TV]) -->|Requests & Discovery| Seerr[Null-seerr :5055]
    User -->|Media Streaming| Plex[Plex :32400]
    User -->|Media Streaming| Jellyfin[Jellyfin :8096]

    Seerr -->|Movie Requests| Radarr[Radarr :7878]
    Seerr -->|TV Series Requests| Sonarr[Sonarr :8989]
    Seerr -->|Anime Requests| Shoko[Shoko :8111]

    Prowlarr[Prowlarr :9696] -->|Indexer Sync| Radarr
    Prowlarr -->|Indexer Sync| Sonarr
    Prowlarr -->|Bypass Proxy| Flaresolverr[FlareSolverr :8191]

    Radarr -->|Torrents & Categories| Qbit[qBittorrent :8089]
    Sonarr -->|Torrents & Categories| Qbit

    Qbit -->|Completed Downloads| Storage[/data/torrents -> /data/media]
    Storage --> Plex
    Storage --> Jellyfin
    Storage -->|Subtitle Fetching| Bazarr[Bazarr :6767]
    Storage -->|Audio/Video Normalization| Tdarr[Tdarr :8265]
```

### Core Architecture Principles:
1. **Separation of Concerns**: Each microservice manages a distinct domain (indexers, metadata, downloading, streaming, subtitles, transcoding).
2. **Unified Data Layer**: Media files and configuration databases are mounted to host-managed paths using consistent Unix-style directory structures (`/data/media/movies`, `/data/media/tv`, `/data/media/anime`, `/data/torrents`).
3. **Automated Provisioning**: The `nullseerr-init` container executes on boot to wire API keys, seed indexers, configure quality profiles, and synchronize database states without requiring manual user intervention.

---

## 2. Prerequisites & System Requirements

### Hardware Requirements
- **Operating System**: Windows 10/11 (with WSL2), Linux (Ubuntu, Debian, Fedora, Arch), or macOS (Apple Silicon or Intel).
- **RAM**: Minimum 8 GB (16 GB recommended when running concurrent transcodes).
- **Storage**: Minimum 50 GB free disk space on your target media drive.

### Software Prerequisites
- **Docker Desktop** (Windows / macOS) or **Docker Engine with Compose v2** (Linux).
- Virtualization enabled in system BIOS / UEFI.

---

## 3. Installation Methods

### Method A: Automated Bootstrap Installer (Windows)

The automated installer detects available storage volumes, provisions the file hierarchy, generates `.env`, and launches the stack:

1. Clone or download the repository to your system:
   ```powershell
   git clone https://github.com/Zorthon28/Null-seerr.git
   cd Null-seerr
   ```
2. Double-click `setup.bat` or execute via PowerShell:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup.ps1
   ```
3. The installer will:
   - Verify that Docker Engine is responsive.
   - Scan all attached storage drives and select the disk with the largest available capacity.
   - Provision required directory paths (`/config`, `/data/media/movies`, `/data/media/tv`, `/data/media/anime`, `/data/torrents`).
   - Copy pre-seeded configuration bundles from `templates/` to prevent initial setup wizards.
   - Generate a local `.env` configuration file.
   - Execute `docker compose up -d`.
   - Launch `nullseerr-init` to wire all backend APIs and generate `CREDENTIALS.txt`.
   - Open `http://localhost:5055` in your default browser.

---

### Method B: Manual Docker Compose Deployment (Linux / macOS / Windows CLI)

If deploying on a headless Linux server or custom environment:

1. Clone the repository:
   ```bash
   git clone https://github.com/Zorthon28/Null-seerr.git
   cd Null-seerr
   ```
2. Copy and customize the environment template:
   ```bash
   cp .env.example .env
   ```
3. Modify `.env` to define your host storage paths:
   ```env
   STACK_ROOT=/opt/arr-stack
   CONFIG_ROOT=/opt/arr-stack/config
   DATA_ROOT=/opt/arr-stack/data
   MEDIA_ROOT=/opt/arr-stack/data/media
   TV_DIR=/opt/arr-stack/data/media/tv
   TRANSCODE_CACHE=/opt/arr-stack/data/transcode_cache
   ```
4. Build and start the services:
   ```bash
   docker compose up -d
   ```
5. Check initialization status via container logs:
   ```bash
   docker logs nullseerr-init
   ```

---

## 4. Default Port Directory

| Service | Local Host URL | Internal Container Port | Description |
| :--- | :--- | :---: | :--- |
| **Null-seerr** | [http://localhost:5055](http://localhost:5055) | `5055` | Primary Web UI, Media Requests & Video Player |
| **Jellyfin** | [http://localhost:8096](http://localhost:8096) | `8096` | Open-Source Media Streaming Server |
| **Plex** | [http://localhost:32400/web](http://localhost:32400/web) | `32400` | Plex Media Server Interface |
| **Radarr** | [http://localhost:7878](http://localhost:7878) | `7878` | Movie Acquisition & Management |
| **Sonarr** | [http://localhost:8989](http://localhost:8989) | `8989` | TV Series & Anime Acquisition |
| **Prowlarr** | [http://localhost:9696](http://localhost:9696) | `9696` | Torrent Indexer Aggregator |
| **qBittorrent** | [http://localhost:8089](http://localhost:8089) | `8080` | BitTorrent Client Web Interface |
| **Bazarr** | [http://localhost:6767](http://localhost:6767) | `6767` | Subtitle Automation Engine |
| **Shoko Server** | [http://localhost:8111](http://localhost:8111) | `8111` | Anime Catalog & Metadata Management |
| **FlareSolverr** | [http://localhost:8191](http://localhost:8191) | `8191` | Cloudflare Challenge Solver Proxy |
| **Suggestarr** | [http://localhost:4455](http://localhost:4455) | `5000` | AI Movie & TV Recommendation Engine |
| **Tdarr** | [http://localhost:8265](http://localhost:8265) | `8265` | Video Transcoder Web Interface |

---

## 5. Network Access Configuration

### Local Host vs Local Area Network (LAN) Access

- **On the Host Machine**: Access all services using `http://localhost:<PORT>` or `http://127.0.0.1:<PORT>`.
- **On Other Devices (Mobile Phones, Smart TVs, Laptops on same Wi-Fi)**: Access services using your host machine's LAN IP address:
  - Find your LAN IP by running `ipconfig` (Windows) or `ip addr` (Linux).
  - Example: `http://192.168.0.168:5055` (Null-seerr) or `http://192.168.0.168:8096` (Jellyfin).

> [!NOTE]
> If accessing from other devices on your home network fails, verify that Windows Defender Firewall or your Linux firewall (`ufw` / `iptables`) allows inbound connections on ports `5055`, `8096`, and `32400`.

---

## 6. Subsystem Configurations & Optimizations

### High-Throughput Download Engine (qBittorrent)
The automated configuration applies the following performance parameters in `qBittorrent.conf`:
- **Disk Write Cache**: Configured to 1024 MB RAM write buffer to minimize disk I/O thrashing during multi-gigabit downloads.
- **Connection Limits**: 1500 maximum global connections, 500 connections per torrent.
- **Async I/O Threads**: 16 dedicated disk threads.
- **WebUI Host Header Validation**: Disabled to permit proxying and direct IP access across local subnets.

### Subtitle Automation (Bazarr)
- **Language Profiles**: Profile 1 configured for dual English (`en`) and Spanish (`es`) acquisition with cutoff set to 2.
- **Providers**: Pre-configured with free public providers including BSPlayer, SuperSubtitles, YifySubtitles, AnimeTosho, SubF2M, and EmbeddedSubtitles.

### Swarm-Priority Quality Profiles (Radarr & Sonarr)
- Both Radarr and Sonarr are configured with a unified **1080p (Any Source / Max Seeders)** quality grouping.
- Rather than strictly rejecting releases that do not match exact scene tags (e.g. demanding Raw Remux over high-efficiency x265 encodes), the engine prioritizes torrents with the largest active swarm seeder and peer counts.

---

## 7. Maintenance & Troubleshooting

### Viewing Service Logs
```bash
# View all container logs
docker compose logs -f

# View a specific service log
docker compose logs -f null-seerr
docker compose logs -f jellyfin
docker compose logs -f radarr
```

### Re-running the Auto-Wiring Engine
If you manually change credentials, replace API keys, or add new library directories, you can re-trigger stack synchronization at any time:
```bash
python scripts/wire_stack.py
```
*or via Docker:*
```bash
docker compose run --rm nullseerr-init
```

### Resetting Service State
To perform a complete clean reset of configuration databases while preserving your downloaded media files:
1. Stop all containers:
   ```bash
   docker compose down
   ```
2. Delete specific service configuration folders inside `config/` (e.g. `config/jellyfin` or `config/overseerr`).
3. Re-run `setup.bat` or `docker compose up -d` to re-seed from templates.
