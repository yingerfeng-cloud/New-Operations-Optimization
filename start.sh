#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -x "$ROOT/.venv-mac/bin/python" ]]; then
  PYTHON="$ROOT/.venv-mac/bin/python"
elif [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON="$ROOT/.venv/bin/python"
else
  PYTHON="$(command -v python3 || command -v python)"
fi
exec "$PYTHON" "$ROOT/scripts/stack_lifecycle.py" start "$@"
