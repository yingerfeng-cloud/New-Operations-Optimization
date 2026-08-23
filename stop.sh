#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT/logs"

stop_tree() {
  local pid="$1"
  local child
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  kill -0 "$pid" 2>/dev/null || return 0

  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    stop_tree "$child"
  done

  kill -TERM "$pid" 2>/dev/null || true
}

stop_from_pid_file() {
  local pid_file="$1"
  local pid
  [[ -f "$pid_file" ]] || return 1
  # PowerShell may have written the PID as UTF-8 with a BOM. Strip it so
  # stale Windows-generated PID files can be handled safely on macOS.
  pid="$(tr -d '[:space:]' < "$pid_file")"
  case "$pid" in
    $'\357\273\277'*) pid="${pid:3}" ;;
  esac
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    stop_tree "$pid"
    echo "Stopped process tree PID $pid"
  fi
  rm -f "$pid_file"
  return 0
}

stopped_any=0
if stop_from_pid_file "$LOG_DIR/.react-stack-api.pid"; then stopped_any=1; fi
if stop_from_pid_file "$LOG_DIR/.react-stack-frontend.pid"; then stopped_any=1; fi
if stop_from_pid_file "$LOG_DIR/.platform-api.pid"; then stopped_any=1; fi
if stop_from_pid_file "$LOG_DIR/.platform-frontend.pid"; then stopped_any=1; fi

sleep 0.5

if [[ "$stopped_any" == "1" ]]; then
  echo "React frontend and backend services stopped."
else
  echo "React frontend and backend services were not running."
fi
