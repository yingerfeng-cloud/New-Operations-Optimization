#!/usr/bin/env bash
set -euo pipefail

cd /app

echo "[optiforge] preparing persistent Agent Skills"
agent_skills_dir="${OPTIFORGE_AGENT_SKILLS_DIR:-/app/data/agent_skills}"
mkdir -p "$agent_skills_dir"
for source_dir in /app/agent_skills/*; do
  if [ -d "$source_dir" ]; then
    target_dir="$agent_skills_dir/$(basename "$source_dir")"
    if [ ! -e "$target_dir" ]; then
      cp -a "$source_dir" "$target_dir"
    fi
  fi
done
export OPTIFORGE_AGENT_SKILLS_DIR="$agent_skills_dir"

echo "[optiforge] validating HiGHS and Ipopt runtime"
python scripts/check_nlp_solver.py

echo "[optiforge] starting API on 0.0.0.0:8000"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
