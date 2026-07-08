from __future__ import annotations

import importlib.metadata
import shutil
import subprocess
import sys
from typing import Any

import pyomo.environ as pyo


IPOPT_UNAVAILABLE_MESSAGE = "Ipopt executable not found. NLP solving is unavailable."


def _package_version(package: str) -> str | None:
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return None


def _solver_available(name: str) -> bool:
    try:
        return bool(pyo.SolverFactory(name).available(False))
    except Exception:
        return False


def _ipopt_version(ipopt_path: str | None) -> str | None:
    if not ipopt_path:
        return None
    try:
        completed = subprocess.run(
            [ipopt_path, "--version"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception:
        return None
    output = (completed.stdout or completed.stderr or "").strip()
    return output.splitlines()[0] if output else None


def solver_status() -> dict[str, Any]:
    try:
        import highspy  # noqa: F401

        highspy_available = True
    except Exception:
        highspy_available = False

    ipopt_path = shutil.which("ipopt")
    pyomo_ipopt_available = _solver_available("ipopt")
    ipopt_available = bool(ipopt_path and pyomo_ipopt_available)
    ipopt_message = None if ipopt_available else IPOPT_UNAVAILABLE_MESSAGE

    return {
        "python": sys.version.split()[0],
        "highspy_available": highspy_available,
        "highs": {
            "available": highspy_available and _solver_available("appsi_highs"),
            "version": _package_version("highspy"),
        },
        "ipopt": {
            "available": ipopt_available,
            "path": ipopt_path,
            "version": _ipopt_version(ipopt_path),
            "pyomo_available": pyomo_ipopt_available,
            "message": ipopt_message,
        },
        "status": "OK" if ipopt_available else "FAILED",
        "message": ipopt_message,
    }
