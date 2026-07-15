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
from app.services.model_set_reference_validator import validate_set_references
from app.services.template_service import template_library
from app.services.time_dimension_service import normalize_runtime_time_dimension, resolve_time_dimension_config
from app.storage.memory_store import STORE
from app.utils import now_text


class JobService:
    def create_task(self, req: SolveRequest) -> TaskRecord:
        self._prepare_request(req)
        task_id = f"OPT-{uuid.uuid4().hex[:10].upper()}"
        record = TaskRecord(id=task_id, request=req, max_retries=max(0, req.max_retries))
        with STORE.lock:
            STORE.tasks[task_id] = record
            STORE.save_runtime()
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
        if task.status not in {"PENDING", "QUEUED", "RUNNING", "VALIDATING", "BUILDING_MODEL", "SOLVING", "FORMATTING_RESULT"}:
            raise HTTPException(status_code=409, detail=f"Cannot cancel task in status {task.status}")
        with STORE.lock:
            task.status = "CANCELLED"
            task.progress = 100
            task.finished_at = now_text()
            task.error = "Task cancelled by user"
            STORE.save_runtime()
        return task.view()

    def retry_task(self, task_id: str) -> TaskView:
        task = self.get_task(task_id)
        if task.status not in {"FAILED", "TIMEOUT", "CANCELLED", "INTERRUPTED"}:
            raise HTTPException(status_code=409, detail=f"Cannot retry task in status {task.status}")
        with STORE.lock:
            task.error = None
            task.result = None
            task.progress = 5
            task.status = "PENDING"
            task.retry_count += 1
            task.started_at = None
            task.finished_at = None
            task.duration_seconds = None
            STORE.save_runtime()
        if os.getenv("COPT_SYNC_JOBS") == "true" or task.request.async_run is False:
            job_runner.run(task_id)
        else:
            job_runner.start(task_id)
        return task.view()

    def _prepare_request(self, req: SolveRequest) -> None:
        req.solver = "HiGHS"
        user_parameter_keys = set(req.parameters or {})
        user_runtime_keys = set(req.runtime_parameters or {})
        user_payload_keys = set(req.payload or {})
        explicit_keys = user_parameter_keys | user_runtime_keys | user_payload_keys
        if req.interval_minutes is not None:
            explicit_keys.add("interval_minutes")
        explicit_horizon = self._explicit_horizon(req, explicit_keys)
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
                resolved = model_service.resolve_model(model_code=req.model_code)
                req.model_id = resolved.id
                req.payload = {
                    **req.payload,
                    "resolved_model_id": resolved.id,
                    "resolved_model_code": req.model_code,
                }
                warning = model_service.model_code_resolution_warning(req.model_code, resolved)
                if warning:
                    req.payload["resolution_warning"] = warning
            except HTTPException as exc:
                if exc.status_code != 404:
                    raise
                template = deepcopy(template_library.get_template(req.model_code))
                component_spec = deepcopy(template.get("component_spec") or {})
                generic_spec = deepcopy(template.get("generic_spec") or {})
                runtime_parameters = {**template.get("sample_runtime_parameters", {}), **req.parameters, **req.payload}
                self._validate_set_references(template, component_spec, generic_spec)
                if explicit_horizon is not None:
                    runtime_parameters["horizon"] = explicit_horizon
                time_dimension = resolve_time_dimension_config(
                    model=None,
                    semantic_spec=template,
                    component_spec=component_spec,
                    generic_spec=generic_spec,
                    runtime_parameters=runtime_parameters,
                )
                runtime_parameters, component_spec, generic_spec, normalized_time_dimension = normalize_runtime_time_dimension(
                    semantic_spec=template,
                    component_spec=component_spec,
                    generic_spec=generic_spec,
                    runtime_parameters=runtime_parameters,
                    explicit_horizon=explicit_horizon,
                    explicitly_provided_keys=explicit_keys,
                    time_dimension=time_dimension,
                )
                template.setdefault("ui_metadata", {})["time_dimension"] = normalized_time_dimension
                if component_spec:
                    template["component_spec"] = component_spec
                    runtime_parameters["component_spec"] = component_spec
                if generic_spec:
                    runtime_parameters["generic_spec"] = self._instantiate_generic_spec(generic_spec, runtime_parameters)
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

        model = model_service.resolve_model(model_id=req.model_id)
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
        semantic_spec = deepcopy(model.semantic_spec or {})
        component_spec = deepcopy(model.component_spec or semantic_spec.get("component_spec") or {})
        generic_spec = deepcopy(model.generic_spec or semantic_spec.get("generic_spec") or {})
        self._validate_set_references(semantic_spec, component_spec, generic_spec)
        runtime_parameters = map_business_parameters(semantic_spec, req.parameters)
        merged = {**self._default_parameters_from_model(model), **deepcopy(runtime_parameters), **deepcopy(req.payload)}
        if explicit_horizon is not None:
            merged["horizon"] = explicit_horizon
        if req.interval_minutes is not None:
            merged["interval_minutes"] = req.interval_minutes
        if req.objective_config:
            merged["objective_config"] = req.objective_config
        if req.constraint_config:
            merged["constraint_config"] = req.constraint_config
        time_dimension = resolve_time_dimension_config(
            model=model,
            semantic_spec=semantic_spec,
            component_spec=component_spec,
            generic_spec=generic_spec,
            runtime_parameters=merged,
        )
        merged, component_spec, generic_spec, normalized_time_dimension = normalize_runtime_time_dimension(
            semantic_spec=semantic_spec,
            component_spec=component_spec,
            generic_spec=generic_spec,
            runtime_parameters=merged,
            explicit_horizon=explicit_horizon,
            explicitly_provided_keys=explicit_keys,
            time_dimension=time_dimension,
        )
        semantic_spec.setdefault("ui_metadata", {})["time_dimension"] = normalized_time_dimension
        if component_spec:
            component_spec.setdefault("ui_metadata", {})["time_dimension"] = normalized_time_dimension
            semantic_spec["component_spec"] = component_spec
            merged["component_spec"] = component_spec
        if generic_spec:
            generic_spec.setdefault("ui_metadata", {})["time_dimension"] = normalized_time_dimension
            semantic_spec["generic_spec"] = generic_spec
        if generic_spec:
            consistency_errors = RuntimeParameterValidator().validate_semantic_and_generic(semantic_spec, generic_spec)
            if consistency_errors:
                raise HTTPException(status_code=422, detail=consistency_errors)
            merged["generic_spec"] = self._instantiate_generic_spec(generic_spec, merged)
        if semantic_spec:
            merged["semantic_spec"] = semantic_spec
        errors = RuntimeParameterValidator().validate(semantic_spec, merged)
        if errors:
            raise HTTPException(status_code=422, detail=errors)
        req.payload = merged

    @staticmethod
    def _validate_set_references(semantic_spec: dict, component_spec: dict, generic_spec: dict) -> None:
        errors = validate_set_references(
            semantic_spec=semantic_spec,
            component_spec=component_spec,
            generic_spec=generic_spec,
        )
        if errors:
            raise HTTPException(
                status_code=422,
                detail={"message": "模型存在无效集合引用，无法运行。", "errors": errors},
            )

    def _default_parameters_from_model(self, model: object) -> dict:
        semantic = deepcopy(getattr(model, "semantic_spec", None) or {})
        draft = deepcopy(getattr(model, "model_draft", None) or {})
        draft_parameters = draft.get("runtime_parameters") if isinstance(draft, dict) else {}
        return {
            **(semantic.get("sample_runtime_parameters") or {}),
            **(draft_parameters or {}),
            **(deepcopy(getattr(model, "parameters", None) or {})),
        }

    def _instantiate_generic_spec(self, template: dict, runtime_payload: dict) -> dict:
        spec = {**template}
        params = dict(spec.get("parameters", {}))
        params.update({key: value for key, value in runtime_payload.items() if key not in {"generic_spec", "semantic_spec"}})
        spec["parameters"] = params
        return spec

    def _explicit_horizon(self, req: SolveRequest, explicit_keys: set[str]) -> int | None:
        values: list[tuple[str, int]] = []
        if req.horizon is not None:
            values.append(("horizon", int(req.horizon)))
        for source_name, source in (
            ("runtime_parameters.horizon", req.runtime_parameters or {}),
            ("parameters.horizon", req.parameters or {}),
            ("payload.horizon", req.payload or {}),
        ):
            if "horizon" not in source:
                continue
            try:
                values.append((source_name, int(source["horizon"])))
            except (TypeError, ValueError):
                raise HTTPException(
                    status_code=422,
                    detail={
                        "message": "提交的调度时段 horizon 必须是整数。",
                        "errors": [{"field": source_name, "error": "invalid_horizon", "expected": "整数", "actual": source["horizon"]}],
                    },
                )
        if len({item[1] for item in values}) > 1:
            top = next((value for field, value in values if field == "horizon"), values[0][1])
            actual_field, actual = next((field, value) for field, value in values if value != top)
            raise HTTPException(
                status_code=422,
                detail={
                    "message": f"提交的调度时段不一致：顶层 horizon={top}，但 {actual_field}={actual}。",
                    "errors": [{"field": "horizon", "error": "inconsistent_horizon", "expected": top, "actual": actual}],
                },
            )
        if values:
            explicit_keys.add("horizon")
            return values[0][1]
        return None


job_service = JobService()
