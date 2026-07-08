from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.solvers.status import solver_status  # noqa: E402


def _print_bool(key: str, value: bool) -> None:
    print(f"{key}: {str(bool(value)).lower()}")


def main() -> int:
    status = solver_status()
    ipopt = status["ipopt"]
    highs = status["highs"]

    print("NLP_SOLVER_CHECK")
    print(f"python: {status['python']}")
    _print_bool("highspy_available", status["highspy_available"])
    _print_bool("highs_available", highs["available"])
    print(f"highs_version: {highs.get('version')}")
    print(f"ipopt_path: {ipopt.get('path')}")
    _print_bool("ipopt_available", ipopt["available"])
    print(f"ipopt_version: {ipopt.get('version')}")
    _print_bool("pyomo_ipopt_available", ipopt["pyomo_available"])
    print(f"status: {status['status']}")
    if status.get("message"):
        print(f"message: {status['message']}")
    return 0 if status["status"] == "OK" else 1


if __name__ == "__main__":
    raise SystemExit(main())
