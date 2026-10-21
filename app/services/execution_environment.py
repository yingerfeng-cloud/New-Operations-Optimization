"""Observed execution identity, not a promise to restore an unavailable image."""
import hashlib
import importlib.metadata
import inspect
import marshal
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import types

from app.services.component_dependencies import digest

ROOT = Path(__file__).resolve().parents[2]


def loaded_code_hashes():
    """Hash code objects actually loaded, even if someone edits a file in place."""
    result = {}
    for name, module in sorted(list(sys.modules.items())):
        if not name.startswith("app.") or module is None:
            continue
        for key, item in list(vars(module).items()):
            if getattr(item, "__module__", None) != name:
                continue
            members = vars(item).items() if isinstance(item, type) else [(key, item)]
            for member_name, member in members:
                if isinstance(member, (classmethod, staticmethod)):
                    member = member.__func__
                if isinstance(member, types.FunctionType):
                    result[f"{name}.{key}.{member_name}"] = hashlib.sha256(marshal.dumps(member.__code__)).hexdigest()
    return result


def file_hash(path):
    try:
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    except (OSError, TypeError):
        return "unknown"


def _version(package):
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def execution_environment(request, solver=None):
    from app.model_components.registry import COMPONENT_REGISTRY
    from app.utils import now_text
    sources = {str(path.relative_to(ROOT)): file_hash(path) for path in sorted((ROOT / "app").rglob("*.py")) if "__pycache__" not in path.parts}
    loaded = loaded_code_hashes()
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, stderr=subprocess.DEVNULL, text=True, timeout=2).strip()
        dirty = bool(subprocess.check_output(["git", "status", "--porcelain", "--", "app", "requirements.txt"], cwd=ROOT, stderr=subprocess.DEVNULL, text=True, timeout=2).strip())
    except (OSError, subprocess.SubprocessError):
        commit, dirty = "unknown", "unknown"
    assets = (request.payload.get("_component_dependencies") or {}).get("assets") or {}
    implementations = {}
    for identifier in assets:
        builder = COMPONENT_REGISTRY.get(identifier)
        if builder is not None:
            try:
                implementations[identifier] = {"class": f"{type(builder).__module__}.{type(builder).__qualname__}",
                    "source_hash": hashlib.sha256(inspect.getsource(type(builder)).encode()).hexdigest(),
                    "module_hash": file_hash(inspect.getfile(type(builder)))}
            except (OSError, TypeError):
                implementations[identifier] = {"source_hash": "unknown", "module_hash": "unknown"}
    actual_solver = solver or request.solver
    executable = shutil.which("ipopt") if str(actual_solver).lower() == "ipopt" else None
    solver_version = _version("highspy") if str(actual_solver).lower() == "highs" else "unknown"
    if executable:
        try:
            solver_version = subprocess.check_output([executable, "-v"], stderr=subprocess.STDOUT, text=True, timeout=2).strip()
        except (OSError, subprocess.SubprocessError):
            pass
    requested_settings = {"time_limit_seconds": request.time_limit_seconds, "mip_gap": request.mip_gap,
        "threads": request.thread_num, "presolve": request.presolve, **request.solver_config}
    effective = {}
    binary_hash = file_hash(executable)
    if str(actual_solver).lower() == "highs":
        import highspy._core
        binary_hash = file_hash(highspy._core.__file__)
        effective = {"time_limit": float(request.time_limit_seconds), "mip_rel_gap": float(request.mip_gap),
            "threads": request.thread_num or "solver_default", "presolve": "solver_default; adapter does not override"}
    elif str(actual_solver).lower() == "ipopt":
        from app.solvers.nlp_adapter import DEFAULT_NLP_TOLERANCE
        tolerance = request.solver_config.get("nlp_tolerance", request.solver_config.get("tol"))
        tolerance = max(float(tolerance if tolerance is not None else DEFAULT_NLP_TOLERANCE), 1e-12)
        acceptable = request.solver_config.get("acceptable_tol")
        effective = {"max_cpu_time": float(request.time_limit_seconds), "tol": tolerance, "constr_viol_tol": tolerance,
            "max_iter": request.solver_config.get("max_iter") or "solver_default",
            "acceptable_tol": max(float(acceptable), 1e-12) if acceptable is not None else "solver_default",
            "acceptable_constr_viol_tol": max(float(acceptable), 1e-12) if acceptable is not None else "solver_default"}
    identity = {
        "platform_source_hash": digest(sources),
        "loaded_code_hash": digest(loaded),
        "loaded_adapter_hashes": {key: value for key, value in loaded.items() if key.startswith("app.solvers.")},
        "source_hash_scope": "磁盘源码与已加载 Python code object 分别记录；二者不冒充旧镜像证明。",
        "image_digest": "unknown",  # No registry/engine attestation is available inside this process.
        "python": platform.python_version(), "system": platform.system(), "machine": platform.machine(),
        "packages": {name: _version(name) for name in ("pyomo", "highspy", "numpy", "scipy")},
        "compiler_hashes": {name: sources.get(name, "unknown") for name in (
            "app/generic_formula_compiler.py", "app/model_components/formula_components.py", "app/builders/component_model_builder.py", "app/function_strategy.py")},
        "builtin_implementations": implementations,
        "solver": {"name": actual_solver, "version": solver_version, "executable_hash": file_hash(executable),
                   "binary_hash": binary_hash,
                   "adapter_hash": sources.get("app/solvers/nlp_adapter.py" if str(actual_solver).lower() == "ipopt" else "app/solvers/highs_adapter.py", "unknown")},
        "requested_settings": requested_settings, "effective_settings": effective,
        "initial_values": request.solver_config.get("initial_values") or {},
        "numeric_environment": {name: os.getenv(name, "unknown") for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS")},
    }
    return {"schema_version": 1, "observed_at": now_text(), "platform_commit": commit, "working_tree_modified": dirty,
            "identity": identity, "identity_hash": digest(identity),
            "image_note": "当前进程无法可信取得镜像 digest，未用可随意填写的环境变量冒充镜像证明。",
            "replay_note": "清单记录实际代码和数值环境；不提供旧环境，也不承诺跨环境逐字节一致。"}


def replay_boundary(original, request, mode):
    from fastapi import HTTPException
    if mode not in {"current_kernel", "original_environment"}:
        raise HTTPException(status_code=422, detail="replay mode must be current_kernel or original_environment")
    current = execution_environment(request, request.solver)
    if mode == "original_environment":
        # This delivery records provenance, but deliberately does not introduce
        # an image restoration/execution platform. Matching hashes alone are not it.
        raise HTTPException(status_code=409, detail={"code": "ORIGINAL_ENVIRONMENT_UNAVAILABLE",
            "message": "本部署未提供原环境恢复能力；可选择当前内核按历史输入重新计算，不能宣称严格历史复现。",
            "recorded_identity_hash": (original or {}).get("identity_hash", "unknown"), "current_identity_hash": current["identity_hash"]})
    return {"mode": mode, "source_identity_hash": (original or {}).get("identity_hash", "unknown"),
            "message": "当前内核按历史冻结定义与输入重新计算；原结果保留。这不是原环境历史重放。"}
