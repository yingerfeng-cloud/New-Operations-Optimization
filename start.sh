#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_ROOT="$ROOT/frontend"
LOG_DIR="$ROOT/logs"
API_PID_FILE="$LOG_DIR/.react-stack-api.pid"
FRONTEND_PID_FILE="$LOG_DIR/.react-stack-frontend.pid"
API_OUT_FILE="$LOG_DIR/react-stack-api.stdout.log"
API_ERR_FILE="$LOG_DIR/react-stack-api.stderr.log"
FRONTEND_OUT_FILE="$LOG_DIR/react-stack-frontend.stdout.log"
FRONTEND_ERR_FILE="$LOG_DIR/react-stack-frontend.stderr.log"

API_PORT="${API_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
NO_BROWSER="${NO_BROWSER:-0}"

usage() {
  cat <<'EOF'
Usage: ./start.sh [options]

Options:
  --api-port PORT       FastAPI port (default: 8000)
  --frontend-port PORT  Vite port (default: 5173)
  --no-browser          Do not open the browser automatically
  -h, --help            Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-port)
      [[ $# -ge 2 ]] || { echo "Missing value for --api-port" >&2; exit 2; }
      API_PORT="$2"
      shift 2
      ;;
    --frontend-port)
      [[ $# -ge 2 ]] || { echo "Missing value for --frontend-port" >&2; exit 2; }
      FRONTEND_PORT="$2"
      shift 2
      ;;
    --no-browser)
      NO_BROWSER="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

resolve_python() {
  if [[ -x "$ROOT/.venv-mac/bin/python" ]]; then
    printf '%s\n' "$ROOT/.venv-mac/bin/python"
  elif [[ -x "$ROOT/.venv/bin/python" ]]; then
    printf '%s\n' "$ROOT/.venv/bin/python"
  elif command -v python3 >/dev/null 2>&1; then
    command -v python3
  elif command -v python >/dev/null 2>&1; then
    command -v python
  else
    echo "Python 3 was not found. Create .venv with: python3 -m venv .venv" >&2
    exit 1
  fi
}

assert_path() {
  if [[ ! -e "$1" ]]; then
    echo "$2" >&2
    exit 1
  fi
}

port_owner() {
  lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

assert_port_available() {
  local port="$1"
  local name="$2"
  local owner
  owner="$(port_owner "$port")"
  if [[ -n "$owner" ]]; then
    echo "$name port $port is already in use by PID $owner. Run ./stop.sh or free the port." >&2
    exit 1
  fi
}

wait_for_backend() {
  local health_url="http://127.0.0.1:$API_PORT/api/health"
  local attempt
  for attempt in $(seq 1 30); do
    if ! kill -0 "$1" 2>/dev/null; then
      echo "Backend exited before becoming healthy. See $API_ERR_FILE" >&2
      tail -n 40 "$API_ERR_FILE" 2>/dev/null || true
      exit 1
    fi
    if curl --silent --show-error --fail --max-time 2 "$health_url" >/dev/null 2>&1; then
      if curl --silent --show-error --fail --max-time 2 "http://127.0.0.1:$API_PORT/api/agent/status" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
  done
  echo "Backend health check failed at $health_url. See $API_ERR_FILE" >&2
  tail -n 40 "$API_ERR_FILE" 2>/dev/null || true
  exit 1
}

wait_for_frontend() {
  local root_url="http://127.0.0.1:$FRONTEND_PORT/"
  local attempt
  local body
  for attempt in $(seq 1 30); do
    if ! kill -0 "$1" 2>/dev/null; then
      echo "Frontend exited before becoming ready. See $FRONTEND_ERR_FILE" >&2
      tail -n 40 "$FRONTEND_ERR_FILE" 2>/dev/null || true
      exit 1
    fi
    body="$(curl --silent --show-error --fail --max-time 2 "$root_url" 2>/dev/null || true)"
    if [[ "$body" == *'id="root"'* ]]; then
      return 0
    fi
    sleep 1
  done
  echo "Frontend readiness check failed at $root_url. See $FRONTEND_ERR_FILE" >&2
  tail -n 40 "$FRONTEND_ERR_FILE" 2>/dev/null || true
  exit 1
}

assert_path "$ROOT/server.py" "server.py was not found."
assert_path "$FRONTEND_ROOT/package.json" "frontend/package.json was not found."
assert_path "$FRONTEND_ROOT/node_modules" "frontend/node_modules was not found. Run: cd frontend && npm ci"
command -v node >/dev/null 2>&1 || { echo "node was not found. Install Node.js first." >&2; exit 1; }
NODE="$(command -v node)"
VITE_ENTRY="$FRONTEND_ROOT/node_modules/vite/bin/vite.js"
assert_path "$VITE_ENTRY" "Vite was not found. Run: cd frontend && npm ci"

mkdir -p "$LOG_DIR"
assert_port_available "$API_PORT" "Backend"
assert_port_available "$FRONTEND_PORT" "React/Vite frontend"

PYTHON="$(resolve_python)"

nohup bash -c 'cd "$1" && exec env SERVICE_MODE=combined PORT="$2" "$3" -u server.py' \
  _ "$ROOT" "$API_PORT" "$PYTHON" \
  >"$API_OUT_FILE" 2>"$API_ERR_FILE" < /dev/null &
API_PID=$!
printf '%s\n' "$API_PID" > "$API_PID_FILE"
echo "Backend started:  PID $API_PID  http://127.0.0.1:$API_PORT"

wait_for_backend "$API_PID"

nohup bash -c 'cd "$1" && exec env VITE_API_BASE_URL="$2" "$4" "$5" --host 127.0.0.1 --port "$3"' \
  _ "$FRONTEND_ROOT" "http://127.0.0.1:$API_PORT" "$FRONTEND_PORT" "$NODE" "$VITE_ENTRY" \
  >"$FRONTEND_OUT_FILE" 2>"$FRONTEND_ERR_FILE" < /dev/null &
FRONTEND_PID=$!
printf '%s\n' "$FRONTEND_PID" > "$FRONTEND_PID_FILE"
wait_for_frontend "$FRONTEND_PID"

echo "Frontend started: PID $FRONTEND_PID  http://127.0.0.1:$FRONTEND_PORT"
echo
echo "React app:   http://127.0.0.1:$FRONTEND_PORT/"
echo "Backend API: http://127.0.0.1:$API_PORT/api"
echo "Logs:        $LOG_DIR"

if [[ "$NO_BROWSER" != "1" ]] && command -v open >/dev/null 2>&1; then
  open "http://127.0.0.1:$FRONTEND_PORT/" >/dev/null 2>&1 || true
fi
