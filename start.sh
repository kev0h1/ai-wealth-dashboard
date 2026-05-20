#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

# Colours
R='\033[0;31m' G='\033[0;32m' B='\033[0;34m' Y='\033[1;33m' C='\033[0;36m' N='\033[0m' BOLD='\033[1m'

BACKEND_PID=""
BOT_PID=""

cleanup() {
  echo -e "\n${Y}Stopping services…${N}"
  [[ -n "$BACKEND_PID" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "$BOT_PID" ]]     && kill "$BOT_PID"     2>/dev/null || true
  wait 2>/dev/null || true
  echo -e "${G}Done.${N}"
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# ── helpers ──────────────────────────────────────────────────────────────────

log_backend() { while IFS= read -r line; do echo -e "${C}[API]${N} $line"; done; }
log_bot()     { while IFS= read -r line; do echo -e "${B}[BOT]${N} $line"; done; }

check_dep() {
  command -v "$1" &>/dev/null || { echo -e "${R}Error: '$1' not found.${N} $2"; exit 1; }
}

# ── pre-flight ────────────────────────────────────────────────────────────────

[[ -f "$BACKEND_DIR/.venv/bin/python" ]] || {
  echo -e "${Y}Python venv not found — creating…${N}"
  python3 -m venv "$BACKEND_DIR/.venv"
}

# Install/update dependencies
"$BACKEND_DIR/.venv/bin/pip" install -q \
  fastapi uvicorn httpx python-dotenv itsdangerous \
  "discord.py>=2.3" anthropic matplotlib numpy

# Ensure SESSION_SECRET is persisted
SECRETS_FILE="$BACKEND_DIR/.session_secret"
if [[ ! -f "$SECRETS_FILE" ]]; then
  python3 -c "import secrets; print(secrets.token_hex(32))" > "$SECRETS_FILE"
  echo -e "${G}Generated session secret → backend/.session_secret${N}"
fi

# ── banner ────────────────────────────────────────────────────────────────────

BACKEND_PORT=8000

echo ""
echo -e "${BOLD}╔════════════════════════════════════════╗${N}"
echo -e "${BOLD}║        AI Wealth Guide (Discord)       ║${N}"
echo -e "${BOLD}╚════════════════════════════════════════╝${N}"
echo ""
echo -e "  ${C}●${N} API       → ${BOLD}http://localhost:$BACKEND_PORT${N}"
echo -e "  ${B}●${N} Discord Bot → starting…"
echo ""
echo -e "  ${Y}Ctrl+C to stop both services${N}"
echo ""

# ── start backend ─────────────────────────────────────────────────────────────

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

# Wait for backend to be ready
sleep 3

# ── start Discord bot ─────────────────────────────────────────────────────────

(
  cd "$BACKEND_DIR"
  .venv/bin/python bot.py 2>&1 | log_bot
) &
BOT_PID=$!

# ── watch processes ───────────────────────────────────────────────────────────

wait_any() {
  while true; do
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      echo -e "\n${R}[API] Backend exited unexpectedly.${N}"
      cleanup
    fi
    if ! kill -0 "$BOT_PID" 2>/dev/null; then
      echo -e "\n${R}[BOT] Discord bot exited unexpectedly.${N}"
      cleanup
    fi
    sleep 2
  done
}

wait_any
