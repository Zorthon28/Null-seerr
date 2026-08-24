#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Stopping Production Arr Stack..."
if docker compose version >/dev/null 2>&1; then
    docker compose -f "${SCRIPT_DIR}/docker-compose.yml" down
else
    docker-compose -f "${SCRIPT_DIR}/docker-compose.yml" down
fi
echo "Production Stack Stopped."
