# null-arr-stack

**The Turnkey, Autonomous, All-In-One Media Server Ecosystem & Automation Suite**

[![Project Version](https://img.shields.io/badge/version-0.0.1-blueviolet.svg?style=flat-square)](https://github.com/Zorthon28/Null-seerr)
[![Docker Ready](https://img.shields.io/badge/docker-ready-2496ED.svg?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com/)
[![Architecture: Autonomous Mesh](https://img.shields.io/badge/architecture-Autonomous%20Mesh-00C7B7.svg?style=flat-square)](https://github.com/Zorthon28/Null-seerr)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](LICENSE)

---

## What is null-arr-stack?

**null-arr-stack** is a complete, pre-integrated, self-wiring media ecosystem.

Setting up a modern home media server typically requires deploying and configuring over a dozen independent applications, generating dozens of API keys, configuring download paths, setting up reverse proxies, connecting indexers, and adjusting complex naming schemes.

**null-arr-stack solves this by providing a unified, autonomous distribution.** Upon initial startup, an embedded initialization engine automatically discovers services, extracts API keys, provisions libraries, seeds indexers, applies high-throughput download tuning, sets up dual English/Spanish subtitles, and wires the entire stack together without requiring manual setup wizards or host dependencies.

At the center of the ecosystem is **Null-seerr**, an extended fork of [Overseerr](https://github.com/sct/overseerr) and [Jellyseerr](https://github.com/Fallenbagel/jellyseerr), serving as the unified portal for discovery, requests, real-time download monitoring, retention policies, and direct web streaming.

---

## Fork & Upstream Attribution

- **Null-seerr Portal**: An extended fork of [Overseerr](https://github.com/sct/overseerr) and [Jellyseerr](https://github.com/Fallenbagel/jellyseerr), enhanced with direct multi-server library scanning, real-time torrent queue progress, per-item retention management, and unified stack controls.
- **Ecosystem Backends**: Pre-integrated with upstream community projects including [Radarr](https://radarr.video/), [Sonarr](https://sonarr.tv/), [Prowlarr](https://prowlarr.com/), [qBittorrent](https://www.qbittorrent.org/), [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr), [Jellyfin](https://jellyfin.org/), [Plex](https://www.plex.tv/), [Bazarr](https://www.bazarr.media/), [Shoko Server](https://shokoanime.com/), [Suggestarr](https://github.com/ciuse99/Suggestarr), and [Tdarr](https://tdarr.io/).

---

## What null-arr-stack Automates for You

| Component | Automated Functionality |
| :--- | :--- |
| **Autonomous Wiring Engine** | Extracts API keys and links Prowlarr, Radarr, Sonarr, qBittorrent, Bazarr, Jellyfin, and Plex automatically on boot. |
| **Instant 0-Second Boot** | Ships with pre-seeded configuration bundles to bypass setup wizards across every application. |
| **11 Seeded Public Indexers** | Pre-configures 1337x, YTS, The Pirate Bay, LimeTorrents, Torrent Downloads, TorrentDownload, TorrentProject2, Knaben, Nyaa.si, SubsPlease, and Tokyo Toshokan. |
| **Cloudflare Bypass Integration** | Pre-links FlareSolverr as an automated proxy for Cloudflare-protected indexers. |
| **High-Throughput Downloader** | qBittorrent configured with 1024 MB RAM disk write buffer, 1500 max connections, and automatic category routing (`movies`, `tv`). |
| **Swarm-Priority Quality Profiles** | Custom unified 1080p profiles that prioritize torrents with maximum active seeders and peers. |
| **Dual Subtitle Automation** | Bazarr pre-configured with dual English and Spanish profiles (`cutoff = 2`) and free public providers. |
| **Standardized File Naming** | Automatic Plex and Jellyfin media folder and file naming conventions applied across Radarr and Sonarr. |
| **Dual Media Server Provisioning** | Automatically creates Movies (`/data/media/movies`), TV Shows (`/data/media/tv`), and Anime (`/data/media/anime`) libraries in both Jellyfin and Plex. |
| **Unified Single Sign-On / Admin** | Provisions a unified administrator login across all services with local address bypass. |

---

## System Prerequisites & Requirements

### Required Software
1. **Docker Engine & Docker Compose**:
   - **Windows & macOS**: Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (ensure Docker Desktop is launched and running).
   - **Linux**: Install [Docker Engine](https://docs.docker.com/engine/install/) and the [Docker Compose plugin](https://docs.docker.com/compose/install/) (`docker compose version` >= 2.20).
2. **Windows Subsystem for Linux (WSL2)** *(Windows users only)*:
   - Docker Desktop on Windows utilizes the WSL2 backend.
   - If not already installed, open PowerShell as Administrator and run: `wsl --install`.
3. **Hardware Virtualization (VT-x / AMD-V)**:
   - Must be enabled in your computer's motherboard BIOS / UEFI settings (standard requirement for Docker Desktop and WSL2).
4. **Git** *(Optional)*:
   - Used to clone and update the repository (`git clone https://github.com/Zorthon28/Null-seerr.git`), or download the project as a ZIP archive.

### Hardware Specifications
- **Operating System**: Windows 10/11 (64-bit), Linux (Ubuntu, Debian, Fedora, Arch), or macOS (Apple Silicon / Intel).
- **RAM**: Minimum **8 GB RAM** (16 GB recommended for concurrent video transcoding).
- **Storage**: Minimum **50–100 GB** free space on your target storage drive.
- **CPU**: 64-bit x86_64 or ARM64 processor.

### What You DO NOT Need on Your Host Machine
To maintain a clean, zero-dependency environment, the entire ecosystem is containerized:
- **No Java installation required**: Shoko Server, Tdarr, Radarr, and Sonarr run within self-contained container runtimes.
- **No Python or pip required**: The autonomous setup and wiring engine executes inside an ephemeral Docker container.
- **No Node.js, npm, or pnpm required**: Null-seerr is fully compiled and packaged inside its container.
- **No database installation required**: SQLite state databases are automatically scaffolded and managed.

---

## Quick Start Guide

### 1-Click Bootstrap on Linux / macOS (Recommended for Linux)
1. Ensure Docker Engine and Docker Compose are installed.
2. Clone the repository and run `setup.sh`:
   ```bash
   git clone https://github.com/Zorthon28/Null-seerr.git
   cd Null-seerr
   chmod +x setup.sh
   ./setup.sh
   ```
3. The installer will:
   - Verify Docker daemon and compose availability.
   - Scan storage filesystems and detect optimal media library path.
   - Configure host `PUID`/`PGID` permissions.
   - Provision directory structures and copy pre-seeded templates.
   - Start the stack and execute the automated in-container wiring engine.
   - Display administrative credentials and open **http://localhost:5055**.

### 1-Click Bootstrap on Windows (Recommended for Windows)
1. Verify that Docker Desktop is installed and running.
2. Double-click `setup.bat` in the repository root (or run `powershell -ExecutionPolicy Bypass -File scripts/setup.ps1`).
3. The installer will:
   - Scan attached storage drives and select the disk with the largest free capacity.
   - Provision directory structures and copy pre-seeded templates.
   - Start the containers and execute the automated in-container wiring engine.
   - Open **http://localhost:5055** with administrative credentials displayed.

### Docker Compose CLI (Linux / macOS / Windows)
1. Clone the repository:
   ```bash
   git clone https://github.com/Zorthon28/Null-seerr.git
   cd Null-seerr
   ```
2. Start the stack:
   ```bash
   docker compose up -d
   ```
   The embedded `nullseerr-init` container will automatically wire all APIs and output access credentials to `CREDENTIALS.txt`.

---

## Service Port Directory

| Service | Local Host URL | Port | Role in Stack |
| :--- | :--- | :---: | :--- |
| **Null-seerr** | [http://localhost:5055](http://localhost:5055) | `5055` | Unified Portal, Media Discovery, Requests & Player |
| **Jellyfin** | [http://localhost:8096](http://localhost:8096) | `8096` | Open-Source Media Streaming Server |
| **Plex Media Server** | [http://localhost:32400/web](http://localhost:32400/web) | `32400` | Plex Media Server Interface |
| **Radarr** | [http://localhost:7878](http://localhost:7878) | `7878` | Movies Management & Automation |
| **Sonarr** | [http://localhost:8989](http://localhost:8989) | `8989` | TV Series & Anime Automation |
| **Prowlarr** | [http://localhost:9696](http://localhost:9696) | `9696` | Torrent Indexer Aggregator & Sync |
| **qBittorrent** | [http://localhost:8089](http://localhost:8089) | `8089` | Tuned High-Speed Download Client |
| **Bazarr** | [http://localhost:6767](http://localhost:6767) | `6767` | Dual Subtitle Automation (EN / ES) |
| **Shoko Server** | [http://localhost:8111](http://localhost:8111) | `8111` | Anime Metadata & Import Organizer |
| **FlareSolverr** | [http://localhost:8191](http://localhost:8191) | `8191` | Cloudflare Bypass Proxy |
| **Suggestarr** | [http://localhost:4455](http://localhost:4455) | `4455` | AI Recommendations Engine |
| **Tdarr** | [http://localhost:8265](http://localhost:8265) | `8265` | Video & Audio Codec Transcoder |

---

## Technical Documentation

For detailed technical specifications, architecture diagrams, volume mounts, and network access configuration, refer to **[STARTUP_GUIDE.md](./STARTUP_GUIDE.md)**.
