# Null-seerr

**The All-In-One Self-Hosted Media Automation Ecosystem & Request Suite**

[![Version](https://img.shields.io/badge/version-0.0.1-blueviolet.svg?style=flat-square)](https://github.com/Zorthon28/Null-seerr)
[![Docker Ready](https://img.shields.io/badge/docker-ready-2496ED.svg?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com/)
[![Architecture](https://img.shields.io/badge/architecture-All--in--One-00C7B7.svg?style=flat-square)](https://github.com/Zorthon28/Null-seerr)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](LICENSE)

---

## Origin & Fork Notice

**Null-seerr** is an extended fork of [Overseerr](https://github.com/sct/overseerr) and [Jellyseerr](https://github.com/Fallenbagel/jellyseerr).

While upstream Overseerr and Jellyseerr operate strictly as request management frontends requiring users to manually deploy, wire, configure, and maintain separate backend services, Null-seerr expands the platform into a **complete, turnkey media automation ecosystem**. It introduces automatic stack wiring, pre-seeded indexer templates, concurrent Jellyfin and Plex library scanning, real-time torrent queue monitoring with retention policies, maximum swarm seeder prioritization, and a zero-dependency 1-click bootstrap installer.

Special thanks to the original creators and contributors of [Overseerr](https://github.com/sct/overseerr) and [Jellyseerr](https://github.com/Fallenbagel/jellyseerr) for establishing the foundation upon which this ecosystem is built.

---

## Core Capabilities

### 1. Turnkey All-In-One Media Stack
- **Zero-Dependency 1-Click Setup**: Run `setup.bat` on Windows or `docker compose up -d` on any OS. An in-container setup engine automatically configures all 12 services with zero manual API wiring or host dependencies.
- **Smart Storage Auto-Detection**: Analyzes connected storage drives, identifies the disk with the largest free capacity, and automatically binds Docker storage paths.
- **Pre-Seeded Configuration Bundles**: Shipped with pre-baked, production-grade configuration templates for immediate zero-second startup.

### 2. Unified Service Fleet
Pre-integrated with:
- **Radarr**: Automated movie collection and quality management.
- **Sonarr**: Automated TV series and anime season management.
- **Prowlarr**: Centralized indexer aggregation with 11 pre-seeded public indexers (1337x, YTS, The Pirate Bay, LimeTorrents, Torrent Downloads, Knaben, Nyaa.si, SubsPlease, Tokyo Toshokan).
- **FlareSolverr**: Cloudflare challenge bypass proxy linked directly to Prowlarr indexers.
- **qBittorrent**: High-speed torrent client tuned with a 1GB RAM write buffer, 1500 max connections, and automatic category routing (`movies`, `tv`).
- **Jellyfin & Plex Media Server**: Dual media server provisioning with pre-configured library paths for Movies (`/data/media/movies`), TV Shows (`/data/media/tv`), and Anime (`/data/media/anime`).
- **Bazarr**: Automated subtitle fetching configured with dual English and Spanish profiles (`cutoff = 2`) and free public providers.
- **Shoko Server**: Specialized anime cataloging and AniDB synchronization with automatic import folder monitoring.
- **Suggestarr & Tdarr**: AI-driven recommendation engine and automated video/audio transcode processing.

### 3. Request & Download Management Enhancements
- **Concurrent Library Scanning**: A single "Scan Library" trigger updates both Jellyfin and Plex servers simultaneously.
- **Dual Availability & Playback**: Simultaneous "Play on Jellyfin" and "Play on Plex" deep-linking from media detail pages.
- **Download Queue Monitor**: Real-time progress bars, download speeds, ETA calculations, and swarm health diagnostics embedded directly inside the Null-seerr interface.
- **Granular Retention Policies**: Per-request retention settings (Keep Indefinitely, Delete After Watched, Delete After 7 Days).
- **Seeder Prioritization**: Unified 1080p quality profile configured to prioritize releases with the highest swarm seeder and peer counts over scene naming conventions.

---

## Quick Start Guide

### Option A: 1-Click Windows Setup (Recommended)
1. Ensure Docker Desktop is installed and running.
2. Double-click `setup.bat` in the repository root (or run `powershell -ExecutionPolicy Bypass -File scripts/setup.ps1`).
3. The script will detect your largest drive, scaffold folder structures, copy pre-seeded templates, start containers, and perform automated API wiring.
4. Open **http://localhost:5055** in your browser.

### Option B: Pure Docker Compose (Cross-Platform)
1. Clone the repository:
   ```bash
   git clone https://github.com/Zorthon28/Null-seerr.git
   cd Null-seerr
   ```
2. Copy the environment template if customization is needed:
   ```bash
   cp .env.example .env
   ```
3. Start the stack:
   ```bash
   docker compose up -d
   ```
   The embedded `nullseerr-init` container will automatically handle service initialization and API wiring in the background.

---

## Default Service Ports

| Service | Local URL | Port | Function |
| :--- | :--- | :---: | :--- |
| **Null-seerr** | [http://localhost:5055](http://localhost:5055) | `5055` | Media Portal, Requests, Discovery & Streaming |
| **Jellyfin** | [http://localhost:8096](http://localhost:8096) | `8096` | Open-Source Media Streaming Server |
| **Plex** | [http://localhost:32400/web](http://localhost:32400/web) | `32400` | Plex Media Server Web Client |
| **Radarr** | [http://localhost:7878](http://localhost:7878) | `7878` | Movies Management & Automation |
| **Sonarr** | [http://localhost:8989](http://localhost:8989) | `8989` | TV Series & Anime Automation |
| **Prowlarr** | [http://localhost:9696](http://localhost:9696) | `9696` | Indexer Sync & Torrent Proxy |
| **qBittorrent** | [http://localhost:8089](http://localhost:8089) | `8089` | Torrent Download Engine |
| **Bazarr** | [http://localhost:6767](http://localhost:6767) | `6767` | Subtitle Automation (EN & ES) |
| **Shoko Server** | [http://localhost:8111](http://localhost:8111) | `8111` | Anime Metadata & File Organizer |
| **FlareSolverr** | [http://localhost:8191](http://localhost:8191) | `8191` | Cloudflare Bypass Proxy |
| **Suggestarr** | [http://localhost:4455](http://localhost:4455) | `4455` | AI Recommendations Engine |
| **Tdarr** | [http://localhost:8265](http://localhost:8265) | `8265` | Video & Audio Codec Transcoder |

---

## Detailed Documentation

For full architectural deep-dives, manual API references, troubleshooting, and network access configuration, consult **[STARTUP_GUIDE.md](./STARTUP_GUIDE.md)**.
