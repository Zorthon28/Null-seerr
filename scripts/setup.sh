#!/usr/bin/env bash
# =====================================================================
# Null-seerr All-In-One Media Stack 1-Click Bootstrap Installer (Linux)
# Wrapper targeting repo root setup.sh
# =====================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

exec bash "${REPO_DIR}/setup.sh" "$@"
