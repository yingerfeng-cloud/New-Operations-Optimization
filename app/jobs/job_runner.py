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
from app.services.result_post_processor import result_post_processor
from app.services.result_presentation import apply_result_presentation, build_result_views
from app.solvers.solver_router import SolverRouteError, solver_router
from app.storage.memory_store import STORE
from app.utils import now_text


STAGE_DURATION_TRACE_KEYS = {
    "VALIDATING": "validation_seconds",
    "BUILDING_MODEL": "model_build_seconds",
    "SOLVING": "solve_seconds",
    "FORMATTING_RESULT": "format_seconds",
}
MAX_SOLVER_PROGRESS_POINTS = 320
MAX_SOLVER_PROGRESS_EVENTS = 80
GAP_MILESTONES = (0.1, 0.05, 0.01, 0.001)


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
                declared_problem_type = self._declared_problem_type(semantic_spec)
                problem_type = self._problem_type(semantic_spec, model)
                task.trace["problem_type"] = problem_type
                if declared_problem_type:
                    task.trace["declared_problem_type"] = declared_problem_type
                if declared_problem_type and declared_problem_type != problem_type:
                    self._log(
                        task,
                        "INFO",
                        f"运行时模型结构识别为 {problem_type}（模型声明为 {declared_problem_type}），按实际结构展示求解过程",
                    )
                requested_solver = runtime.get("solver")
                route = solver_router.route(problem_type, requested_solver)
                if not route["ok"]:
                    raise SolverRouteError(route)
                self._initialize_solver_progress(
                    task,
                    solver=str(route["selected_solver"]),
                    problem_type=str(problem_type),
                )
                solver_result = solver_router.solve(
                    model,
                    problem_type=problem_type,
                    requested_solver=requested_solver,
                    mip_gap=task.request.mip_gap,
                    time_limit_seconds=task.request.time_limit_seconds,
                    threads=task.request.thread_num,
                    progress_callback=lambda sample: self._record_solver_progress(task, sample),
                )
                task.trace["solve_seconds"] = round(time.monotonic() - solve_started, 4)
                self._complete_solver_progress(
                    task,
                    status=solver_result.status,
                    objective=solver_result.objective_value,
                    gap=solver_result.mip_gap,
                )
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
                explanation_request = runtime.get("_explanation_request") if isinstance(runtime.get("_explanation_request"), dict) else {}
                result = result_post_processor.process(
                    result=result,
                    model=runtime.get("_result_context") or {"semantic_spec": semantic_spec, "id": task.request.model_id, "name": task.request.model, "scene": task.request.scene},
                    skill_name=explanation_request.get("skill_name"),
                    parameters=runtime.get("_explanation_parameters") or task.request.parameters,
                    parameter_sources=explanation_request.get("parameter_sources"),
                    use_llm=bool(explanation_request.get("use_llm", False)),
                )
                result.setdefault("result_metadata", {}).update(
                    {
                        "problem_type": problem_type,
                        "explanation_type": (result.get("business_explanation") or {}).get("explanation_type")
                        if isinstance(result.get("business_explanation"), dict)
                        else None,
                    }
                )
                result = apply_result_presentation(result)
                task.result = result
                task.objective_value = float(solver_result.objective_value) if solver_result.objective_value is not None else None
                result_metrics = result.get("metrics") if isinstance(result.get("metrics"), dict) else {}
                business_cost = result_metrics.get("total_cost")
                if business_cost is None:
                    business_cost = result_metrics.get("total_operating_cost")
                if business_cost is None:
                    business_cost = task.objective_value
                task.cost = float(business_cost) if business_cost is not None else 0.0
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
                            "objective_value": task.objective_value,
                            "total_cost": task.cost,
                            "gap": task.gap,
                            "risk": task.risk,
                            "finished_at": task.finished_at,
                        },
                        "result": result,
                        "parameters": runtime,
                    }
                    STORE.save_runtime()
                self._log(task, "INFO", "结果保存完成")
        except Exception as exc:
            self._fail_solver_progress(task, str(exc))
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
        changed_at = now_text()
        with STORE.lock:
            previous_status = task.status
            if previous_status != status:
                self._finish_stage(task, previous_status, changed_at)
                self._start_stage(task, status, changed_at)
            task.status = status
            task.progress = progress
            STORE.save_runtime()

    def _finish(self, task: TaskRecord, *, status: TaskStatus, error: str | None = None) -> None:
        processed_failure: dict[str, Any] | None = None
        if status in {"FAILED", "INFEASIBLE", "TIMEOUT", "CANCELLED", "INTERRUPTED"}:
            runtime = dict(task.request.payload or {})
            explanation_request = runtime.get("_explanation_request") if isinstance(runtime.get("_explanation_request"), dict) else {}
            failure_result = dict(task.result or {})
            failure_result.update({
                "job_id": task.id,
                "model_id": task.request.model_id,
                "model_code": self._model_code(task),
                "status": status,
                "error": error or failure_result.get("error"),
                "trace": task.trace,
                "logs": task.logs,
                "run_metrics": task.run_metrics,
            })
            try:
                processed_failure = result_post_processor.process(
                    result=failure_result,
                    model=runtime.get("_result_context") or {"semantic_spec": runtime.get("semantic_spec") or {}, "id": task.request.model_id, "name": task.request.model, "scene": task.request.scene},
                    skill_name=explanation_request.get("skill_name"),
                    parameters=runtime.get("_explanation_parameters") or task.request.parameters,
                    parameter_sources=explanation_request.get("parameter_sources"),
                    use_llm=bool(explanation_request.get("use_llm", False)),
                )
                processed_failure = apply_result_presentation(processed_failure)
            except Exception:
                # Explanation must never mask the original solve failure.
                processed_failure = failure_result
        with STORE.lock:
            if processed_failure is not None:
                task.result = processed_failure
            active_stage = self._active_stage(task)
            task.status = status
            task.progress = 100
            task.finished_at = now_text()
            self._finish_stage(task, active_stage, task.finished_at)
            self._start_stage(task, status, task.finished_at)
            self._finish_stage(task, status, task.finished_at)
            task.error = error
            if task.started_at:
                started = datetime.strptime(task.started_at, "%Y-%m-%d %H:%M:%S")
                finished = datetime.strptime(task.finished_at, "%Y-%m-%d %H:%M:%S")
                task.duration_seconds = round((finished - started).total_seconds(), 3)
            STORE.save_runtime()

    @staticmethod
    def _stage_timings(task: TaskRecord) -> dict[str, dict[str, Any]]:
        timings = task.trace.get("stage_timings")
        if not isinstance(timings, dict):
            timings = {}
            task.trace["stage_timings"] = timings
        return timings

    def _start_stage(self, task: TaskRecord, status: str, started_at: str) -> None:
        timings = self._stage_timings(task)
        timings[status] = {"started_at": started_at}

    def _active_stage(self, task: TaskRecord) -> str:
        """Return the stage that was running before a terminal status is stored."""
        timings = self._stage_timings(task)
        for status, timing in reversed(list(timings.items())):
            if isinstance(timing, dict) and not timing.get("finished_at"):
                return status
        return task.status

    def _finish_stage(self, task: TaskRecord, status: str, finished_at: str) -> None:
        timings = self._stage_timings(task)
        timing = timings.get(status)
        if not isinstance(timing, dict):
            timing = {"started_at": task.created_at if status == "PENDING" else task.started_at or finished_at}
            timings[status] = timing
        timing["finished_at"] = finished_at
        duration_key = STAGE_DURATION_TRACE_KEYS.get(status)
        duration = task.trace.get(duration_key) if duration_key else None
        if isinstance(duration, (int, float)) and not isinstance(duration, bool):
            timing["duration_seconds"] = duration

    def _initialize_solver_progress(self, task: TaskRecord, *, solver: str, problem_type: str) -> None:
        with STORE.lock:
            task.trace["solver_progress"] = {
                "schema_version": "1.1",
                "solver": solver,
                "problem_type": problem_type,
                "search_mode": None,
                "status": "WAITING",
                "supported": None,
                "message": "正在等待求解器返回真实迭代数据。",
                "points": [],
                "events": [{"kind": "search_started", "label": "开始搜索最优解", "elapsed_seconds": 0.0}],
                "latest": {},
                "gap_milestones": [],
            }

    def _record_solver_progress(self, task: TaskRecord, sample: dict[str, Any]) -> None:
        with STORE.lock:
            progress = task.trace.get("solver_progress")
            if not isinstance(progress, dict):
                return
            kind = str(sample.get("kind") or "progress")
            if kind == "monitoring_started":
                progress["status"] = "RUNNING"
                progress["supported"] = True
                progress["search_mode"] = sample.get("search_mode") or progress.get("search_mode")
                progress["message"] = str(sample.get("message") or "正在接收 HiGHS 返回的真实求解数据。")
                return
            if kind == "monitoring_unavailable":
                progress["status"] = "UNAVAILABLE"
                progress["supported"] = False
                progress["message"] = str(sample.get("message") or "当前求解器未返回迭代轨迹。")
                self._append_solver_event(progress, "monitoring_unavailable", progress["message"], 0.0)
                return

            point = {
                "elapsed_seconds": self._finite_number(sample.get("elapsed_seconds")),
                "incumbent_objective": self._finite_number(sample.get("incumbent_objective")),
                "best_bound": self._finite_number(sample.get("best_bound")),
                "gap": self._finite_number(sample.get("gap")),
                "node_count": self._finite_integer(sample.get("node_count")),
                "iteration_count": self._finite_integer(sample.get("iteration_count")),
                "algorithm": str(sample.get("algorithm")) if sample.get("algorithm") else None,
                "kind": kind,
            }
            if all(point.get(key) is None for key in ("incumbent_objective", "best_bound", "gap", "node_count", "iteration_count")):
                return
            point["elapsed_seconds"] = point["elapsed_seconds"] or 0.0
            points = progress.setdefault("points", [])
            if not isinstance(points, list):
                points = []
                progress["points"] = points
            last = points[-1] if points and isinstance(points[-1], dict) else {}
            value_keys = ("incumbent_objective", "best_bound", "gap", "node_count", "iteration_count", "algorithm")
            unchanged = bool(last) and all(last.get(key) == point.get(key) for key in value_keys)
            elapsed_delta = float(point["elapsed_seconds"]) - float(last.get("elapsed_seconds") or 0.0)
            if kind in {"progress", "iteration"} and unchanged and elapsed_delta < 0.25:
                return

            previous_incumbent = next(
                (item.get("incumbent_objective") for item in reversed(points) if isinstance(item, dict) and item.get("incumbent_objective") is not None),
                None,
            )
            points.append(point)
            if len(points) > MAX_SOLVER_PROGRESS_POINTS:
                points[:] = [points[0], *points[2::2]]

            latest = progress.setdefault("latest", {})
            if not isinstance(latest, dict):
                latest = {}
                progress["latest"] = latest
            for key in ("elapsed_seconds", *value_keys):
                if point.get(key) is not None:
                    latest[key] = point[key]
            progress["point_count"] = len(points)

            incumbent = point.get("incumbent_objective")
            if kind == "incumbent" and incumbent is not None:
                event_kind = "first_feasible" if previous_incumbent is None else "incumbent_improved"
                label = "找到首个可行解" if previous_incumbent is None else "找到更优可行解"
                self._append_solver_event(progress, event_kind, label, float(point["elapsed_seconds"]), incumbent)

            gap = point.get("gap")
            if gap is not None and gap >= 0:
                achieved = progress.setdefault("gap_milestones", [])
                candidates = [threshold for threshold in GAP_MILESTONES if gap <= threshold and threshold not in achieved]
                if candidates:
                    threshold = min(candidates)
                    achieved.append(threshold)
                    self._append_solver_event(
                        progress,
                        "gap_milestone",
                        f"Gap 降至 {threshold * 100:g}% 以下",
                        float(point["elapsed_seconds"]),
                        gap,
                    )

    def _complete_solver_progress(
        self,
        task: TaskRecord,
        *,
        status: str,
        objective: float | None,
        gap: float | None,
    ) -> None:
        self._record_solver_progress(task, {
            "kind": "final",
            "elapsed_seconds": task.trace.get("solve_seconds"),
            "incumbent_objective": objective,
            "gap": gap,
        })
        with STORE.lock:
            progress = task.trace.get("solver_progress")
            if not isinstance(progress, dict):
                return
            normalized_status = str(status or "").lower()
            progress["status"] = "COMPLETED"
            progress["final_status"] = status
            points = progress.get("points") if isinstance(progress.get("points"), list) else []
            iteration_points = [
                point for point in points
                if isinstance(point, dict) and point.get("iteration_count") is not None
            ]
            if progress.get("supported") is True and progress.get("search_mode") == "LP_ITERATION" and len(iteration_points) < 2:
                latest = progress.get("latest") if isinstance(progress.get("latest"), dict) else {}
                iteration_count = latest.get("iteration_count", 0)
                algorithm = latest.get("algorithm") or "LP 算法"
                progress["message"] = f"该连续模型快速完成，共执行 {iteration_count} 次{algorithm}迭代；求解时间过短，未产生可绘制的分段采样轨迹。"
            elif progress.get("supported") is True and len(points) < 2:
                progress["message"] = "任务快速完成，未产生足够的迭代采样点。"
            elif progress.get("supported") is True and progress.get("search_mode") == "LP_ITERATION":
                progress["message"] = "已记录 HiGHS 返回的真实 LP 算法迭代轨迹；LP 不产生 MIP 的可行解、最优界和分支节点。"
            elif progress.get("supported") is True:
                progress["message"] = "已记录 HiGHS 返回的真实最优解搜索轨迹。"
            if "optimal" in normalized_status:
                event_kind, label = "optimality_proven", "求解器已证明当前解最优"
            elif "infeasible" in normalized_status:
                event_kind, label = "infeasible_proven", "求解器判定模型不可行"
            else:
                event_kind, label = "search_finished", "最优解搜索结束"
            elapsed = self._finite_number(task.trace.get("solve_seconds")) or 0.0
            self._append_solver_event(progress, event_kind, label, elapsed, objective)

    def _fail_solver_progress(self, task: TaskRecord, message: str) -> None:
        with STORE.lock:
            progress = task.trace.get("solver_progress")
            if not isinstance(progress, dict) or progress.get("status") in {"COMPLETED", "FAILED"}:
                return
            progress["status"] = "FAILED"
            progress["message"] = "求解在完成最优解搜索前异常终止。"
            elapsed = self._finite_number(task.trace.get("solve_seconds")) or 0.0
            self._append_solver_event(progress, "search_failed", "最优解搜索异常终止", elapsed)
            progress["error"] = message

    @staticmethod
    def _append_solver_event(
        progress: dict[str, Any],
        kind: str,
        label: str,
        elapsed_seconds: float,
        value: float | None = None,
    ) -> None:
        events = progress.setdefault("events", [])
        if not isinstance(events, list):
            events = []
            progress["events"] = events
        event = {"kind": kind, "label": label, "elapsed_seconds": round(float(elapsed_seconds), 4)}
        if value is not None:
            event["value"] = value
        events.append(event)
        if len(events) > MAX_SOLVER_PROGRESS_EVENTS:
            del events[1 : len(events) - MAX_SOLVER_PROGRESS_EVENTS + 1]

    @staticmethod
    def _finite_number(value: Any) -> float | None:
        try:
            number = float(value)
        except (TypeError, ValueError, OverflowError):
            return None
        return number if number == number and abs(number) != float("inf") else None

    @classmethod
    def _finite_integer(cls, value: Any) -> int | None:
        number = cls._finite_number(value)
        return None if number is None or number < 0 else int(number)

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
        _ = semantic_spec
        return str(solver_router.infer_problem_type_from_model(model, "LP"))

    def _declared_problem_type(self, semantic_spec: dict[str, Any]) -> str | None:
        component_spec = semantic_spec.get("component_spec") or {}
        diagnosis = component_spec.get("problem_type_diagnosis") or semantic_spec.get("problem_type_diagnosis") or {}
        value = (
            semantic_spec.get("model_problem_type")
            or component_spec.get("model_problem_type")
            or diagnosis.get("effective_problem_type")
            or diagnosis.get("inferred_problem_type")
        )
        return str(value) if value else None

    @staticmethod
    def _result_capabilities(result: dict[str, Any]) -> list[str]:
        """Backward-compatible accessor for the unified presentation contract."""
        return [view["kind"] for view in build_result_views(result)]


job_runner = JobRunner()
