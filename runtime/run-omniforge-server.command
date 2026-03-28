#!/bin/zsh
set -euo pipefail

ROOT="/Users/gorillaclan/Downloads/omniforge"
PID_FILE="${ROOT}/runtime/omniforge-server.pid"
LOG_FILE="${ROOT}/logs/omniforge-server.log"

mkdir -p "${ROOT}/runtime" "${ROOT}/logs"
cd "${ROOT}"

if [[ -f "${ROOT}/.env" ]]; then
  set -a
  source "${ROOT}/.env"
  set +a
fi

trap 'rm -f "${PID_FILE}"' EXIT

echo $$ > "${PID_FILE}"
node runtime/omniforgeServer.js 2>&1 | tee -a "${LOG_FILE}"
