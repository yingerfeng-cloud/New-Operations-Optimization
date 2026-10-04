from __future__ import annotations

import ast
import time
import uuid
from typing import Any

from fastapi import HTTPException

from app.schemas.solve import SolveRequest
from app.services.job_service import job_service
from app.services.model_service import DIRECT_CALLABLE_STATUSES, model_service
from app.services.result_interpreter import result_interpreter
from app.services.result_post_processor import result_post_processor
from app.services.result_service import result_service
from app.solvers.status import ipopt_unavailable_explanation
from app.storage.memory_store import STORE
from app.utils import now_text
from app.explainers.base import ADVISORY_DISCLAIMER
from app.agent.schema_parameter_analyzer import schema_parameter_analyzer
from app.variable_contract import normalize_variables
from app.model_dimensions import extract_dimensions
from app.services.time_dimension_service import resolve_time_dimension_config


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
        set_definitions = {
            str(item.get("key") or item.get("code")): item
            for item in semantic_spec.get("sets", []) or []
            if item.get("key") or item.get("code")
        }
        sets = {code: list(item.get("values") or item.get("members") or []) for code, item in set_definitions.items()}
        component_spec = semantic_spec.get("component_spec") or {}
        time_dimension = resolve_time_dimension_config(model=None, semantic_spec=semantic_spec, component_spec=component_spec, generic_spec=semantic_spec.get("generic_spec"), runtime_parameters={})
        label_set = str(time_dimension.get("label_set") or "")
        rows = []
        for param in semantic_spec.get("parameters", []) or []:
            code = param.get("math_param") or param.get("code") or param.get("key")
            if not code:
                continue
            validation = param.get("validation") or {}
            default_policy = param.get("default_policy") or validation.get("default_policy") or self._default_policy_for_param(param)
            sample_value = param.get("sample_value", param.get("sample", param.get("default_value")))
            default_value = param.get("default_value", param.get("default"))
            if default_policy == "default_allowed" and default_value is None:
                default_value = sample_value
            dimensions = extract_dimensions(param)
            set_definition = set_definitions.get(str(code), {})
            field_role = str(param.get("field_role") or param.get("semantic_role") or "")
            if not field_role and str(code) == label_set:
                field_role = "time_labels"
            if not field_role and dimensions == [str(code)] and str(code) in set_definitions:
                field_role = "set_members"
            runtime_editable = param.get("runtime_editable")
            if runtime_editable is None and field_role == "set_members":
                runtime_editable = set_definition.get("runtime_editable", set_definition.get("editable", False))
            if runtime_editable is None and field_role == "time_labels" and time_dimension.get("label_generation") == "auto":
                runtime_editable = False
            rows.append(
                {
                    "key": code,
                    "name": param.get("name") or code,
                    "dimension": dimensions,
                    "type": validation.get("type") or self._infer_type(param),
                    "unit": param.get("unit", ""),
                    "required": bool(validation.get("required", param.get("required", True))),
                    "description": param.get("meaning") or param.get("description") or "",
                    "default_value": default_value,
                    "sample_value": sample_value,
                    "default_policy": default_policy,
                    "source_system": param.get("source_system"),
                    "runtime_injected": bool(param.get("runtime_injected", False)),
                    "field_role": field_role or "parameter",
                    "runtime_editable": True if runtime_editable is None else bool(runtime_editable),
                    "sets": {dim: sets.get(str(dim), []) for dim in dimensions},
                    "time_dimension": time_dimension,
                    "dispatch_mode": "unit_commitment" if any((p.get("code") or p.get("math_param") or p.get("key")) == "initial_unit_status" for p in semantic_spec.get("parameters") or []) else "economic_dispatch",
                    "validation": validation,
                    **{key: param[key] for key in ("ui_group", "ui_group_label", "ui_group_order", "ui_order", "ui_editor", "ui_help", "ui_data_source") if key in param},
                }
            )
        return rows

    def output_schema(self, semantic_spec: dict[str, Any]) -> dict[str, Any]:
        return {
            "objective_value": "number",
            "variables": [
                {
                    "key": item["key"],
                    "name": item.get("name") or item.get("math_var") or item.get("key"),
                    "dimension": extract_dimensions(item),
                    "unit": item.get("unit", ""),
                }
                for item in normalize_variables(semantic_spec.get("variables", []) or [])
            ],
            "explanation": "string",
            "explanation_structured": "object",
            "evidence_package": "object",
            "explanation_audit": "object",
            "execution_policy": "string",
            "requires_human_review": "boolean",
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
        if model.status not in DIRECT_CALLABLE_STATUSES:
            error = self._structured_error(HTTPException(status_code=409, detail=f"Model is not callable in status: {model.status}"))
            record.update({"status": "FAILED", "finished_at": now_text(), "duration_seconds": round(time.monotonic() - started, 4), "error": error})
            self._save(record)
            raise HTTPException(status_code=409, detail=error)
        try:
            task = job_service.create_task(
                SolveRequest(
                    model_id=model.id,
                    parameters=parameters,
                    payload={
                        "_explanation_request": {
                            "skill_name": options.get("skill_name"),
                            "parameter_sources": options.get("parameter_sources") or {key: "USER_INPUT" for key in parameters},
                            "use_llm": bool(options.get("llm_explain", False)),
                        }
                    },
                    solver=str(options.get("solver") or model.solver or "auto"),
                    async_run=mode != "sync",
                    time_limit_seconds=int(options.get("time_limit_seconds") or 300),
                )
            )
            record["task_id"] = task.id
            if mode == "async":
                record["status"] = task.status
                record["duration_seconds"] = round(time.monotonic() - started, 4)
                self._save(record)
                pending_result = result_post_processor.process(
                    result={"status": task.status, "message": "异步任务已提交，尚未返回求解结果。"},
                    model=model,
                    skill_name=options.get("skill_name"),
                    parameters=parameters,
                    parameter_sources=options.get("parameter_sources") or {key: "USER_INPUT" for key in parameters},
                    use_llm=False,
                )
                return {
                    "invocation_id": invocation_id,
                    "status": task.status,
                    "task_id": task.id,
                    "model_id": model.id,
                    "resolved_model_id": model.id,
                    "resolved_model_code": resolved_model_code,
                    "execution_policy": pending_result["execution_policy"],
                    "requires_human_review": pending_result["requires_human_review"],
                    "profile_name": pending_result["profile_name"],
                    "evidence_package": pending_result["evidence_package"],
                    "explanation_structured": pending_result["explanation_structured"],
                    "explanation_audit": pending_result["explanation_audit"],
                    "explanation": "异步任务已提交，等待求解结果后生成完整解释。",
                    "disclaimer": ADVISORY_DISCLAIMER,
                }
            current = self._wait(task.id)
            if current.status in {"FAILED", "INFEASIBLE", "TIMEOUT", "CANCELLED"}:
                error = self._structured_error(self._task_failure_message(current), error_type=current.status.lower())
                response = self._failed_response(invocation_id, model.id, task.id, error, status=current.status, model=model, parameters=parameters, skill_name=options.get("skill_name"))
                record.update({"status": current.status, "finished_at": now_text(), "duration_seconds": round(time.monotonic() - started, 4), "error": error, "response": response})
                self._save(record)
                return response
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
                "charts": result.get("charts", []),
                "constraint_checks": result.get("constraint_checks", result.get("constraint_violation_summary", [])),
                "business_variables": interpreted["business_variables"],
                "explanation": interpreted["explanation"],
                "business_explanation": result.get("business_explanation"),
                "explanation_structured": result.get("explanation_structured"),
                "profile_name": result.get("profile_name") or "generic",
                "evidence_package": result.get("evidence_package"),
                "explanation_audit": result.get("explanation_audit"),
                "disclaimer": ADVISORY_DISCLAIMER,
                "warnings": result.get("warnings", result.get("diagnosis", [])),
                "execution_policy": result.get("execution_policy") or "advisory_only",
                "requires_human_review": bool(result.get("requires_human_review", True)),
                "raw_result": result,
            }
            record.update({"status": response["status"], "finished_at": now_text(), "duration_seconds": round(time.monotonic() - started, 4), "response": response})
            self._save(record)
            return response
        except HTTPException as exc:
            error = self._structured_error(exc)
            response = self._failed_response(invocation_id, model.id, record.get("task_id"), error, model=model, parameters=parameters, skill_name=options.get("skill_name"))
            record.update({"status": "FAILED", "finished_at": now_text(), "duration_seconds": round(time.monotonic() - started, 4), "error": error, "response": response})
            self._save(record)
            return response
        except Exception as exc:
            error = self._structured_error(exc)
            response = self._failed_response(invocation_id, model.id, record.get("task_id"), error, model=model, parameters=parameters, skill_name=options.get("skill_name"))
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
        return schema_parameter_analyzer.analyze(input_schema, partial_parameters)

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
                    "charts": result.get("charts", []),
                    "constraint_checks": result.get("constraint_checks", result.get("constraint_violation_summary", [])),
                    "business_variables": interpreted["business_variables"],
                    "explanation": interpreted["explanation"],
                    "business_explanation": result.get("business_explanation"),
                    "explanation_structured": result.get("explanation_structured"),
                    "profile_name": result.get("profile_name") or "generic",
                    "evidence_package": result.get("evidence_package"),
                    "explanation_audit": result.get("explanation_audit"),
                    "disclaimer": ADVISORY_DISCLAIMER,
                    "warnings": result.get("warnings", result.get("diagnosis", [])),
                    "execution_policy": result.get("execution_policy") or "advisory_only",
                    "requires_human_review": bool(result.get("requires_human_review", True)),
                    "raw_result": result,
                }
                record["response"] = response
            except Exception as exc:
                error = self._structured_error(exc)
                record.update({"status": "FAILED", "error": error, "response": self._failed_response(record["invocation_id"], record.get("model_id"), task_id, error)})
        elif task.status in {"FAILED", "INFEASIBLE", "TIMEOUT", "CANCELLED"}:
            error = self._structured_error(self._task_failure_message(task), error_type=task.status.lower())
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
        dimensions = extract_dimensions(param)
        return "number" if not dimensions else "dict"

    def _default_policy_for_param(self, param: dict[str, Any]) -> str:
        """Derive policy from the model contract, never from field or model names."""
        validation = param.get("validation") or {}
        if param.get("runtime_injected") is False:
            return "default_allowed"
        if param.get("default_value", param.get("default")) is not None:
            return "default_allowed"
        if bool(validation.get("required", param.get("required", True))):
            return "user_required"
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
            return {"type": error_type or str(exc.get("type") or "error"), "message": self._clean_error_message(exc), "details": self._detail_list(exc.get("details", exc))}
        return {"type": error_type or "runtime_error", "message": self._clean_error_message(exc), "details": self._detail_list(self._clean_error_message(exc))}

    def _task_failure_message(self, task: Any) -> str:
        error = getattr(task, "error", None)
        if error:
            return self._clean_error_message(error)
        trace = getattr(task, "trace", {}) or {}
        if isinstance(trace, dict) and trace.get("exception_summary"):
            return self._clean_error_message(trace["exception_summary"])
        return f"Task ended with status {getattr(task, 'status', 'FAILED')}"

    def _clean_error_message(self, raw: Any) -> str:
        if isinstance(raw, dict):
            if raw.get("message") is not None:
                return str(raw["message"])
            if raw.get("error") is not None:
                return str(raw["error"])
            return str(raw)
        if isinstance(raw, list):
            if raw and isinstance(raw[0], dict) and raw[0].get("message") is not None:
                return str(raw[0]["message"])
            return str(raw)
        text = str(raw)
        stripped = text.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                parsed = ast.literal_eval(stripped)
            except (SyntaxError, ValueError):
                return text
            return self._clean_error_message(parsed)
        return text

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

    def _failed_response(
        self,
        invocation_id: str,
        model_id: str | None,
        task_id: str | None,
        error: dict[str, Any],
        status: str = "FAILED",
        model: Any | None = None,
        parameters: dict[str, Any] | None = None,
        skill_name: str | None = None,
    ) -> dict[str, Any]:
        error_message = str(error.get("message") or "Skill invocation failed")
        resolved_model = model
        if resolved_model is None and model_id:
            try:
                resolved_model = model_service.get_model(model_id)
            except HTTPException:
                resolved_model = None
        explanation = self._failure_explanation(
            error,
            domain_label=self._failure_domain_label(resolved_model, model_id),
        )
        processed: dict[str, Any] | None = None
        if task_id:
            try:
                task_result = result_service.get_result(task_id)
                if task_result.get("evidence_package") and task_result.get("explanation_structured"):
                    processed = task_result
            except HTTPException:
                processed = None
        if processed is None:
            processed = result_post_processor.process(
                result={"status": status, "error": error, "message": error_message},
                model=resolved_model or {"model_id": model_id},
                skill_name=skill_name,
                parameters=parameters,
                parameter_sources={key: "USER_INPUT" for key in (parameters or {})},
                use_llm=False,
            )
        evidence_package = processed.get("evidence_package") or {}
        grounded = dict(processed.get("explanation_structured") or {})
        # The legacy top-level explanation is still part of the public
        # contract.  Keep the grounded summary/fact identical so clients do not
        # receive two conflicting descriptions of the same failure.
        grounded["summary"] = explanation
        if grounded.get("facts"):
            grounded["facts"][0] = explanation
        if grounded.get("fact_items"):
            grounded["fact_items"][0]["text"] = explanation
        risk_notes = list(grounded.get("risk_notes") or [])
        if error_message and error_message not in risk_notes:
            risk_notes.append(error_message)
        if "结果未生成，不能用于生产调度。" not in risk_notes:
            risk_notes.append("结果未生成，不能用于生产调度。")
        grounded["risk_notes"] = risk_notes
        return {
            "invocation_id": invocation_id,
            "task_id": task_id,
            "model_id": model_id,
            "resolved_model_id": model_id,
            "status": status,
            "error": error,
            "explanation": explanation,
            "suggestion": self._suggestion_for_error(error),
            "business_result": {},
            "charts": [],
            "constraint_checks": [],
            "warnings": [error_message],
            "explanation_structured": grounded,
            "explanation_audit": processed.get("explanation_audit"),
            "profile_name": evidence_package["model"]["profile_name"],
            "evidence_package": evidence_package,
            "disclaimer": ADVISORY_DISCLAIMER,
            "execution_policy": processed.get("execution_policy") or "advisory_only",
            "requires_human_review": bool(processed.get("requires_human_review", True)),
        }

    def _failure_explanation(self, error: dict[str, Any], domain_label: str | None = None) -> str:
        text = " ".join([str(error.get("message") or ""), str(error.get("details") or ""), str(error)])
        lowered = text.lower()
        unavailable_terms = (
            "solver_unavailable", "unavailable", "not available", "not installed",
            "not found", "missing", "no executable", "not in path",
        )
        if "ipopt" in lowered and any(term in lowered for term in unavailable_terms):
            return ipopt_unavailable_explanation(domain_label)
        return "Skill 调用失败，需要先修正错误后重新求解。当前结果不是有效优化方案。"

    def _failure_domain_label(self, model: Any | None, model_id: str | None) -> str | None:
        semantic = (
            dict(model.get("semantic_spec") or model)
            if isinstance(model, dict)
            else dict(getattr(model, "semantic_spec", {}) or {})
        )
        terms = [
            str(model_id or ""),
            str(semantic.get("model_code") or semantic.get("code") or ""),
            str(semantic.get("name") or ""),
            *[str(item) for item in semantic.get("tags") or []],
        ]
        normalized = " ".join(terms).lower()
        return "水电" if "hydro" in normalized or "水电" in normalized else None

    def _agent_skill_metadata(self, skill_name: str | None) -> dict[str, Any]:
        if not skill_name:
            return {}
        try:
            from app.agent_skill_registry import agent_skill_registry

            for item in agent_skill_registry.list_skills():
                if item.get("platform_skill_name") == skill_name or item.get("canonical_api_skill_name") == skill_name:
                    return agent_skill_registry.get_skill_local(str(item.get("name")))
        except Exception:
            return {}
        return {}

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
