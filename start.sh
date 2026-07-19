#!/usr/bin/env bash
# Dev runner for the API. In production the services run under systemd
# (wealth-api, wealth-worker, wealth-frontend).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

# Colours
R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m' C='\033[0;36m' N='\033[0m' BOLD='\033[1m'

BACKEND_PID=""

cleanup() {
  echo -e "\n${Y}Stopping…${N}"
  [[ -n "$BACKEND_PID" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo -e "${G}Done.${N}"
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

log_backend() { while IFS= read -r line; do echo -e "${C}[API]${N} $line"; done; }

# ── pre-flight ────────────────────────────────────────────────────────────────

[[ -f "$BACKEND_DIR/.venv/bin/python" ]] || {
  echo -e "${Y}Python venv not found — creating…${N}"
  python3 -m venv "$BACKEND_DIR/.venv"
}

# Ensure SESSION_SECRET is persisted
SECRETS_FILE="$BACKEND_DIR/.session_secret"
if [[ ! -f "$SECRETS_FILE" ]]; then
  python3 -c "import secrets; print(secrets.token_hex(32))" > "$SECRETS_FILE"
  echo -e "${G}Generated session secret → backend/.session_secret${N}"
fi

# ── run ───────────────────────────────────────────────────────────────────────

BACKEND_PORT=8000

echo ""
echo -e "${BOLD}AI Wealth Dashboard — dev API${N}"
echo -e "  ${C}●${N} API → ${BOLD}http://localhost:$BACKEND_PORT${N}"
echo -e "  ${Y}Ctrl+C to stop${N}"
echo ""

(
  cd "$BACKEND_DIR"
  .venv/bin/uvicorn main:app \
    --host 0.0.0.0 \
    --port "$BACKEND_PORT" \
    --reload \
    --reload-dir . \
    --log-level warning 2>&1 | log_backend
) &
BACKEND_PID=$!

wait "$BACKEND_PID"
