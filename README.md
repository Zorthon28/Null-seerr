<p align="center">
  <h1 align="center">🌌 Null-seerr</h1>
  <p align="center"><strong>The All-In-One Self-Hosted Media Automation Ecosystem & Request Suite</strong></p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.0.1-blueviolet.svg?style=for-the-badge" alt="Version 0.0.1" />
  <img src="https://img.shields.io/badge/docker-ready-2496ED.svg?style=for-the-badge&logo=docker&logoColor=white" alt="Docker Ready" />
  <img src="https://img.shields.io/badge/architecture-All--in--One-00C7B7.svg?style=for-the-badge" alt="All-In-One" />
  <img src="https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge" alt="License" />
</p>

---

## 🌟 What is Null-seerr?

**Null-seerr** is a next-generation evolution of media request management. Rather than functioning solely as a request front-end, Null-seerr delivers a **complete, turnkey media automation suite** that unifies discovery, requests, automated indexer sync, torrent routing, automated video transcoding, subtitle fetching, and direct in-browser streaming playback.

---

## ✨ Key Features & Enhancements

### 🚀 Turnkey All-In-One Media Stack
- **1-Click Interactive Setup**: Double-click `setup.bat` to automatically verify Docker, provision folders, spin up containers, auto-wire APIs, and seed indexers.
- **Unified Services**: Pre-integrated with **Radarr**, **Sonarr**, **Prowlarr**, **qBittorrent**, **FlareSolverr**, **Plex**, **Jellyfin**, **Bazarr**, **Suggestarr**, **Shoko**, and **Tdarr**.
- **Centralized `.env`**: Configure all storage directories, drives, ports, and permissions in one place.

### 🧭 Central Apps Hub
- Access and monitor your entire media server fleet directly from the **Apps** page in Null-seerr.
- Instant shortcuts to WebUIs with branded service icons and port mappings.

### 🎬 Box Office Discover & Autopilot
- Real-time **Box Office** discovery feed showcasing current theatrical hits and grossing rankings.
- **Boxarr Autopilot**: Built-in sync engine that automatically queries box-office charts and monitors new releases in Radarr.

### 🌸 Dedicated Anime Discovery & Shoko Hub
- Custom Anime discovery routes with direct integration for **Shoko Server**.
- Season-by-season anime releases, studio filters, and absolute episode numbering.

### 📺 Direct In-Browser Web Player
- Stream and preview available movies and episodes directly within the Null-seerr web UI.

### ⚡ CLI Auto-Wiring Engine (`wire_stack.py`)
- Automatically reads API keys from service configuration files.
- Auto-registers Radarr & Sonarr inside Prowlarr.
- Auto-seeds public indexers (*YTS*, *Nyaa.si*, *The Pirate Bay*, *AnimeTosho*, *LimeTorrents*, *TorrentDownload*).
- Auto-configures qBittorrent download clients with movie & TV category separation.
- Automatically applies Plex / Jellyfin standardized file and folder naming formats.

---

## ⚡ Quick Start

### 1. Interactive 1-Click Setup (Windows)
Double-click [`setup.bat`](file:///setup.bat) or run from PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

### 2. Manual Launch via Docker Compose
```powershell
# 1. Build Null-seerr image
docker build -t null-seerr:latest .

# 2. Launch stack
docker compose -f C:\arr-stack\docker-compose.yml up -d

# 3. Auto-wire stack
python C:\arr-stack\wire_stack.py
```

Open your browser at **[http://localhost:5055](http://localhost:5055)** to access Null-seerr!

---

## 🌐 Default Port & Service Directory

| Service | Local URL | Port | Role |
| :--- | :--- | :--- | :--- |
| **Null-seerr** | [http://localhost:5055](http://localhost:5055) | `5055` | Unified Portal, Discover, Requests & Player |
| **Radarr** | [http://localhost:7878](http://localhost:7878) | `7878` | Movies Automation |
| **Sonarr** | [http://localhost:8989](http://localhost:8989) | `8989` | TV Series Automation |
| **Prowlarr** | [http://localhost:9696](http://localhost:9696) | `9696` | Indexer Sync & Aggregation |
| **qBittorrent** | [http://localhost:8089](http://localhost:8089) | `8080` | Torrent Download Client |
| **FlareSolverr** | [http://localhost:8191](http://localhost:8191) | `8191` | Cloudflare Bypass Proxy |
| **Plex** | [http://localhost:32400/web](http://localhost:32400/web) | `32400` | Media Streaming Server |
| **Jellyfin** | [http://localhost:8096](http://localhost:8096) | `8096` | Open Source Media Streaming |
| **Bazarr** | [http://localhost:6767](http://localhost:6767) | `6767` | Subtitles Automation |
| **Suggestarr** | [http://localhost:4455](http://localhost:4455) | `5000` | AI Movie & TV Recommendations |
| **Shoko** | [http://localhost:8111](http://localhost:8111) | `8111` | Dedicated Anime Catalog |
| **Tdarr** | [http://localhost:8265](http://localhost:8265) | `8265` | Video Transcoder & Optimizer |

---

## 📖 Documentation

For detailed installation guides, cURL/REST API cheatsheets, and backup instructions, see **[STARTUP_GUIDE.md](./STARTUP_GUIDE.md)**.

---

## 🛠 Contributing & Development

Contributions are welcome! Please review our [Contribution Guide](./CONTRIBUTING.md) and submit pull requests following our [PR Template](.github/PULL_REQUEST_TEMPLATE.md).

```bash
# Clone the repository
git clone https://github.com/Zorthon28/Null-seerr.git
cd Null-seerr

# Install dependencies
pnpm install

# Run development server
pnpm dev
```

---

## 📄 License
This project is licensed under the [MIT License](./LICENSE).
