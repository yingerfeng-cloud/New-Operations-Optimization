from __future__ import annotations

import threading
import time
import traceback
from datetime import datetime
from typing import Any

from app.builders.pyomo_builder import PyomoModelBuilder
from app.diagnosis.infeasible_diagnosis import diagnose_infeasible
from app.explain.result_formatter import SolveResultFormatter
from app.schemas.solve import TaskRecord, TaskStatus
from app.solvers.solver_router import SolverRouteError, solver_router
from app.storage.memory_store import STORE
from app.utils import now_text


class JobRunner:
    def start(self, task_id: str) -> None:
        threading.Thread(target=self.run, args=(task_id,), daemon=True).start()

    def run(self, task_id: str) -> None:
        task = self._get_task(task_id)
        if task.status == "CANCELLED":
            return
        try:
            with STORE.scheduler:
                if task.status == "CANCELLED":
                    return
                started = time.monotonic()
                task.started_at = now_text()
                self._log(task, "INFO", "任务已进入执行队列")
                self._update(task, status="VALIDATING", progress=15)
                validate_started = time.monotonic()
                self._log(task, "INFO", "参数校验开始")
                runtime = dict(task.request.payload or {})
                semantic_spec = runtime.get("semantic_spec") or {}
                model_code = semantic_spec.get("model_code") or runtime.get("model_code")
                task.trace["validation_seconds"] = round(time.monotonic() - validate_started, 4)
                self._log(task, "INFO", f"参数校验完成，耗时={task.trace['validation_seconds']}s")
                self._update(task, status="BUILDING_MODEL", progress=35)
                build_started = time.monotonic()
                build_mode = semantic_spec.get("build_mode") or "template_based"
                self._log(task, "INFO", f"开始构建模型 model_code={model_code}, build_mode={build_mode}")
                builder = PyomoModelBuilder()
                model, context = builder.build(semantic_spec, runtime)
                task.trace["model_build_seconds"] = round(time.monotonic() - build_started, 4)
                task.run_metrics.update(self._model_size(model))
                self._log(
                    task,
                    "INFO",
                    f"模型构建完成，变量数={task.run_metrics.get('variable_count')}，约束数={task.run_metrics.get('constraint_count')}，耗时={task.trace['model_build_seconds']}s",
                )
                self._update(task, status="SOLVING", progress=60)
                solve_started = time.monotonic()
                self._log(task, "INFO", f"开始调用路由求解器，time_limit_seconds={task.request.time_limit_seconds}")
                problem_type = self._problem_type(semantic_spec, model)
                requested_solver = runtime.get("solver")
                route = solver_router.route(problem_type, requested_solver)
                if not route["ok"]:
                    raise SolverRouteError(route)
                solver_result = solver_router.solve(
                    model,
                    problem_type=problem_type,
                    requested_solver=requested_solver,
                    mip_gap=task.request.mip_gap,
                    time_limit_seconds=task.request.time_limit_seconds,
                    threads=task.request.thread_num,
                )
                task.trace["solve_seconds"] = round(time.monotonic() - solve_started, 4)
                task.run_metrics.update(
                    {
                        "solver_status": solver_result.status,
                        "objective_value": solver_result.objective_value,
                        "solver_gap": None,
                    }
                )
                self._log(task, "INFO", f"求解完成，{solver_result.solver_log}，耗时={task.trace['solve_seconds']}s")
                if solver_result.status == "infeasible":
                    reason = solver_result.message or "模型不可行，请检查硬负荷目标、库容边界、生态流量和函数资产定义域。"
                    self._log(task, "ERROR", reason)
                    self._finish(task, status="INFEASIBLE", error=reason)
                    return
                elapsed = time.monotonic() - started
                raw_termination = str(getattr(solver_result, "raw_termination_condition", "") or "").lower()
                if elapsed > float(task.request.time_limit_seconds) or "max" in raw_termination and "time" in raw_termination:
                    self._log(task, "ERROR", "任务超过 time_limit_seconds，已标记超时，请检查模型规模、求解器状态或约束可行性。")
                    self._finish(task, status="TIMEOUT", error=f"任务超过 time_limit_seconds={task.request.time_limit_seconds}，已自动标记超时。")
                    return
                self._update(task, status="FORMATTING_RESULT", progress=90)
                format_started = time.monotonic()
                self._log(task, "INFO", "开始格式化业务结果")
                diagnosis = [] if solver_result.status in {"optimal", "feasible"} else diagnose_infeasible(str(model_code), runtime)
                formatted = SolveResultFormatter().format(str(model_code), solver_result, context)
                task.trace["format_seconds"] = round(time.monotonic() - format_started, 4)
                result = {
                    "job_id": task.id,
                    "model_id": task.request.model_id,
                    "model_code": str(model_code),
                    "status": "SUCCESS",
                    "solver": route["selected_solver"],
                    "solver_name": solver_result.solver_name or route["selected_solver"],
                    "solver_type": solver_result.solver_type or problem_type,
                    "solver_available": solver_result.solver_available,
                    "problem_type": problem_type,
                    "termination_condition": solver_result.termination_condition or solver_result.raw_termination_condition,
                    "raw_termination_condition": solver_result.raw_termination_condition,
                    "constraint_violation_summary": solver_result.constraint_violation_summary,
                    "local_optimum_warning": solver_result.local_optimum_warning or str(problem_type).upper() == "NLP",
                    "solver_config": {
                        "backend": route["selected_solver"],
                        "problem_type": problem_type,
                        "mip_gap": task.request.mip_gap,
                        "time_limit_seconds": task.request.time_limit_seconds,
                        "thread_num": task.request.thread_num,
                        "presolve": task.request.presolve,
                    },
                    "objective_value": solver_result.objective_value,
                    "solve_time": solver_result.solve_time,
                    "variable_values": solver_result.variable_values,
                    "solver_log": solver_result.solver_log,
                    "diagnosis": diagnosis,
                    "trace": task.trace,
                    "logs": task.logs,
                    "run_metrics": task.run_metrics,
                    "model": task.request.model,
                    "scene": task.request.scene,
                    "submitted_at": task.created_at,
                    "started_at": task.started_at,
                    "finished_at": now_text(),
                    **formatted,
                }
                task.result = result
                task.cost = float(result.get("metrics", {}).get("total_cost") or 0.0)
                task.gap = str(result.get("metrics", {}).get("gap") or "0.00%")
                task.risk = str(result.get("metrics", {}).get("risk") or "low")
                self._log(task, "INFO", f"业务结果格式化完成，耗时={task.trace['format_seconds']}s")
                self._log(task, "INFO", "结果保存开始")
                self._finish(task, status="SUCCESS")
                with STORE.lock:
                    STORE.results[task.id] = {
                        "summary": {
                            "model": task.request.model,
                            "scene": task.request.scene,
                            "solver": route["selected_solver"],
                            "total_cost": task.cost,
                            "gap": task.gap,
                            "risk": task.risk,
                            "finished_at": task.finished_at,
                        },
                        "result": result,
                        "parameters": runtime,
                    }
                self._log(task, "INFO", "结果保存完成")
        except Exception as exc:
            diagnosis = diagnose_infeasible(self._model_code(task), task.request.payload or {})
            if isinstance(exc, SolverRouteError):
                task.result = {"status": "FAILED", "solver_route_error": exc.payload, "trace": task.trace, "logs": task.logs, "run_metrics": task.run_metrics}
                self._finish(task, status="FAILED", error=str(exc.payload))
                return
            if diagnosis and task.result is None:
                task.result = {"status": "INFEASIBLE", "diagnosis": diagnosis, "solver": (task.request.payload or {}).get("solver") or "routed", "trace": task.trace, "logs": task.logs, "run_metrics": task.run_metrics}
            if task.retry_count < task.max_retries:
                task.retry_count += 1
                task.error = str(exc)
                self._update(task, status="PENDING", progress=5)
                self.start(task_id)
                return
            detail = {"message": str(exc), "diagnosis": diagnosis}
            task.trace["exception_summary"] = "".join(traceback.format_exception_only(type(exc), exc)).strip()
            self._log(task, "ERROR", f"任务失败：{exc}")
            self._log(task, "ERROR", task.trace["exception_summary"])
            self._finish(task, status="INFEASIBLE" if diagnosis else "FAILED", error=str(detail))

    def _get_task(self, task_id: str) -> TaskRecord:
        with STORE.lock:
            task = STORE.tasks.get(task_id)
        if task is None:
            raise RuntimeError(f"Task not found: {task_id}")
        return task

    def _model_code(self, task: TaskRecord) -> str:
        semantic = (task.request.payload or {}).get("semantic_spec") or {}
        return str(semantic.get("model_code") or (task.request.payload or {}).get("model_code") or "")

    def _update(self, task: TaskRecord, *, status: TaskStatus, progress: int) -> None:
        with STORE.lock:
            task.status = status
            task.progress = progress

    def _finish(self, task: TaskRecord, *, status: TaskStatus, error: str | None = None) -> None:
        with STORE.lock:
            task.status = status
            task.progress = 100
            task.finished_at = now_text()
            task.error = error
            if task.started_at:
                started = datetime.strptime(task.started_at, "%Y-%m-%d %H:%M:%S")
                finished = datetime.strptime(task.finished_at, "%Y-%m-%d %H:%M:%S")
                task.duration_seconds = round((finished - started).total_seconds(), 3)

    def _log(self, task: TaskRecord, level: str, message: str | None = None) -> None:
        if message is None:
            message = level
            level = "INFO"
        with STORE.lock:
            task.logs.append(f"{now_text()} [{level}] {message}")

    def _model_size(self, model: Any) -> dict[str, int]:
        import pyomo.environ as pyo

        variable_count = sum(1 for component in model.component_objects(pyo.Var, active=True) for _ in component)
        constraint_count = sum(1 for component in model.component_objects(pyo.Constraint, active=True) for _ in component)
        return {"variable_count": variable_count, "constraint_count": constraint_count}

    def _problem_type(self, semantic_spec: dict[str, Any], model: Any) -> str:
        component_spec = semantic_spec.get("component_spec") or {}
        diagnosis = component_spec.get("problem_type_diagnosis") or semantic_spec.get("problem_type_diagnosis") or {}
        return str(
            diagnosis.get("inferred_problem_type")
            or component_spec.get("model_problem_type")
            or semantic_spec.get("model_problem_type")
            or solver_router.infer_problem_type_from_model(model, "LP")
        )


job_runner = JobRunner()
