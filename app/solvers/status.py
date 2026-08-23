from __future__ import annotations

import importlib.metadata
import shutil
import subprocess
import sys
from typing import Any

import pyomo.environ as pyo


IPOPT_UNAVAILABLE_MESSAGE = "Ipopt executable not found. NLP solving is unavailable."


def ipopt_unavailable_explanation(domain_label: str | None = None) -> str:
    subject = f"非线性{domain_label}模型" if domain_label else "非线性模型"
    return (
        f"本次{subject}未完成求解，原因是 NLP 求解器 Ipopt 不可用，平台未启用替代求解器。"
        "当前结果不是有效优化方案。请安装 Ipopt，或切换为线性化 / 分段线性近似模型后重试。"
    )


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
