#!/usr/bin/env bash
set -euo pipefail

cd /app

echo "[optiforge] validating HiGHS and Ipopt runtime"
python scripts/check_nlp_solver.py

echo "[optiforge] starting API on 0.0.0.0:8000"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
