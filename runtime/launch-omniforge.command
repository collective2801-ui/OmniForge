#!/bin/zsh
set -euo pipefail

ROOT="/Users/gorillaclan/Downloads/omniforge"
PORT="${OMNIFORGE_PORT:-3001}"
HOST="${OMNIFORGE_HOST:-127.0.0.1}"
HEALTH_URL="http://${HOST}:${PORT}/api/health"
APP_URL="http://${HOST}:${PORT}"
LOG_FILE="${ROOT}/logs/omniforge-server.log"
PID_FILE="${ROOT}/runtime/omniforge-server.pid"

mkdir -p "${ROOT}/logs" "${ROOT}/runtime"
cd "${ROOT}"

if [[ -f "${ROOT}/.env" ]]; then
  set -a
  source "${ROOT}/.env"
  set +a
fi

if [[ ! -d "${ROOT}/node_modules" ]]; then
  npm install >> "${LOG_FILE}" 2>&1
fi

server_running=0

if [[ -f "${PID_FILE}" ]]; then
  existing_pid="$(cat "${PID_FILE}")"

  if kill -0 "${existing_pid}" >/dev/null 2>&1; then
    server_running=1
  fi
fi

if [[ "${server_running}" -eq 1 ]]; then
  if ! curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
    server_running=0
  fi
fi

if [[ "${server_running}" -eq 0 ]]; then
  npm install >> "${LOG_FILE}" 2>&1
  npm run build:web >> "${LOG_FILE}" 2>&1
  osascript <<'APPLESCRIPT'
tell application "Terminal"
  activate
  do script "cd /Users/gorillaclan/Downloads/omniforge && /bin/zsh /Users/gorillaclan/Downloads/omniforge/runtime/run-omniforge-server.command"
end tell
APPLESCRIPT
fi

for _ in {1..60}; do
  if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
    open "${APP_URL}"
    exit 0
  fi

  sleep 1
done

osascript -e 'display alert "OmniForge did not finish starting." message "Check /Users/gorillaclan/Downloads/omniforge/logs/omniforge-server.log for details." as critical'
exit 1
