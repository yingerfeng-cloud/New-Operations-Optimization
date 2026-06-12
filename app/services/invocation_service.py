from __future__ import annotations

import time
import uuid
from typing import Any

from fastapi import HTTPException

from app.schemas.solve import SolveRequest
from app.services.job_service import job_service
from app.services.model_service import CALLABLE_STATUSES, model_service
from app.services.result_interpreter import result_interpreter
from app.services.result_service import result_service
from app.storage.memory_store import STORE
from app.utils import now_text


class InvocationService:
    def model_schema(self, model_id: str) -> dict[str, Any]:
        model = model_service.get_model(model_id)
        return {
            "model_id": model.id,
            "model_code": self._model_code(model.semantic_spec, model),
            "name": model.name,
            "scene": model.scene,
            "status": model.status,
            "description": model.semantic_spec.get("scenario") or model.scene,
            "build_mode": model.build_mode,
            "model_problem_type": model.model_problem_type,
            "required_solver_capabilities": model.required_solver_capabilities,
            "component_schema": model.component_schema or model.semantic_spec.get("component_schema", {}),
            "ui_metadata": model.ui_metadata or model.semantic_spec.get("ui_metadata", {}),
            "input_schema": self.input_schema(model.semantic_spec),
            "output_schema": self.output_schema(model.semantic_spec),
            "semantic_spec": model.semantic_spec,
        }

    def input_schema(self, semantic_spec: dict[str, Any]) -> list[dict[str, Any]]:
        sets = {
            str(item.get("key") or item.get("code")): list(item.get("values") or [])
            for item in semantic_spec.get("sets", []) or []
            if item.get("key") or item.get("code")
        }
        rows = []
        for param in semantic_spec.get("parameters", []) or []:
            code = param.get("math_param") or param.get("code") or param.get("key")
            if not code:
                continue
            validation = param.get("validation") or {}
            default_policy = param.get("default_policy") or validation.get("default_policy") or self._default_policy_for_param(str(code), semantic_spec)
            sample_value = param.get("sample_value", param.get("sample", param.get("default_value")))
            default_value = param.get("default_value", param.get("default"))
            if default_policy == "default_allowed" and default_value is None:
                default_value = sample_value
            rows.append(
                {
                    "key": code,
                    "name": param.get("name") or code,
                    "dimension": list(param.get("dimension") or []),
                    "type": validation.get("type") or self._infer_type(param),
                    "unit": param.get("unit", ""),
                    "required": bool(validation.get("required", param.get("required", True))),
                    "description": param.get("meaning") or param.get("description") or "",
                    "default_value": default_value,
                    "sample_value": sample_value,
                    "default_policy": default_policy,
                    "sets": {dim: sets.get(str(dim), []) for dim in list(param.get("dimension") or [])},
                    "validation": validation,
                }
            )
        return rows

    def output_schema(self, semantic_spec: dict[str, Any]) -> dict[str, Any]:
        return {
            "objective_value": "number",
            "variables": [
                {
                    "key": item.get("math_var") or item.get("code") or item.get("key"),
                    "name": item.get("name") or item.get("math_var") or item.get("key"),
                    "dimension": list(item.get("dimension") or []),
                    "unit": item.get("unit", ""),
                }
                for item in semantic_spec.get("variables", []) or []
            ],
            "explanation": "string",
        }

    def invoke_model(self, model_id: str, body: dict[str, Any]) -> dict[str, Any]:
        model = model_service.get_model(model_id)
        parameters = {**(body.get("parameters") or {}), **(body.get("runtime_parameters") or {})}
        options = body.get("options") or {}
        mode = str(options.get("mode") or "sync").lower()
        invocation_id = f"INV-{uuid.uuid4().hex[:10].upper()}"
        record = {
            "invocation_id": invocation_id,
            "model_id": model.id,
            "model_version": model.version,
            "model_name": model.name,
            "skill_name": options.get("skill_name"),
            "caller": options.get("caller") or "api",
            "status": "RUNNING",
            "created_at": now_text(),
            "task_id": None,
            "parameter_summary": self._parameter_summary(parameters),
        }
        started = time.monotonic()
        with STORE.lock:
            STORE.invocations[invocation_id] = record
        resolved_model_code = self._model_code(model.semantic_spec, model)
        if model.status not in CALLABLE_STATUSES:
            error = self._structured_error(HTTPException(status_code=409, detail=f"Model is not callable in status: {model.status}"))
            record.update({"status": "FAILED", "finished_at": now_text(), "duration_seconds": round(time.monotonic() - started, 4), "error": error})
            self._save(record)
            raise HTTPException(status_code=409, detail=error)
        try:
            task = job_service.create_task(
                SolveRequest(
                    model_id=model.id,
                    parameters=parameters,
                    solver=str(options.get("solver") or "HiGHS"),
                    async_run=mode != "sync",
                    time_limit_seconds=int(options.get("time_limit_seconds") or 300),
                )
            )
            record["task_id"] = task.id
            if mode == "async":
                record["status"] = task.status
                record["duration_seconds"] = round(time.monotonic() - started, 4)
                self._save(record)
                return {
                    "invocation_id": invocation_id,
                    "status": task.status,
                    "task_id": task.id,
                    "model_id": model.id,
                    "resolved_model_id": model.id,
                    "resolved_model_code": resolved_model_code,
                    "execution_policy": "advisory_only",
                    "requires_human_review": True,
                }
            current = self._wait(task.id)
            result = result_service.get_result(task.id)
            interpreted = result_interpreter.interpret(model.semantic_spec, result)
            response = {
                "invocation_id": invocation_id,
                "task_id": task.id,
                "model_id": model.id,
                "resolved_model_id": model.id,
                "resolved_model_code": resolved_model_code,
                "status": result.get("status", current.status),
                "objective_value": result.get("objective_value"),
                "variable_values": result.get("variable_values", {}),
                "result": result,
                "business_result": result.get("business_output", {}),
                "business_variables": interpreted["business_variables"],
                "explanation": interpreted["explanation"],
                "warnings": result.get("warnings", result.get("diagnosis", [])),
                "execution_policy": "advisory_only",
                "requires_human_review": True,
                "raw_result": result,
            }
            record.update({"status": response["status"], "finished_at": now_text(), "duration_seconds": round(time.monotonic() - started, 4), "response": response})
            self._save(record)
            return response
        except HTTPException as exc:
            error = self._structured_error(exc)
            response = self._failed_response(invocation_id, model.id, record.get("task_id"), error)
            record.update({"status": "FAILED", "finished_at": now_text(), "duration_seconds": round(time.monotonic() - started, 4), "error": error, "response": response})
            self._save(record)
            return response
        except Exception as exc:
            error = self._structured_error(exc)
            response = self._failed_response(invocation_id, model.id, record.get("task_id"), error)
            record.update({"status": "FAILED", "finished_at": now_text(), "duration_seconds": round(time.monotonic() - started, 4), "error": error, "response": response})
            self._save(record)
            return response

    def list_invocations(self) -> list[dict[str, Any]]:
        with STORE.lock:
            records = list(STORE.invocations.values())
        refreshed = [self._refresh_record(dict(record)) for record in records]
        return sorted(refreshed, key=lambda item: item.get("created_at", ""), reverse=True)

    def get_invocation(self, invocation_id: str) -> dict[str, Any]:
        with STORE.lock:
            record = STORE.invocations.get(invocation_id)
        if not record:
            raise HTTPException(status_code=404, detail="Invocation not found")
        return self._refresh_record(dict(record))

    def analyze_parameters(self, input_schema: list[dict[str, Any]], partial_parameters: dict[str, Any]) -> dict[str, Any]:
        partial_parameters = partial_parameters or {}
        missing_required = []
        invalid_parameters = []
        can_use_default = []
        questions = []
        normalized_parameters = dict(partial_parameters)
        parameter_sources = {key: "user_provided" for key in partial_parameters.keys()}
        for item in input_schema or []:
            key = item.get("key")
            if not key:
                continue
            if (item.get("default_policy") or "sample_only") == "derived":
                continue
            has_value = key in partial_parameters and partial_parameters.get(key) not in (None, "")
            if not has_value:
                default_policy = item.get("default_policy") or "sample_only"
                fallback = item.get("default_value") if default_policy == "default_allowed" else None
                source = "default_value"
                if fallback is not None:
                    can_use_default.append({"key": key, "name": item.get("name") or key, "value": fallback, "source": source})
                    normalized_parameters.setdefault(key, fallback)
                    parameter_sources.setdefault(key, source)
                elif item.get("required", True):
                    missing_required.append({"key": key, "name": item.get("name") or key, "dimension": item.get("dimension") or [], "unit": item.get("unit", "")})
                    questions.append(self._question_for_parameter(item))
                continue
            error = self._validate_parameter_shape(item, partial_parameters.get(key))
            if error:
                invalid_parameters.append(error)
        requires_default_confirmation = bool(can_use_default)
        return {
            "ready": not missing_required and not invalid_parameters and not requires_default_confirmation,
            "missing_required": missing_required,
            "invalid_parameters": invalid_parameters,
            "can_use_default": can_use_default,
            "requires_default_confirmation": requires_default_confirmation,
            "questions": questions,
            "normalized_parameters": normalized_parameters,
            "parameter_sources": parameter_sources,
        }

    def _save(self, record: dict[str, Any]) -> None:
        with STORE.lock:
            STORE.invocations[record["invocation_id"]] = dict(record)
            STORE.save_runtime()

    def _refresh_record(self, record: dict[str, Any]) -> dict[str, Any]:
        task_id = record.get("task_id")
        if not task_id or record.get("status") in {"SUCCESS", "FAILED", "INFEASIBLE", "TIMEOUT", "CANCELLED"} and record.get("response"):
            return record
        try:
            task = job_service.get_task(task_id)
        except HTTPException as exc:
            error = self._structured_error(exc)
            record.update({"status": "FAILED", "finished_at": now_text(), "error": error, "response": self._failed_response(record["invocation_id"], record.get("model_id"), task_id, error)})
            self._save(record)
            return record
        record["status"] = task.status
        if task.finished_at:
            record["finished_at"] = task.finished_at
        if task.duration_seconds is not None:
            record["duration_seconds"] = task.duration_seconds
        if task.status == "SUCCESS":
            try:
                model = model_service.get_model(record["model_id"])
                result = result_service.get_result(task_id)
                interpreted = result_interpreter.interpret(model.semantic_spec, result)
                response = {
                    "invocation_id": record["invocation_id"],
                    "task_id": task_id,
                    "model_id": model.id,
                    "resolved_model_id": model.id,
                    "resolved_model_code": self._model_code(model.semantic_spec, model),
                    "status": result.get("status", task.status),
                    "objective_value": result.get("objective_value"),
                    "variable_values": result.get("variable_values", {}),
                    "result": result,
                    "business_result": result.get("business_output", {}),
                    "business_variables": interpreted["business_variables"],
                    "explanation": interpreted["explanation"],
                    "warnings": result.get("warnings", result.get("diagnosis", [])),
                    "execution_policy": "advisory_only",
                    "requires_human_review": True,
                    "raw_result": result,
                }
                record["response"] = response
            except Exception as exc:
                error = self._structured_error(exc)
                record.update({"status": "FAILED", "error": error, "response": self._failed_response(record["invocation_id"], record.get("model_id"), task_id, error)})
        elif task.status in {"FAILED", "INFEASIBLE", "TIMEOUT", "CANCELLED"}:
            error = self._structured_error(task.error or f"Task ended with status {task.status}", error_type=task.status.lower())
            record.update({"error": error, "response": self._failed_response(record["invocation_id"], record.get("model_id"), task_id, error, status=task.status)})
        self._save(record)
        return record

    def _wait(self, task_id: str):
        for _ in range(600):
            task = job_service.get_task(task_id)
            if task.status in {"SUCCESS", "FAILED", "INFEASIBLE", "TIMEOUT", "CANCELLED"}:
                return task
            time.sleep(0.2)
        return job_service.get_task(task_id)

    def _model_code(self, semantic_spec: dict[str, Any], model: Any) -> str:
        return str(semantic_spec.get("model_code") or semantic_spec.get("code") or model.template_id or model.id)

    def _infer_type(self, param: dict[str, Any]) -> str:
        dimensions = list(param.get("dimension") or [])
        return "number" if not dimensions else "dict"

    def _default_policy_for_param(self, code: str, semantic_spec: dict[str, Any] | None = None) -> str:
        semantic_spec = semantic_spec or {}
        model_code = str(semantic_spec.get("model_code") or semantic_spec.get("code") or "")
        if model_code == "custom_optimization_model":
            return "user_required" if code == "load_forecast" else "default_allowed"
        if model_code == "unit_commitment_day_ahead" and code in {"unit_min_output", "unit_max_output", "ramp_up_limit", "ramp_down_limit", "fuel_cost", "startup_cost", "initial_unit_status", "initial_unit_output"}:
            return "default_allowed"
        user_required = {
            "load_forecast",
            "electricity_price",
            "renewable_forecast",
            "unit_max_output",
            "fuel_cost",
            "storage_capacity",
            "charge_power_max",
            "discharge_power_max",
            "electric_load",
            "heat_load",
            "electric_max",
            "heat_max",
            "local_inflow",
            "load",
        }
        default_allowed = {
            "unit_min_output",
            "ramp_up_limit",
            "ramp_down_limit",
            "charge_efficiency",
            "discharge_efficiency",
            "initial_soc",
            "soc_min",
            "initial_unit_status",
            "initial_unit_output",
            "electric_min",
            "heat_min",
            "power_conversion",
            "volume_min",
            "volume_max",
            "initial_volume",
            "target_terminal_volume",
            "availability",
            "initial_upstream_outflow",
        }
        if code in user_required:
            return "user_required"
        if code in default_allowed:
            return "default_allowed"
        return "sample_only"

    def _parameter_summary(self, parameters: dict[str, Any]) -> dict[str, Any]:
        summary: dict[str, Any] = {}
        for key, value in (parameters or {}).items():
            if isinstance(value, dict):
                summary[key] = {"type": "dict", "keys": list(value.keys())[:8], "size": len(value)}
            elif isinstance(value, list):
                summary[key] = {"type": "array", "length": len(value)}
            else:
                summary[key] = {"type": type(value).__name__, "value": value}
        return summary

    def _structured_error(self, exc: Any, error_type: str | None = None) -> dict[str, Any]:
        if isinstance(exc, HTTPException):
            detail = exc.detail
            return {
                "type": error_type or self._error_type_from_status(exc.status_code),
                "message": "Skill invocation failed",
                "details": self._detail_list(detail),
                "http_status": exc.status_code,
            }
        if isinstance(exc, dict):
            return {"type": error_type or str(exc.get("type") or "error"), "message": str(exc.get("message") or "Skill invocation failed"), "details": self._detail_list(exc.get("details", exc))}
        return {"type": error_type or "runtime_error", "message": str(exc), "details": self._detail_list(str(exc))}

    def _detail_list(self, detail: Any) -> list[Any]:
        if isinstance(detail, list):
            return detail
        if isinstance(detail, dict):
            if isinstance(detail.get("errors"), list):
                return detail["errors"]
            if isinstance(detail.get("detail"), list):
                return detail["detail"]
            return [detail]
        return [{"message": str(detail)}]

    def _error_type_from_status(self, status_code: int) -> str:
        return {409: "model_or_task_state_error", 422: "parameter_validation_error", 404: "not_found", 408: "timeout"}.get(status_code, "api_error")

    def _failed_response(self, invocation_id: str, model_id: str | None, task_id: str | None, error: dict[str, Any], status: str = "FAILED") -> dict[str, Any]:
        return {
            "invocation_id": invocation_id,
            "task_id": task_id,
            "model_id": model_id,
            "resolved_model_id": model_id,
            "status": status,
            "error": error,
            "suggestion": self._suggestion_for_error(error),
            "execution_policy": "advisory_only",
            "requires_human_review": True,
        }

    def _suggestion_for_error(self, error: dict[str, Any]) -> str:
        error_type = error.get("type")
        if error_type == "parameter_validation_error":
            return "请根据 input_schema 补齐缺失参数或修正参数维度后重新调用。"
        if error_type in {"infeasible", "infeasible_error"}:
            return "请检查负荷、容量、备用和边界约束，必要时放宽约束或调整预测输入。"
        if error_type == "timeout":
            return "请增大 time_limit_seconds 或缩小问题规模后重试。"
        return "请查看 error.details 定位失败原因，修正后重新调用。"

    def _validate_parameter_shape(self, item: dict[str, Any], value: Any) -> dict[str, Any] | None:
        key = item.get("key")
        dimensions = list(item.get("dimension") or [])
        expected_type = str(item.get("type") or "").lower()
        if dimensions:
            if not isinstance(value, (dict, list)):
                return {"key": key, "error": "dimension parameter must be dict or list", "expected": dimensions, "actual": type(value).__name__}
            if expected_type == "dict" and not isinstance(value, dict):
                return {"key": key, "error": "parameter type mismatch", "expected": "dict", "actual": type(value).__name__}
            if expected_type == "array" and not isinstance(value, list):
                return {"key": key, "error": "parameter type mismatch", "expected": "array", "actual": type(value).__name__}
            expected_length = self._expected_parameter_length(item)
            if isinstance(value, list) and expected_length is not None and len(value) != expected_length:
                return {"key": key, "error": "length mismatch", "expected": expected_length, "actual": len(value)}
            if isinstance(value, dict):
                expected_keys = self._expected_parameter_keys(item)
                if expected_keys:
                    actual_keys = set(map(str, value.keys()))
                    unknown = sorted(actual_keys - set(expected_keys))
                    missing = sorted(set(expected_keys) - actual_keys)
                    if unknown:
                        return {"key": key, "error": "unknown dict keys", "expected": expected_keys, "actual": sorted(actual_keys), "unknown": unknown}
                    if missing:
                        return {"key": key, "error": "missing dict keys", "expected": expected_keys, "actual": sorted(actual_keys), "missing": missing}
        elif expected_type in {"number", "float", "integer", "int"} and not isinstance(value, (int, float)):
            return {"key": key, "error": "parameter type mismatch", "expected": expected_type, "actual": type(value).__name__}
        return None

    def _expected_parameter_length(self, item: dict[str, Any]) -> int | None:
        dimensions = list(item.get("dimension") or [])
        if len(dimensions) != 1:
            return None
        dim = str(dimensions[0])
        sets = item.get("sets") or {}
        if sets.get(dim):
            return len(sets[dim])
        for source_key in ("sample_value", "default_value"):
            value = item.get(source_key)
            if isinstance(value, list):
                return len(value)
            if isinstance(value, dict):
                return len(value)
        return None

    def _expected_parameter_keys(self, item: dict[str, Any]) -> list[str]:
        dimensions = list(item.get("dimension") or [])
        if len(dimensions) != 1:
            return []
        dim = str(dimensions[0])
        sets = item.get("sets") or {}
        if sets.get(dim):
            return [str(value) for value in sets[dim]]
        for source_key in ("sample_value", "default_value"):
            value = item.get(source_key)
            if isinstance(value, dict):
                return [str(key) for key in value.keys()]
        return []

    def _question_for_parameter(self, item: dict[str, Any]) -> str:
        name = item.get("name") or item.get("key")
        dimension = ",".join(item.get("dimension") or []) or "标量"
        unit = item.get("unit") or ""
        description = item.get("description") or ""
        return f"请提供{name}（维度：{dimension}，单位：{unit}）。{description}".strip()


invocation_service = InvocationService()
