#!/usr/bin/env bash
# =====================================================================
# Null-seerr All-In-One Media Stack 1-Click Bootstrap Installer (Linux)
# Automatically detects storage, permissions (PUID/PGID), seeds templates,
# starts Docker stack, and wires everything with ZERO host dependencies!
# =====================================================================

set -e

# ANSI color codes
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
WHITE='\033[1;37m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$SCRIPT_DIR"

echo -e "${CYAN}=================================================================${NC}"
echo -e "${YELLOW}✨ NULL-SEERR ALL-IN-ONE MEDIA STACK 1-CLICK INSTALLER (LINUX) ✨${NC}"
echo -e "${CYAN}=================================================================${NC}"

# 1. Check Docker status
echo -e "\n${CYAN}[*] Checking Docker Engine status...${NC}"

if ! command -v docker >/dev/null 2>&1; then
    echo -e "${RED}[ERROR] Docker command not found.${NC}"
    echo -e "${YELLOW}Please install Docker Engine from https://docs.docker.com/engine/install/${NC}"
    exit 1
fi

# Detect Docker Compose command (docker compose plugin vs docker-compose standalone)
if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
else
    echo -e "${RED}[ERROR] Docker Compose not found.${NC}"
    echo -e "${YELLOW}Please install the Docker Compose plugin: https://docs.docker.com/compose/install/${NC}"
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo -e "${YELLOW}[!] Docker daemon is not running or current user lacks docker group permission.${NC}"
    if command -v systemctl >/dev/null 2>&1; then
        echo -e "${CYAN}[*] Attempting to start Docker daemon via systemctl...${NC}"
        sudo systemctl start docker 2>/dev/null || true
        sleep 2
    fi
    if ! docker info >/dev/null 2>&1; then
        echo -e "${RED}[ERROR] Cannot connect to Docker daemon.${NC}"
        echo -e "${YELLOW}Try: sudo systemctl start docker${NC}"
        echo -e "${YELLOW}Or grant user permission: sudo usermod -aG docker \$USER && newgrp docker${NC}"
        exit 1
    fi
fi

DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "detected")
echo -e "${GREEN}[OK] Docker Engine is active (v${DOCKER_VERSION})${NC}"
echo -e "${GREEN}[OK] Using compose command: ${DOCKER_COMPOSE}${NC}"

# 2. Smart Storage Detection & Selection
echo -e "\n${CYAN}[*] Scanning local storage drives for media library...${NC}"

# Detect largest non-tmpfs filesystem with available storage
BEST_MOUNT="/"
MAX_AVAIL=0

# Parse df output (1K-blocks)
while read -r fs blocks used avail pct target; do
    # Skip header and pseudo filesystems
    if [ "$fs" = "Filesystem" ] || [ "$fs" = "tmpfs" ] || [ "$fs" = "devtmpfs" ] || [ "$fs" = "overlay" ] || [ "$fs" = "squashfs" ]; then
        continue
    fi
    # Filter numeric avail
    if [ "$avail" -gt "$MAX_AVAIL" ] 2>/dev/null; then
        MAX_AVAIL=$avail
        BEST_MOUNT="$target"
    fi
done < <(df -Pk 2>/dev/null | awk '{print $1, $2, $3, $4, $5, $6}')

MAX_AVAIL_GB=$(( MAX_AVAIL / 1024 / 1024 ))

# Target base path determination
if [ -n "$STACK_ROOT" ]; then
    STACK_ROOT="$STACK_ROOT"
elif [ "$BEST_MOUNT" = "/" ] || [ "$BEST_MOUNT" = "/home" ]; then
    STACK_ROOT="$HOME/arr-stack"
else
    STACK_ROOT="${BEST_MOUNT}/arr-stack"
fi

echo -e "Detected optimal storage mount: ${YELLOW}${BEST_MOUNT}${NC} (${MAX_AVAIL_GB} GB free)"
echo -e "${GREEN}Target Media Stack Path: ${STACK_ROOT}${NC}"

# 3. Detect PUID & PGID
HOST_PUID=$(id -u)
HOST_PGID=$(id -g)
echo -e "${CYAN}[+] Container User IDs: PUID=${HOST_PUID}, PGID=${HOST_PGID}${NC}"

# 4. Provision Directory Hierarchy
echo -e "\n${CYAN}[*] Provisioning directory hierarchy...${NC}"
FOLDERS=(
    "${STACK_ROOT}/config/qbittorrent"
    "${STACK_ROOT}/config/radarr"
    "${STACK_ROOT}/config/sonarr"
    "${STACK_ROOT}/config/prowlarr"
    "${STACK_ROOT}/config/bazarr/config"
    "${STACK_ROOT}/config/overseerr"
    "${STACK_ROOT}/config/jellyfin"
    "${STACK_ROOT}/config/plex"
    "${STACK_ROOT}/config/shoko"
    "${STACK_ROOT}/config/suggestarr"
    "${STACK_ROOT}/config/tdarr/server"
    "${STACK_ROOT}/config/tdarr/configs"
    "${STACK_ROOT}/config/tdarr/logs"
    "${STACK_ROOT}/config/autobrr"
    "${STACK_ROOT}/data/media/movies"
    "${STACK_ROOT}/data/media/tv"
    "${STACK_ROOT}/data/media/anime"
    "${STACK_ROOT}/data/torrents/movies"
    "${STACK_ROOT}/data/torrents/tv"
    "${STACK_ROOT}/data/torrents/anime"
    "${STACK_ROOT}/data/torrents/incomplete"
    "${STACK_ROOT}/data/transcode_cache"
)

for folder in "${FOLDERS[@]}"; do
    if [ ! -d "$folder" ]; then
        mkdir -p "$folder"
    fi
done

# Set secure folder permissions
find "${STACK_ROOT}" -type d -exec chmod 750 {} + 2>/dev/null || true
find "${STACK_ROOT}/data" -type d -exec chmod 775 {} + 2>/dev/null || true
echo -e "${GREEN}[OK] Folder hierarchy provisioned & permissions set${NC}"

# 5. Copy Pre-Seeded Configuration Templates
TEMPLATES_DIR="${REPO_DIR}/templates"
if [ -d "$TEMPLATES_DIR" ]; then
    echo -e "${CYAN}[*] Applying pre-seeded configuration templates...${NC}"
    
    copy_template() {
        local src="${TEMPLATES_DIR}/$1"
        local dst="${STACK_ROOT}/$2"
        if [ -f "$src" ] && [ ! -f "$dst" ]; then
            mkdir -p "$(dirname "$dst")"
            cp "$src" "$dst"
            echo -e "  [+] Seeded: $1"
        fi
    }

    copy_template "qbittorrent/qBittorrent.conf" "config/qbittorrent/qBittorrent/qBittorrent.conf"
    copy_template "radarr/config.xml" "config/radarr/config.xml"
    copy_template "sonarr/config.xml" "config/sonarr/config.xml"
    copy_template "prowlarr/config.xml" "config/prowlarr/config.xml"
    copy_template "bazarr/config/config.yaml" "config/bazarr/config/config.yaml"
    copy_template "overseerr/settings.json" "config/overseerr/settings.json"
fi

# 6. Generate .env File
ENV_PATH="${REPO_DIR}/.env"
cat <<EOF > "$ENV_PATH"
# Auto-generated by Null-seerr Linux Setup
STACK_ROOT=${STACK_ROOT}
CONFIG_ROOT=${STACK_ROOT}/config
DATA_ROOT=${STACK_ROOT}/data
MEDIA_ROOT=${STACK_ROOT}/data/media
TV_DIR=${STACK_ROOT}/data/media/tv
TRANSCODE_CACHE=${STACK_ROOT}/data/transcode_cache
PUID=${HOST_PUID}
PGID=${HOST_PGID}
TZ=${TZ:-Etc/UTC}
NULL_SEERR_PORT=5055
RADARR_PORT=7878
SONARR_PORT=8989
PROWLARR_PORT=9696
QBIT_WEBUI_PORT=8089
QBIT_TORRENT_PORT=6881
JELLYFIN_PORT=8096
PLEX_PORT=32400
BAZARR_PORT=6767
SHOKO_PORT=8111
SUGGESTARR_PORT=4455
TDARR_WEB_PORT=8265
TDARR_SERVER_PORT=8266
FLARESOLVERR_PORT=8191
EOF

chmod 600 "$ENV_PATH" 2>/dev/null || true
echo -e "${GREEN}[OK] .env configuration file generated${NC}"

# 7. Start Docker Compose Stack
echo -e "\n${CYAN}[*] Starting Null-seerr Media Stack...${NC}"
cd "$REPO_DIR"
$DOCKER_COMPOSE up -d --build "$@"

echo -e "\n${CYAN}[*] Waiting for background auto-wiring engine...${NC}"
sleep 15

# 8. Display Final Credentials
CRED_PATH="${STACK_ROOT}/CREDENTIALS.txt"
CONFIG_CRED_PATH="${STACK_ROOT}/config/CREDENTIALS.txt"
chmod 600 "$CRED_PATH" "$CONFIG_CRED_PATH" 2>/dev/null || true
PASSWORD="Check ${CRED_PATH}"

if [ -f "$CRED_PATH" ]; then
    PASSWORD=$(grep "^PASSWORD:" "$CRED_PATH" | cut -d':' -f2 | xargs || echo "Check ${CRED_PATH}")
elif [ -f "$CONFIG_CRED_PATH" ]; then
    PASSWORD=$(grep "^PASSWORD:" "$CONFIG_CRED_PATH" | cut -d':' -f2 | xargs || echo "Check ${CONFIG_CRED_PATH}")
    cp "$CONFIG_CRED_PATH" "$CRED_PATH" 2>/dev/null || true
fi

echo -e "\n${CYAN}=================================================================${NC}"
echo -e "${GREEN}✨ INSTALLATION & WIRING COMPLETE!${NC}"
echo -e "${CYAN}=================================================================${NC}"
echo -e "${WHITE}  Admin User:     admin${NC}"
echo -e "${WHITE}  Admin Email:    admin@nullseerr.local${NC}"
echo -e "${YELLOW}  Stack Password: ${PASSWORD}${NC}"
echo -e "${GRAY}  Saved in:       ${CRED_PATH}${NC}"
echo -e "${CYAN}=================================================================${NC}"
echo -e "${WHITE}  * Null-seerr Portal:   http://localhost:5055${NC}"
echo -e "${WHITE}  * Jellyfin Streaming:  http://localhost:8096${NC}"
echo -e "${WHITE}  * Plex Media Server:   http://localhost:32400/web${NC}"
echo -e "${WHITE}  * qBittorrent:         http://localhost:8089${NC}"
echo -e "${WHITE}  * Radarr (Movies):     http://localhost:7878${NC}"
echo -e "${WHITE}  * Sonarr (TV):         http://localhost:8989${NC}"
echo -e "${WHITE}  * Prowlarr:            http://localhost:9696${NC}"
echo -e "${WHITE}  * Bazarr (Subtitles):  http://localhost:6767${NC}"
echo -e "${CYAN}=================================================================${NC}"

# Open browser if graphical environment is available
if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "http://localhost:5055" >/dev/null 2>&1 &
    elif command -v sensible-browser >/dev/null 2>&1; then
        sensible-browser "http://localhost:5055" >/dev/null 2>&1 &
    fi
fi
