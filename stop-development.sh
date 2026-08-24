#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Stopping Development Arr Stack..."
if docker compose version >/dev/null 2>&1; then
    docker compose -f "${SCRIPT_DIR}/docker-compose.dev.yml" down
else
    docker-compose -f "${SCRIPT_DIR}/docker-compose.dev.yml" down
fi
echo "Development Stack Stopped."
