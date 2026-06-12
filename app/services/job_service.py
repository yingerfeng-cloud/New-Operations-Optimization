from __future__ import annotations

import os
import uuid
from copy import deepcopy

from fastapi import HTTPException

from app.jobs.job_runner import job_runner
from app.schemas.solve import SolveRequest, TaskRecord, TaskView
from app.semantic.semantic_mapper import map_business_parameters
from app.semantic.semantic_validator import RuntimeParameterValidator
from app.services.model_service import CALLABLE_STATUSES, model_service
from app.services.template_service import template_library
from app.storage.memory_store import STORE
from app.utils import now_text


class JobService:
    def create_task(self, req: SolveRequest) -> TaskRecord:
        self._prepare_request(req)
        task_id = f"OPT-{uuid.uuid4().hex[:10].upper()}"
        record = TaskRecord(id=task_id, request=req, max_retries=max(0, req.max_retries))
        with STORE.lock:
            STORE.tasks[task_id] = record
        if os.getenv("COPT_SYNC_JOBS") == "true" or req.async_run is False:
            job_runner.run(task_id)
        else:
            job_runner.start(task_id)
        return record

    def list_tasks(self) -> list[TaskView]:
        with STORE.lock:
            return [task.view() for task in sorted(STORE.tasks.values(), key=lambda item: item.created_at, reverse=True)]

    def get_task(self, task_id: str) -> TaskRecord:
        with STORE.lock:
            task = STORE.tasks.get(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        return task

    def cancel_task(self, task_id: str) -> TaskView:
        task = self.get_task(task_id)
        if task.status not in {"PENDING", "VALIDATING", "BUILDING_MODEL", "SOLVING", "FORMATTING_RESULT"}:
            raise HTTPException(status_code=409, detail=f"Cannot cancel task in status {task.status}")
        task.status = "CANCELLED"
        task.progress = 100
        task.finished_at = now_text()
        task.error = "Task cancelled by user"
        return task.view()

    def retry_task(self, task_id: str) -> TaskView:
        task = self.get_task(task_id)
        if task.status not in {"FAILED", "TIMEOUT", "CANCELLED"}:
            raise HTTPException(status_code=409, detail=f"Cannot retry task in status {task.status}")
        task.error = None
        task.result = None
        task.progress = 5
        task.status = "PENDING"
        task.retry_count += 1
        task.started_at = None
        task.finished_at = None
        task.duration_seconds = None
        if os.getenv("COPT_SYNC_JOBS") == "true" or task.request.async_run is False:
            job_runner.run(task_id)
        else:
            job_runner.start(task_id)
        return task.view()

    def _prepare_request(self, req: SolveRequest) -> None:
        req.solver = "HiGHS"
        if req.solver_config:
            if req.solver_config.get("time_limit") is not None:
                req.time_limit_seconds = int(req.solver_config["time_limit"])
            if req.solver_config.get("mip_gap") is not None:
                req.mip_gap = float(req.solver_config["mip_gap"])
            if req.solver_config.get("thread_num") is not None:
                req.thread_num = int(req.solver_config["thread_num"])
        if req.runtime_parameters:
            req.parameters = {**req.parameters, **req.runtime_parameters}
        if req.model_code and not req.model_id:
            try:
                resolved = model_service.find_model_by_code(req.model_code)
                req.model_id = resolved.id
                req.payload = {
                    **req.payload,
                    "resolved_model_id": resolved.id,
                    "resolved_model_code": req.model_code,
                }
                warning = model_service.model_code_resolution_warning(req.model_code, resolved)
                if warning:
                    req.payload["resolution_warning"] = warning
            except HTTPException:
                template = template_library.get_template(req.model_code)
                runtime_parameters = {**template.get("sample_runtime_parameters", {}), **req.parameters, **req.payload}
                if req.horizon is not None:
                    runtime_parameters["horizon"] = req.horizon
                self._normalize_time_sets(runtime_parameters)
                runtime_parameters["semantic_spec"] = template
                errors = RuntimeParameterValidator().validate(template, runtime_parameters)
                if errors:
                    raise HTTPException(status_code=422, detail=errors)
                req.scene = template.get("scenario", req.scene)
                req.model = template.get("name", req.model)
                req.payload = {
                    **runtime_parameters,
                    "resolved_model_code": req.model_code,
                }
                return
        if not req.model_id:
            if req.model_code:
                req.payload = {**req.parameters, **req.payload, "model_code": req.model_code}
                return
            raise HTTPException(status_code=422, detail="model_id or model_code is required for semantic optimization")

        model = model_service.get_model(req.model_id)
        if model.status not in CALLABLE_STATUSES:
            raise HTTPException(status_code=409, detail=f"Model is not callable in status: {model.status}")
        req.scene = model.scene
        req.model = model.name
        model_code = (model.semantic_spec or {}).get("model_code") or model.template_id or req.model_code
        req.payload = {
            **req.payload,
            "resolved_model_id": model.id,
            "resolved_model_code": model_code,
        }
        runtime_parameters = map_business_parameters(model.semantic_spec, req.parameters)
        merged = {**deepcopy(model.parameters), **deepcopy(runtime_parameters), **deepcopy(req.payload)}
        if req.horizon is not None:
            merged["horizon"] = req.horizon
        if req.interval_minutes is not None:
            merged["interval_minutes"] = req.interval_minutes
        if req.objective_config:
            merged["objective_config"] = req.objective_config
        if req.constraint_config:
            merged["constraint_config"] = req.constraint_config
        if model.generic_spec:
            consistency_errors = RuntimeParameterValidator().validate_semantic_and_generic(model.semantic_spec, model.generic_spec)
            if consistency_errors:
                raise HTTPException(status_code=422, detail=consistency_errors)
            merged["generic_spec"] = self._instantiate_generic_spec(model.generic_spec, merged)
        if model.semantic_spec:
            merged["semantic_spec"] = model.semantic_spec
        self._normalize_time_sets(merged)
        self._normalize_default_hydro_series(merged, model_code, set(runtime_parameters.keys()))
        errors = RuntimeParameterValidator().validate(model.semantic_spec, merged)
        if errors:
            raise HTTPException(status_code=422, detail=errors)
        req.payload = merged

    def _normalize_time_sets(self, params: dict) -> None:
        try:
            horizon = int(params.get("horizon"))
        except (TypeError, ValueError):
            return
        if horizon <= 0:
            return
        time = params.get("time")
        time_volume = params.get("time_volume")
        if not isinstance(time, list) or len(time) != horizon:
            params["time"] = list(range(horizon))
        if not isinstance(time_volume, list) or len(time_volume) != horizon + 1:
            params["time_volume"] = list(range(horizon + 1))

    def _normalize_default_hydro_series(self, params: dict, model_code: str | None, provided_keys: set[str]) -> None:
        if model_code != "cascade_hydro_dispatch":
            return
        try:
            horizon = int(params.get("horizon"))
        except (TypeError, ValueError):
            return
        if horizon <= 0:
            return

        def resize(values: object) -> object:
            if not isinstance(values, list):
                return values
            if len(values) == horizon:
                return list(values)
            if not values:
                return [0 for _ in range(horizon)]
            result = list(values)
            while len(result) < horizon:
                result.extend(values)
            return result[:horizon]

        for key in ("availability", "local_inflow"):
            if key in provided_keys:
                continue
            value = params.get(key)
            if not isinstance(value, dict):
                continue
            for item_key, item_value in list(value.items()):
                value[item_key] = resize(item_value)

    def _instantiate_generic_spec(self, template: dict, runtime_payload: dict) -> dict:
        spec = {**template}
        params = dict(spec.get("parameters", {}))
        params.update({key: value for key, value in runtime_payload.items() if key not in {"generic_spec", "semantic_spec"}})
        spec["parameters"] = params
        return spec


job_service = JobService()
