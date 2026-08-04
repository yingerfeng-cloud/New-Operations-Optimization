from __future__ import annotations

import math
import time
from typing import Any

from app.schemas.result import SolverRunResult
from app.solvers.base import SolverProgressCallback


class HiGHSAdapter:
    name = "HiGHS"
    supported_problem_types = ["LP", "MILP", "QP", "MIQP"]

    def available(self) -> bool:
        import pyomo.environ as pyo

        return bool(pyo.SolverFactory("appsi_highs").available(False))

    def solve(
        self,
        model: Any,
        *,
        mip_gap: float = 0.001,
        time_limit_seconds: int = 300,
        threads: int | None = None,
        progress_callback: SolverProgressCallback | None = None,
    ) -> SolverRunResult:
        import pyomo.environ as pyo

        solver = pyo.SolverFactory("appsi_highs")
        if not self.available():
            raise RuntimeError("Pyomo appsi_highs solver is not available. Ensure pyomo and highspy are installed.")
        solver.options["time_limit"] = float(time_limit_seconds)
        solver.options["mip_rel_gap"] = float(mip_gap)
        if threads:
            solver.options["threads"] = int(threads)

        progress_context: dict[str, Any] | None = None
        if progress_callback is not None:
            progress_context = self._configure_progress_callback(solver, model, progress_callback)

        started = time.monotonic()
        result = solver.solve(model, load_solutions=False)
        solve_time = time.monotonic() - started
        termination = str(result.solver.termination_condition)
        termination_lower = termination.lower()
        lower_bound = getattr(result.problem, "lower_bound", None)
        upper_bound = getattr(result.problem, "upper_bound", None)
        actual_mip_gap = None
        if isinstance(lower_bound, (int, float)) and isinstance(upper_bound, (int, float)):
            actual_mip_gap = abs(float(upper_bound) - float(lower_bound)) / max(1.0, abs(float(upper_bound)))
        status = "optimal" if "optimal" in termination_lower else "infeasible" if "infeasible" in termination_lower else "failed"
        if status != "infeasible":
            try:
                model.solutions.load_from(result)
                if status == "failed" and "time" in termination_lower:
                    status = "feasible"
            except Exception:
                pass
        objective_value = None
        if status in {"optimal", "feasible"} and hasattr(model, "objective"):
            objective_value = float(pyo.value(model.objective))
        if progress_callback is not None and progress_context is not None:
            self._emit_lp_iteration_summary(
                progress_callback,
                progress_context,
                elapsed_seconds=solve_time,
            )
        return SolverRunResult(
            status=status,
            objective_value=objective_value,
            solve_time=round(solve_time, 4),
            mip_gap=None if actual_mip_gap is None else round(actual_mip_gap, 8),
            variable_values=self._extract_variables(model),
            solver_log=f"HiGHS termination_condition={termination}",
            raw_termination_condition=termination,
            termination_condition=termination,
            solver_name=self.name,
            solver_type="MILP" if any(var.is_binary() or var.is_integer() for component in model.component_objects(pyo.Var, active=True) for var in component.values()) else "LP",
            solver_available=True,
            message="模型不可行，请检查硬负荷目标、库容边界、生态流量和函数资产定义域。" if status == "infeasible" else "",
        )

    def _configure_progress_callback(
        self,
        solver: Any,
        model: Any,
        callback: SolverProgressCallback,
    ) -> dict[str, Any] | None:
        import pyomo.environ as pyo

        is_mip = any(
            var.is_binary() or var.is_integer()
            for component in model.component_objects(pyo.Var, active=True)
            for var in component.values()
        )
        try:
            import highspy

            solver.set_instance(model)
            raw_solver = solver._solver_model
            callback_types = highspy.cb.HighsCallbackType

            if is_mip:
                improving_type = int(callback_types.kCallbackMipImprovingSolution)
                logging_type = int(callback_types.kCallbackMipLogging)

                def highs_callback(callback_type: Any, message: str, data_out: Any, _data_in: Any, _user_data: Any) -> None:
                    try:
                        normalized_type = int(callback_type)
                        if normalized_type not in {improving_type, logging_type}:
                            return
                        callback({
                            "kind": "incumbent" if normalized_type == improving_type else "progress",
                            "elapsed_seconds": self._finite_number(getattr(data_out, "running_time", None)),
                            "incumbent_objective": self._finite_number(getattr(data_out, "mip_primal_bound", None)),
                            "best_bound": self._finite_number(getattr(data_out, "mip_dual_bound", None)),
                            "gap": self._finite_number(getattr(data_out, "mip_gap", None)),
                            "node_count": self._finite_integer(getattr(data_out, "mip_node_count", None)),
                            "message": str(message or "").strip(),
                        })
                    except Exception:
                        # Progress monitoring must never interrupt the optimization run.
                        return

                status = raw_solver.setCallback(highs_callback, None)
                raw_solver.startCallback(callback_types.kCallbackMipImprovingSolution)
                raw_solver.startCallback(callback_types.kCallbackMipLogging)
                callback({
                    "kind": "monitoring_started",
                    "search_mode": "MIP_SEARCH",
                    "message": "正在接收 HiGHS 返回的真实 MIP 最优解搜索数据。",
                })
                return {"mode": "MIP_SEARCH", "raw_solver": raw_solver, "callback_status": str(status)}

            logging_type = int(callback_types.kCallbackLogging)

            def highs_callback(callback_type: Any, message: str, data_out: Any, _data_in: Any, _user_data: Any) -> None:
                try:
                    normalized_type = int(callback_type)
                    if normalized_type != logging_type:
                        return
                    # LP/QP iteration callbacks run once per algorithm iteration and can
                    # dominate very fast solves when crossing into Python. Logging is
                    # intentionally observed at HiGHS' native cadence; authoritative
                    # iteration totals are read from getInfo() after solve completion.
                    _ = (message, data_out)
                except Exception:
                    # Progress monitoring must never interrupt the optimization run.
                    return

            status = raw_solver.setCallback(highs_callback, None)
            raw_solver.startCallback(callback_types.kCallbackLogging)
            callback({
                "kind": "monitoring_started",
                "search_mode": "LP_ITERATION",
                "message": "该模型实际为连续 LP/QP；完成后将展示 HiGHS 的真实算法与迭代统计。",
            })
            return {"mode": "LP_ITERATION", "raw_solver": raw_solver, "callback_status": str(status)}
        except Exception as exc:
            callback({
                "kind": "monitoring_unavailable",
                "message": f"当前 HiGHS 运行环境未开放迭代回调：{type(exc).__name__}",
            })
            return None

    def _emit_lp_iteration_summary(
        self,
        callback: SolverProgressCallback,
        context: dict[str, Any],
        *,
        elapsed_seconds: float,
    ) -> None:
        if context.get("mode") != "LP_ITERATION":
            return
        try:
            info = context["raw_solver"].getInfo()
            counts = [
                ("单纯形", self._finite_integer(getattr(info, "simplex_iteration_count", None))),
                ("内点法", self._finite_integer(getattr(info, "ipm_iteration_count", None))),
                ("PDLP", self._finite_integer(getattr(info, "pdlp_iteration_count", None))),
            ]
            algorithm, iteration_count = max(counts, key=lambda item: item[1] if item[1] is not None else -1)
            callback({
                "kind": "iteration_final",
                "elapsed_seconds": round(max(0.0, elapsed_seconds), 6),
                "iteration_count": iteration_count or 0,
                "algorithm": algorithm if iteration_count else "预处理/直接求解",
            })
        except Exception:
            # Final iteration metadata is supplementary and must never affect the result.
            return

    @staticmethod
    def _finite_number(value: Any) -> float | None:
        try:
            number = float(value)
        except (TypeError, ValueError, OverflowError):
            return None
        return number if math.isfinite(number) else None

    @classmethod
    def _finite_integer(cls, value: Any) -> int | None:
        number = cls._finite_number(value)
        return None if number is None or number < 0 else int(number)

    def _extract_variables(self, model: Any) -> dict[str, Any]:
        import pyomo.environ as pyo

        values: dict[str, Any] = {}
        business_labels = getattr(model, "_business_variable_labels", {}) or {}
        for component in model.component_objects(pyo.Var, active=True):
            name = component.getname()
            if name in business_labels:
                meta = business_labels[name]
                base = str(meta.get("base") or name)
                key = ",".join(meta.get("keys") or []) or str(meta.get("label") or name)
                for index in component:
                    value = pyo.value(component[index], exception=False)
                    values.setdefault(base, {})[key] = None if value is None else round(float(value), 6)
                continue
            data: dict[str, float] = {}
            for index in component:
                label = self._label(name, index)
                value = pyo.value(component[index], exception=False)
                data[label] = None if value is None else round(float(value), 6)
            values[name] = data
        return values

    def _label(self, name: str, index: Any) -> str:
        if index is None:
            return name
        if isinstance(index, tuple):
            return f"{name}[{','.join(map(str, index))}]"
        return f"{name}[{index}]"
