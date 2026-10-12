#!/usr/bin/env bash
# ==============================================================================
# Null-seerr All-In-One Media Stack Interactive Setup Wizard (Linux / macOS)
# ==============================================================================

set -e

CYAN='\033[0;36m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
WHITE='\033[1;37m'
GRAY='\033[0;90m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

clear 2>/dev/null || true
echo -e "${CYAN}=================================================================${NC}"
echo -e "${YELLOW}      NULL-SEERR ALL-IN-ONE MEDIA AUTOMATION SETUP WIZARD        ${NC}"
echo -e "${CYAN}=================================================================${NC}"
echo ""

# 1. Pre-flight Check: Docker
echo -e "${WHITE}[1/6] Checking Docker Engine...${NC}"
if ! command -v docker >/dev/null 2>&1; then
    echo -e "${RED} [!] Docker executable not found in PATH.${NC}"
    echo -e "${YELLOW}     Please install Docker: https://docs.docker.com/engine/install/${NC}"
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo -e "${RED} [!] Docker daemon is not running or current user lacks docker group permission.${NC}"
    echo -e "${YELLOW}     Try: sudo systemctl start docker${NC}"
    echo -e "${YELLOW}     Or: sudo usermod -aG docker \$USER && newgrp docker${NC}"
    exit 1
fi

if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
else
    echo -e "${RED} [!] Docker Compose not found.${NC}"
    exit 1
fi
echo -e "${GREEN} [+] Docker Engine & Compose are active and ready.${NC}"

# 2. Pre-flight Check: Python
echo -e "${WHITE}[2/6] Checking Python 3...${NC}"
if command -v python3 >/dev/null 2>&1; then
    PY_VER=$(python3 --version)
    echo -e "${GREEN} [+] Python detected: ${PY_VER}${NC}"
    PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
    PY_VER=$(python --version)
    echo -e "${GREEN} [+] Python detected: ${PY_VER}${NC}"
    PYTHON_CMD="python"
else
    echo -e "${YELLOW} [!] Python 3 not found on host. Host scripts will use Dockerized engine.${NC}"
    PYTHON_CMD=""
fi

# 3. Directory Configuration & Stack File Provisioning
echo -e "\n${WHITE}[3/6] Setting Up Environment & Directories...${NC}"
DEFAULT_ROOT="${HOME}/arr-stack"
read -r -p " Enter installation directory [Default: ${DEFAULT_ROOT}]: " CUSTOM_ROOT
CUSTOM_ROOT="${CUSTOM_ROOT:-$DEFAULT_ROOT}"

# Expand tilde if provided
CUSTOM_ROOT="${CUSTOM_ROOT/#\~/$HOME}"

DIRS=(
    "${CUSTOM_ROOT}/config/overseerr"
    "${CUSTOM_ROOT}/config/plex"
    "${CUSTOM_ROOT}/config/jellyfin"
    "${CUSTOM_ROOT}/config/prowlarr"
    "${CUSTOM_ROOT}/config/qbittorrent"
    "${CUSTOM_ROOT}/config/radarr"
    "${CUSTOM_ROOT}/config/sonarr"
    "${CUSTOM_ROOT}/config/bazarr"
    "${CUSTOM_ROOT}/config/suggestarr"
    "${CUSTOM_ROOT}/config/shoko"
    "${CUSTOM_ROOT}/config/tdarr/server"
    "${CUSTOM_ROOT}/config/tdarr/configs"
    "${CUSTOM_ROOT}/config/tdarr/logs"
    "${CUSTOM_ROOT}/config/autobrr"
    "${CUSTOM_ROOT}/data/media/movies"
    "${CUSTOM_ROOT}/data/media/tv"
    "${CUSTOM_ROOT}/data/media/anime"
    "${CUSTOM_ROOT}/data/torrents/movies"
    "${CUSTOM_ROOT}/data/torrents/tv"
    "${CUSTOM_ROOT}/data/torrents/anime"
    "${CUSTOM_ROOT}/data/transcode_cache"
)

for d in "${DIRS[@]}"; do
    mkdir -p "$d"
done

# Set secure directory permissions
find "${CUSTOM_ROOT}" -type d -exec chmod 750 {} + 2>/dev/null || true
find "${CUSTOM_ROOT}/data" -type d -exec chmod 775 {} + 2>/dev/null || true
echo -e "${GREEN} [+] All directories created & verified.${NC}"

# Copy docker-compose.yml into target folder
if [ -f "${REPO_DIR}/docker-compose.yml" ]; then
    cp "${REPO_DIR}/docker-compose.yml" "${CUSTOM_ROOT}/docker-compose.yml"
fi

# Copy scripts into target folder
if [ -f "${REPO_DIR}/scripts/wire_stack.py" ]; then
    cp "${REPO_DIR}/scripts/wire_stack.py" "${CUSTOM_ROOT}/wire_stack.py"
fi
if [ -f "${REPO_DIR}/scripts/boxarr.py" ]; then
    cp "${REPO_DIR}/scripts/boxarr.py" "${CUSTOM_ROOT}/boxarr.py"
fi

# Copy templates if present
if [ -d "${REPO_DIR}/templates" ]; then
    cp -rn "${REPO_DIR}/templates" "${CUSTOM_ROOT}/" 2>/dev/null || true
fi

# Master Authentication Setup
echo -e "\n${WHITE} Master Authentication Setup:${NC}"
ENV_FILE="${CUSTOM_ROOT}/.env"
EXISTING_MASTER=""
if [ -f "$ENV_FILE" ]; then
    EXISTING_MASTER=$(grep "^MASTER_PASSWORD=" "$ENV_FILE" | cut -d'=' -f2 | xargs || true)
fi

if [ -n "$EXISTING_MASTER" ]; then
    echo -e "  ${GREEN}[+] Found existing Master Password in .env${NC}"
    MASTER_PASSWORD="$EXISTING_MASTER"
else
    echo -ne "  ${WHITE}Enter Master Password for admin account (Press Enter for auto-generated): ${NC}"
    read -r USER_PASS || true
    if [ -z "$USER_PASS" ]; then
        MASTER_PASSWORD=$(LC_ALL=C tr -dc 'a-zA-Z0-9!@#$' < /dev/urandom | head -c 16 || openssl rand -hex 8)
        echo -e "  ${YELLOW}[+] Auto-generated secure Master Password: ${MASTER_PASSWORD}${NC}"
    else
        MASTER_PASSWORD="$USER_PASS"
        echo -e "  ${GREEN}[+] Using provided Master Password for all stack services.${NC}"
    fi
fi
export MASTER_PASSWORD

if [ ! -f "$ENV_FILE" ]; then
    HOST_PUID=$(id -u)
    HOST_PGID=$(id -g)
    cat <<EOF > "$ENV_FILE"
# Generated by Null-seerr Interactive Wizard
MASTER_PASSWORD=${MASTER_PASSWORD}
STACK_ROOT=${CUSTOM_ROOT}
CONFIG_ROOT=${CUSTOM_ROOT}/config
DATA_ROOT=${CUSTOM_ROOT}/data
MEDIA_ROOT=${CUSTOM_ROOT}/data/media
TV_DIR=${CUSTOM_ROOT}/data/media/tv
TRANSCODE_CACHE=${CUSTOM_ROOT}/data/transcode_cache
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
    chmod 600 "$ENV_FILE" 2>/dev/null || true
    echo -e "${GREEN} [+] Created .env configuration in ${CUSTOM_ROOT}.${NC}"
else
    if ! grep -q "^MASTER_PASSWORD=" "$ENV_FILE"; then
        echo "MASTER_PASSWORD=${MASTER_PASSWORD}" >> "$ENV_FILE"
    fi
fi

# Create shell helper scripts in target folder
cat <<'EOF' > "${CUSTOM_ROOT}/start-stack.sh"
#!/usr/bin/env bash
cd "$(dirname "${BASH_SOURCE[0]}")"
echo "Starting Null-seerr Media Stack..."
if docker compose version >/dev/null 2>&1; then
    docker compose up -d
else
    docker-compose up -d
fi
EOF

cat <<'EOF' > "${CUSTOM_ROOT}/stop-stack.sh"
#!/usr/bin/env bash
cd "$(dirname "${BASH_SOURCE[0]}")"
echo "Stopping Null-seerr Media Stack..."
if docker compose version >/dev/null 2>&1; then
    docker compose down
else
    docker-compose down
fi
EOF

cat <<'EOF' > "${CUSTOM_ROOT}/wire-stack.sh"
#!/usr/bin/env bash
cd "$(dirname "${BASH_SOURCE[0]}")"
echo "Auto-Wiring Null-seerr Media Stack..."
if [ -f "./wire_stack.py" ] && command -v python3 >/dev/null 2>&1; then
    python3 ./wire_stack.py
else
    docker compose run --rm nullseerr-init
fi
EOF

cat <<'EOF' > "${CUSTOM_ROOT}/run-boxarr.sh"
#!/usr/bin/env bash
cd "$(dirname "${BASH_SOURCE[0]}")"
echo "Running Boxarr Autopilot Sync..."
if [ -f "./boxarr.py" ] && command -v python3 >/dev/null 2>&1; then
    python3 ./boxarr.py
fi
EOF

chmod +x "${CUSTOM_ROOT}"/*.sh 2>/dev/null || true

# 4. Launch Stack
echo -e "\n${WHITE}[4/6] Starting Media Automation Stack...${NC}"
cd "$CUSTOM_ROOT"
$DOCKER_COMPOSE up -d
echo -e "${GREEN} [+] Containers launched successfully!${NC}"

# 5. Service Liveness Check & Auto-Wiring
echo -e "\n${WHITE}[5/6] Waiting for Null-seerr Portal and media engine to be ready...${NC}"
READY_TIMEOUT=45
IS_READY=0
while [ $READY_TIMEOUT -gt 0 ]; do
    echo -n "."
    if curl -s -f -m 2 http://localhost:5055/api/v1/status >/dev/null 2>&1; then
        IS_READY=1
        echo ""
        break
    fi
    sleep 2
    READY_TIMEOUT=$(( READY_TIMEOUT - 2 ))
done

if [ $IS_READY -eq 1 ]; then
    echo -e "${GREEN} [+] Null-seerr portal is live and ready!${NC}"
else
    echo -e "\n${YELLOW} [!] Services are still booting in background...${NC}"
fi

echo -e "${YELLOW} Running Auto-Wiring CLI...${NC}"
if [ -n "$PYTHON_CMD" ] && [ -f "${CUSTOM_ROOT}/wire_stack.py" ]; then
    $PYTHON_CMD "${CUSTOM_ROOT}/wire_stack.py" || true
else
    $DOCKER_COMPOSE run --rm nullseerr-init || true
fi

# 6. Run Boxarr Sync
echo -e "\n${WHITE}[6/6] Syncing Initial Box Office & Popular Movies...${NC}"
if [ -n "$PYTHON_CMD" ] && [ -f "${CUSTOM_ROOT}/boxarr.py" ]; then
    $PYTHON_CMD "${CUSTOM_ROOT}/boxarr.py" || true
fi

# Read generated credentials
CRED_FILE="${CUSTOM_ROOT}/CREDENTIALS.txt"
CONFIG_CRED_FILE="${CUSTOM_ROOT}/config/CREDENTIALS.txt"
ADMIN_USER="admin"
ADMIN_EMAIL="admin@nullseerr.local"
ADMIN_PASS="${MASTER_PASSWORD}"

if [ -f "$CRED_FILE" ]; then
    while IFS= read -r line; do
        [[ "$line" =~ ^USER:\ *(.*) ]] && ADMIN_USER="${BASH_REMATCH[1]}"
        [[ "$line" =~ ^EMAIL:\ *(.*) ]] && ADMIN_EMAIL="${BASH_REMATCH[1]}"
        [[ "$line" =~ ^PASSWORD:\ *(.*) ]] && ADMIN_PASS="${BASH_REMATCH[1]}"
    done < "$CRED_FILE"
elif [ -f "$CONFIG_CRED_FILE" ]; then
    while IFS= read -r line; do
        [[ "$line" =~ ^USER:\ *(.*) ]] && ADMIN_USER="${BASH_REMATCH[1]}"
        [[ "$line" =~ ^EMAIL:\ *(.*) ]] && ADMIN_EMAIL="${BASH_REMATCH[1]}"
        [[ "$line" =~ ^PASSWORD:\ *(.*) ]] && ADMIN_PASS="${BASH_REMATCH[1]}"
    done < "$CONFIG_CRED_FILE"
    cp "$CONFIG_CRED_FILE" "$CRED_FILE" 2>/dev/null || true
fi
chmod 600 "$CRED_FILE" "$CONFIG_CRED_FILE" 2>/dev/null || true

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

# Open Null-seerr in default browser if desktop session active
if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "http://localhost:5055" >/dev/null 2>&1 &
    elif command -v sensible-browser >/dev/null 2>&1; then
        sensible-browser "http://localhost:5055" >/dev/null 2>&1 &
    fi
fi

echo -e "\n${CYAN}=================================================================${NC}"
echo -e "${GREEN}          NULL-SEERR MEDIA STACK IS ONLINE & READY!              ${NC}"
echo -e "${CYAN}=================================================================${NC}"
echo -e "${YELLOW}  🔑 ADMIN USERNAME:          ${ADMIN_USER}${NC}"
echo -e "${YELLOW}  📧 ADMIN EMAIL:             ${ADMIN_EMAIL}${NC}"
echo -e "${YELLOW}  🔒 MASTER PASSWORD:         ${ADMIN_PASS}${NC}"
echo -e "${CYAN}  📁 Saved in:                ${CRED_FILE}${NC}"
echo -e "${GRAY}-----------------------------------------------------------------${NC}"
echo -e "${YELLOW}  Local Machine Access:${NC}"
echo -e "${WHITE}    * Null-seerr Portal:   http://localhost:5055${NC}"
echo -e "${WHITE}    * Jellyfin Streaming:  http://localhost:8096${NC}"
echo -e "${WHITE}    * Plex Media Server:   http://localhost:32400/web${NC}"
echo -e "${WHITE}    * Radarr (Movies):     http://localhost:7878${NC}"
echo -e "${WHITE}    * Sonarr (TV):         http://localhost:8989${NC}"
echo -e "${WHITE}    * Prowlarr (Indexers): http://localhost:9696${NC}"
echo -e "${WHITE}    * qBittorrent:         http://localhost:8089${NC}"
echo -e "${WHITE}    * Tdarr Transcoder:    http://localhost:8265${NC}"
echo -e "${WHITE}    * Shoko Anime DB:      http://localhost:8111${NC}"
if [ -n "$LAN_IP" ] && [ "$LAN_IP" != "127.0.0.1" ]; then
    echo -e "\n${YELLOW}  TV & Mobile Access (From devices on same local network):${NC}"
    echo -e "${CYAN}    * Streaming Server:    http://${LAN_IP}:8096${NC}"
    echo -e "${CYAN}    * Null-seerr Portal:   http://${LAN_IP}:5055${NC}"
    echo -e "${GRAY}    * Living Room Guide:   See TV_SETUP_GUIDE.md${NC}"
fi
echo -e "${CYAN}=================================================================${NC}"
echo ""
