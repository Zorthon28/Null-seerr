#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Building and Starting Development Arr Stack..."
if docker compose version >/dev/null 2>&1; then
    docker compose -f "${SCRIPT_DIR}/docker-compose.dev.yml" up -d --build
else
    docker-compose -f "${SCRIPT_DIR}/docker-compose.dev.yml" up -d --build
fi
echo "Development Stack Started! Access Null-seerr-dev at http://localhost:5056"
