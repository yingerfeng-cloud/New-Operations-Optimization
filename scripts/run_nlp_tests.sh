#!/usr/bin/env bash
set -euo pipefail

python scripts/check_nlp_solver.py
REQUIRE_IPOPT=1 python -m pytest tests/test_nlp_environment.py tests/test_nlp_adapter.py tests/test_nonlinear_hydro_power_demo.py -q -s -rs
