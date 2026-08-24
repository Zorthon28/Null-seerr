#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Starting Production Arr Stack..."
if docker compose version >/dev/null 2>&1; then
    docker compose -f "${SCRIPT_DIR}/docker-compose.yml" up -d
else
    docker-compose -f "${SCRIPT_DIR}/docker-compose.yml" up -d
fi
echo "Production Stack Started! Access Null-seerr at http://localhost:5055"
