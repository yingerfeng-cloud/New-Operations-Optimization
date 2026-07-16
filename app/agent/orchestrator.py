from __future__ import annotations

import re
import time
from typing import Any

from fastapi import HTTPException

from app.agent.conversation_store import conversation_store
from app.agent.parameter_extractor import parameter_extractor
from app.agent.parameter_extractor_v2 import parameter_extractor_v2
from app.agent.platform_client import platform_client
from app.agent.skill_router import agent_skill_router
from app.agent.intent_router_v2 import intent_router_v2
from app.agent.llm_intent_parser_v2 import llm_intent_parser_v2
from app.services.agent_skill_service import agent_skill_service
from app.services.function_asset_service import function_asset_service
from app.services.invocation_service import invocation_service
from app.services.llm_service import llm_service
from app.solvers.status import solver_status
from app.templates.power_templates import get_power_templates


PARAMETER_DISPLAY_NAMES = {
    "electricity_price": "电价",
    "storage_capacity": "储能容量",
    "charge_power_max": "最大充电功率",
    "discharge_power_max": "最大放电功率",
    "charge_efficiency": "充电效率",
    "discharge_efficiency": "放电效率",
    "initial_soc": "初始SOC",
    "soc_min": "SOC下限比例",
    "eta_ch": "充电效率",
    "eta_dis": "放电效率",
    "load_forecast": "系统负荷预测",
    "unit_min_output": "机组最小出力",
    "unit_max_output": "机组最大出力",
    "fuel_cost": "燃料成本",
    "ramp_up_limit": "上爬坡限制",
    "ramp_down_limit": "下爬坡限制",
    "renewable_forecast": "新能源预测出力",
    "grid_export_limit": "并网功率上限",
    "electric_load": "电负荷",
    "heat_load": "热负荷",
    "electric_max": "电出力上限",
    "heat_max": "热出力上限",
    "local_inflow": "区间来水过程",
    "load": "系统负荷预测",
    "station": "电站清单",
    "units": "机组清单",
    "availability": "机组可用状态",
    "power_conversion": "出力转换系数",
    "volume_min": "最小库容",
    "volume_max": "最大库容",
    "initial_volume": "初始库容",
    "target_terminal_volume": "目标期末库容",
    "outflow_min": "最小下泄流量",
    "outflow_max": "最大下泄流量",
    "spill_max": "最大弃水流量",
    "edges": "梯级拓扑关系",
    "initial_upstream_outflow": "初始上游出库流量",
    "horizon": "调度时段数",
    "time": "调度时段",
    "time_volume": "库容时点",
    "time_step_seconds": "时段长度",
    "weights": "目标函数权重",
}


class AgentOrchestrator:
    PLATFORM_UNAVAILABLE_MESSAGE = (
        "Agent service is online, but the optimization platform is unavailable. "
        "Please check platform URL, token, and service status."
    )

    def analyze(self, body: dict[str, Any]) -> dict[str, Any]:
        started_at = time.perf_counter()
        timing = {
            "router_ms": 0,
            "platform_skill_ms": 0,
            "parameter_extract_ms": 0,
            "llm_extract_ms": 0,
            "analyze_input_ms": 0,
            "total_ms": 0,
        }
        conversation_id = body.get("conversation_id")
        message = str(body.get("message") or "")
        existing = self._existing_conversation(conversation_id)
        demo_response = self._demo_question_response(conversation_id, existing, message)
        if demo_response:
            return self._finalize_analyze_response(demo_response, timing, started_at)
        manual_skill = body.get("skill_name")
        router_started = time.perf_counter()
        available_agent_skills = agent_skill_service.list_skills()
        legacy_router_result = agent_skill_router.route(message, existing, available_agent_skills)
        llm_intent_parse = llm_intent_parser_v2.parse(message, existing, available_agent_skills)
        v2_router_result = intent_router_v2.route(message, existing, available_agent_skills, llm_parse=llm_intent_parse)
        v2_router_result["llm_intent_parse"] = llm_intent_parse
        legacy_intent = legacy_router_result.get("intent")
        legacy_compat_intents = {
            "how_to_use", "explain_required_parameters", "parameter_example", "skill_availability_query",
            "switch_skill", "confirm_defaults", "confirm_invoke", "result_explanation",
            "confirm_switch_clear", "confirm_switch_migrate", "cancel_switch", "parameter_supplement",
        }
        if legacy_intent in legacy_compat_intents:
            router_result = legacy_router_result
        elif legacy_intent == "optimization_request" and legacy_router_result.get("agent_skill_name"):
            # Preserve deterministic, explicit scenario aliases while exposing
            # the v2 ranking evidence for diagnostics.  A weak/close v2 score
            # must not turn a known storage or hydro request into clarification.
            router_result = {
                **v2_router_result,
                **legacy_router_result,
                "need_clarification": False,
                "clarification_question": None,
                "router_version": v2_router_result.get("router_version", "2.0"),
                "candidate_skills": v2_router_result.get("candidate_skills", []),
                "audit": {
                    **(v2_router_result.get("audit") or {}),
                    "compatibility_fallback": "legacy_explicit_skill_match",
                },
            }
        else:
            router_result = v2_router_result
        timing["router_ms"] = self._elapsed_ms(router_started)
        fallback_intent = self.intent_router(message, existing, body)
        if (
            fallback_intent == "parameter_supplement"
            and existing.get("resolved_skill_name")
            and router_result.get("intent") not in legacy_compat_intents
        ):
            router_result = {
                **v2_router_result,
                "intent": "parameter_supplement",
                "agent_skill_name": existing.get("agent_skill_name") or self._agent_skill_for_api(existing.get("resolved_skill_name")),
                "api_skill_name": existing.get("resolved_skill_name"),
                "platform_skill_name": existing.get("resolved_skill_name"),
                "need_clarification": False,
                "clarification_question": None,
                "audit": {
                    **(v2_router_result.get("audit") or {}),
                    "compatibility_fallback": "active_task_parameter_supplement",
                },
            }
        router_intent = router_result.get("intent")
        intent = router_intent if router_intent in {
            "how_to_use",
            "explain_required_parameters",
            "parameter_example",
            "skill_availability_query",
            "optimization_request",
            "switch_skill",
            "confirm_defaults",
            "confirm_invoke",
            "result_explanation",
            "confirm_switch_clear",
            "confirm_switch_migrate",
            "cancel_switch",
            "skill_selection_required",
            "knowledge_question",
            "safety_refusal",
        } else fallback_intent

        if intent == "safety_refusal":
            return self._finalize_analyze_response(
                self._policy_chat_response(
                    conversation_id,
                    existing,
                    message,
                    "平台当前仅支持辅助分析和决策建议，不支持绕过人工审批直接下发生产控制或交易申报指令。",
                    intent,
                    router_result,
                ),
                timing,
                started_at,
            )
        if intent == "knowledge_question":
            return self._finalize_analyze_response(
                self._policy_chat_response(conversation_id, existing, message, self._rule_chat_reply(message), intent, router_result),
                timing,
                started_at,
            )
        if self._is_casual_chat(message) and not manual_skill:
            return self._finalize_analyze_response(self._chat_only(conversation_id, existing, message, preserve_task=self._has_active_optimization(existing)), timing, started_at)
        if router_result.get("need_clarification") and not manual_skill:
            return self._finalize_analyze_response(
                self._policy_chat_response(
                    conversation_id,
                    existing,
                    message,
                    str(router_result.get("clarification_question") or "请补充具体优化场景和业务目标。"),
                    "clarification_required",
                    router_result,
                ),
                timing,
                started_at,
            )

        if intent in {"confirm_switch_clear", "confirm_switch_migrate", "cancel_switch"}:
            return self._finalize_analyze_response(self._handle_switch_confirmation(conversation_id, existing, message, intent), timing, started_at)
        if intent == "how_to_use":
            return self._finalize_analyze_response(self._how_to_use_response(conversation_id, existing, message), timing, started_at)
        if intent == "switch_skill":
            return self._finalize_analyze_response(self._switch_skill_response(conversation_id, existing, message, router_result), timing, started_at)
        if intent == "result_explanation":
            return self._finalize_analyze_response(self._result_explanation_chat(conversation_id, existing, message), timing, started_at)
        if intent == "explain_required_parameters":
            agent_skill = router_result.get("agent_skill_name") or self._agent_skill_for_api(manual_skill) or existing.get("agent_skill_name") or self._agent_skill_for_api(existing.get("resolved_skill_name"))
            return self._finalize_analyze_response(self._required_parameters_response(conversation_id, existing, message, agent_skill), timing, started_at)
        if intent == "parameter_example":
            skill = manual_skill or router_result.get("api_skill_name") or existing.get("resolved_skill_name") or self._select_skill(message)
            agent_skill = router_result.get("agent_skill_name") or self._agent_skill_for_api(skill)
            if not skill and not agent_skill:
                return self._finalize_analyze_response(self._skill_selection_required(conversation_id, existing, message), timing, started_at)
            return self._finalize_analyze_response(self.parameter_example_response(conversation_id, existing, message, skill or agent_skill), timing, started_at)
        if intent == "skill_availability_query":
            agent_skill = router_result.get("agent_skill_name") or self._agent_skill_for_select_skill(self._select_skill(message))
            return self._finalize_analyze_response(self._skill_availability_response(conversation_id, existing, message, agent_skill), timing, started_at)
        if intent in {"confirm_invoke", "confirm_defaults"} and not self._has_active_optimization(existing):
            return self._finalize_analyze_response(self._no_active_task_response(conversation_id, existing, message, intent), timing, started_at)
        default_confirmed = bool(body.get("confirm_defaults") or body.get("use_defaults") or intent == "confirm_defaults")
        skill_name = (
            manual_skill
            or router_result.get("api_skill_name")
            or (existing.get("resolved_skill_name") if default_confirmed else None)
            or (self._select_skill(message) if not router_result.get("agent_skill_name") else None)
            or existing.get("resolved_skill_name")
            or existing.get("selected_skill")
        )
        if not skill_name and router_result.get("agent_skill_name"):
            skill_name = f"run_{router_result['agent_skill_name']}"
        if not skill_name:
            return self._finalize_analyze_response(self._chat_only(conversation_id, existing, message, preserve_task=False), timing, started_at)

        previous_draft = existing.get("parameter_draft") or {}
        agent_skill_name = router_result.get("agent_skill_name") or self._agent_skill_for_api(skill_name)
        local_analysis_only = False
        skill: dict[str, Any] = {}
        input_schema: list[dict[str, Any]] = []
        resolved_skill_name = skill_name
        if intent == "optimization_request" and agent_skill_name and not previous_draft and not default_confirmed and not self._platform_is_test_unavailable():
            try:
                local_skill = agent_skill_service.get_skill_local(agent_skill_name)
                local_schema = local_skill.get("input_schema") or []
                if not self.should_extract_parameters(message, intent, local_schema):
                    resolved_skill_name = local_skill.get("canonical_api_skill_name") or skill_name
                    skill_name = resolved_skill_name
                    input_schema = local_schema
                    skill = {"canonical_skill_name": resolved_skill_name, "skill_name": resolved_skill_name, "model_id": (local_skill.get("api_skill") or {}).get("model_id")}
                    local_analysis_only = True
            except Exception:
                local_analysis_only = False
        if not local_analysis_only:
            try:
                platform_started = time.perf_counter()
                prefer_custom = bool(manual_skill) and "U3" not in message.upper()
                skill_name = self._resolve_api_skill_name(skill_name, prefer_custom=prefer_custom)
                skill = platform_client.get_skill(skill_name)
                timing["platform_skill_ms"] = self._elapsed_ms(platform_started)
            except HTTPException:
                timing["platform_skill_ms"] = self._elapsed_ms(platform_started)
                return self._finalize_analyze_response(self._platform_unavailable_response(conversation_id, existing, message, skill_name, router_result.get("agent_skill_name")), timing, started_at)
            resolved_skill_name = skill.get("canonical_skill_name") or skill.get("skill_name") or skill_name
            input_schema = skill.get("input_schema") or []
        extract_meta = {"llm_timeout": False, "fallback_mode": None, "llm_extract_ms": 0, "schema_fit_score": 0.0, "parameter_sources": {}}
        extract_started = time.perf_counter()
        allow_extract = not default_confirmed and intent in {"optimization_request", "parameter_supplement", "confirm_defaults"} and self.should_extract_parameters(message, intent, input_schema)
        if allow_extract:
            parameter_policy = {}
            if agent_skill_name:
                try:
                    parameter_policy = agent_skill_service.get_skill_local(agent_skill_name).get("parameter_policy") or {}
                except Exception:
                    parameter_policy = {}
            v2_extract = parameter_extractor_v2.extract(message, input_schema, parameter_policy, previous_draft, allow_llm=True)
            extracted = v2_extract["updates"]
            extract_meta = {
                "llm_timeout": v2_extract.get("llm_timeout", False),
                "fallback_mode": v2_extract.get("fallback_mode"),
                "llm_extract_ms": 0,
                "schema_fit_score": v2_extract.get("schema_fit_score", 0.0),
                "parameter_sources": v2_extract.get("parameter_sources") or {},
                "parameter_confidence": v2_extract.get("parameter_confidence") or {},
            }
        else:
            extracted = {}
        sample_run_requested = self._is_sample_run_request(message, intent)
        if sample_run_requested and input_schema and not extracted:
            extracted = self._sample_parameters({"input_schema": input_schema})
        timing["parameter_extract_ms"] = self._elapsed_ms(extract_started)
        timing["llm_extract_ms"] = int(extract_meta.get("llm_extract_ms") or 0)
        extracted = self._broadcast_scalars(extracted, input_schema, previous_draft)
        parameter_draft = self._deep_merge(previous_draft, extracted)
        analyze_started = time.perf_counter()
        analysis = invocation_service.analyze_parameters(input_schema, parameter_draft) if local_analysis_only else platform_client.analyze_input(resolved_skill_name, parameter_draft)
        timing["analyze_input_ms"] += self._elapsed_ms(analyze_started)
        if sample_run_requested and parameter_draft:
            analysis = self._mark_sample_values_pending_confirmation(analysis, input_schema, parameter_draft)

        analysis = self._normalize_analysis_labels(analysis, input_schema)
        parameter_sources = self._merge_sources(existing.get("parameter_sources") or {}, extracted, analysis)
        if sample_run_requested:
            for key in extracted:
                parameter_sources[key] = "SAMPLE_VALUE"
        if default_confirmed:
            parameter_draft, parameter_sources = self._apply_confirmed_defaults(parameter_draft, parameter_sources, analysis)
            analyze_started = time.perf_counter()
            analysis = invocation_service.analyze_parameters(input_schema, parameter_draft) if local_analysis_only else platform_client.analyze_input(resolved_skill_name, parameter_draft)
            analysis = self._normalize_analysis_labels(analysis, input_schema)
            timing["analyze_input_ms"] += self._elapsed_ms(analyze_started)

        ready = bool(parameter_draft) and not analysis.get("missing_required") and not analysis.get("invalid_parameters")
        requires_default = bool(analysis.get("requires_default_confirmation")) and not analysis.get("missing_required") and not analysis.get("invalid_parameters") and not default_confirmed
        if requires_default:
            ready = False
        workflow_state = self._workflow_state(ready, analysis, default_confirmed)
        agent_text = self._workflow_message(workflow_state, default_confirmed)
        conversation = conversation_store.upsert(
            conversation_id,
            {
                "agent_skill_name": agent_skill_name,
                "selected_skill": skill_name,
                "resolved_skill_name": resolved_skill_name,
                "model_id": skill.get("model_id"),
                "parameter_draft": parameter_draft,
                "parameter_sources": parameter_sources,
                "missing_required": analysis.get("missing_required", []),
                "invalid_parameters": analysis.get("invalid_parameters", []),
                "can_use_default": analysis.get("can_use_default", []),
                "last_questions": analysis.get("questions", []),
                "last_router_audit": router_result.get("audit"),
                "status": workflow_state,
                "last_response_type": "analysis",
                "messages": self._append_messages(existing.get("messages") or [], message, agent_text, default_confirmed),
                "recent_turns": self._recent_turns(existing, message, intent, "analysis", agent_text),
            },
        )
        response = {
            "conversation_id": conversation["conversation_id"],
            "mode": "optimize",
            "response_type": "analysis",
            "intent": intent,
            "router_result": router_result,
            "workflow_state": workflow_state,
            "status": workflow_state,
            "skill_name": skill_name,
            "agent_skill_name": agent_skill_name,
            "api_skill_name": resolved_skill_name,
            "selected_skill": manual_skill or None,
            "resolved_skill_name": resolved_skill_name,
            "model_id": skill.get("model_id"),
            "extracted_parameters": extracted,
            "normalized_parameters": analysis.get("normalized_parameters", parameter_draft),
            "parameter_draft": parameter_draft,
            "parameter_sources": parameter_sources,
            "missing_required": analysis.get("missing_required", []),
            "invalid_parameters": analysis.get("invalid_parameters", []),
            "can_use_default": analysis.get("can_use_default", []),
            "default_candidates": analysis.get("can_use_default", []),
            "requires_default_confirmation": requires_default,
            "questions": analysis.get("questions", []),
            "parameter_completeness": round(1 - len(analysis.get("missing_required", [])) / max(1, len([item for item in input_schema if item.get("required", True) is not False])), 4),
            "schema_fit_score": extract_meta.get("schema_fit_score", 0.0),
            "parameter_confidence": extract_meta.get("parameter_confidence", {}),
            "ready_to_invoke": ready,
            "llm_enabled": llm_service.enabled(),
            "messages": conversation.get("messages", []),
            "message": agent_text,
            "agent_message": agent_text,
            "llm_timeout": bool(extract_meta.get("llm_timeout")),
            "fallback_mode": extract_meta.get("fallback_mode"),
            "route_confidence": router_result.get("final_score", 0.0),
            "candidate_skills": router_result.get("candidate_skills", []),
            "selection_reason": router_result.get("selection_reason"),
            "needs_clarification": router_result.get("need_clarification", False),
            "clarification_question": router_result.get("clarification_question"),
            "audit": router_result.get("audit"),
        }
        return self._finalize_analyze_response(response, timing, started_at)

    def confirm_invoke(self, body: dict[str, Any]) -> dict[str, Any]:
        conversation_id = body.get("conversation_id")
        if not conversation_id:
            raise HTTPException(status_code=422, detail="conversation_id is required")
        conversation = self._existing_conversation(conversation_id)
        skill_name = conversation.get("resolved_skill_name") or conversation.get("selected_skill")
        if not skill_name:
            return {"conversation_id": conversation_id, "status": "NO_OPTIMIZATION_TASK", "message": "当前会话没有可调用的优化任务。"}
        parameters = conversation.get("parameter_draft") or {}
        if conversation.get("status") != "READY_TO_INVOKE":
            task_session = self._task_session_from_conversation(conversation)
            return {
                "conversation_id": conversation_id,
                "status": "PARAMETER_INCOMPLETE",
                "workflow_state": conversation.get("status") or "PARAM_COLLECTING",
                "message": "当前参数尚未就绪，不能调用模型。请先补充缺失参数。",
                "missing_required": conversation.get("missing_required") or [],
                "ready_to_invoke": False,
                "task_session": task_session,
            }
        input_schema: list[dict[str, Any]] = []
        try:
            input_schema = platform_client.get_skill(skill_name).get("input_schema") or []
        except Exception:
            agent_skill = self._agent_skill_for_api(skill_name)
            if agent_skill:
                try:
                    input_schema = agent_skill_service.get_skill_local(agent_skill).get("input_schema") or []
                except Exception:
                    input_schema = []
        analysis = platform_client.analyze_input(skill_name, parameters)
        analysis = self._normalize_analysis_labels(analysis, input_schema)
        if analysis.get("requires_default_confirmation") and analysis.get("can_use_default"):
            parameters, _ = self._apply_confirmed_defaults(parameters, conversation.get("parameter_sources") or {}, analysis)
            analysis = platform_client.analyze_input(skill_name, parameters)
            analysis = self._normalize_analysis_labels(analysis, input_schema)
        if not analysis.get("ready"):
            return {
                "conversation_id": conversation_id,
                "status": "PARAMETER_INCOMPLETE",
                "workflow_state": self._workflow_state(False, analysis, False),
                "missing_required": analysis.get("missing_required", []),
                "invalid_parameters": analysis.get("invalid_parameters", []),
                "requires_default_confirmation": bool(analysis.get("requires_default_confirmation")) and not analysis.get("missing_required") and not analysis.get("invalid_parameters"),
                "can_use_default": analysis.get("can_use_default", []),
                "questions": analysis.get("questions", []),
            }
        response = platform_client.run_skill(
            skill_name,
            analysis.get("normalized_parameters", parameters),
            {"mode": body.get("mode", "sync"), "explain": True, "strict_runtime_parameters": True},
        )
        agent_text = f"模型调用完成，状态：{response.get('status') or '-'}，目标值：{response.get('objective_value', '-')}。"
        conversation_store.upsert(
            conversation_id,
            {
                "parameter_draft": analysis.get("normalized_parameters", parameters),
                "last_invocation_id": response.get("invocation_id"),
                "last_result": response,
                "resolved_skill_name": skill_name,
                "model_id": response.get("model_id") or conversation.get("model_id"),
                "status": "RESULT_READY",
                "last_response_type": "invoke_result",
                "messages": self._append_messages(conversation.get("messages") or [], str(body.get("user_message") or ""), agent_text, False) if body.get("user_message") else conversation.get("messages", []),
            },
        )
        result = {
            "conversation_id": conversation_id,
            "invocation_id": response.get("invocation_id"),
            "task_id": response.get("task_id"),
            "status": response.get("status"),
            "workflow_state": "RESULT_READY",
            "result": response,
            "explanation": response.get("explanation") or response.get("suggestion"),
            "execution_policy": response.get("execution_policy", "advisory_only"),
            "requires_human_review": response.get("requires_human_review", True),
        }
        result["task_session"] = self._task_session_from_response(
            {
                **result,
                "response_type": "invoke_result",
                "agent_skill_name": conversation.get("agent_skill_name") or self._agent_skill_for_api(skill_name),
                "api_skill_name": skill_name,
                "parameter_draft": analysis.get("normalized_parameters", parameters),
                "parameter_sources": conversation.get("parameter_sources") or {},
                "ready_to_invoke": False,
            }
        )
        return result

    def apply_sample_parameters(self, body: dict[str, Any]) -> dict[str, Any]:
        conversation_id = body.get("conversation_id")
        agent_skill_name = body.get("agent_skill_name") or self._agent_skill_for_api(body.get("api_skill_name"))
        if not conversation_id:
            raise HTTPException(status_code=422, detail="conversation_id is required")
        if not agent_skill_name:
            raise HTTPException(status_code=422, detail="agent_skill_name is required")
        sample_parameters = body.get("sample_parameters") or {}
        if not isinstance(sample_parameters, dict):
            raise HTTPException(status_code=422, detail="sample_parameters must be an object")
        existing = self._existing_conversation(conversation_id)
        skill = agent_skill_service.get_skill_local(str(agent_skill_name))
        api_skill_name = str(skill.get("canonical_api_skill_name") or f"run_{agent_skill_name}")
        input_schema = skill.get("input_schema") or []
        if not sample_parameters:
            sample_parameters = self._sample_parameters({"input_schema": input_schema})
        parameter_sources = {key: "sample_only" for key in sample_parameters}
        return self._save_task_analysis(
            conversation_id,
            existing,
            str(agent_skill_name),
            api_skill_name,
            input_schema,
            sample_parameters,
            parameter_sources,
            "已使用示例参数创建任务。",
            "sample_applied",
        )

    def confirm_defaults(self, body: dict[str, Any]) -> dict[str, Any]:
        conversation_id = body.get("conversation_id")
        if not conversation_id:
            raise HTTPException(status_code=422, detail="conversation_id is required")
        existing = self._existing_conversation(conversation_id)
        if not self._has_active_optimization(existing):
            return {"conversation_id": conversation_id, "status": "NO_OPTIMIZATION_TASK", "message": "当前没有待确认默认值的优化任务。", "task_session": None}
        if existing.get("missing_required"):
            return {
                "conversation_id": conversation_id,
                "status": "PARAMETER_INCOMPLETE",
                "workflow_state": existing.get("status") or "PARAM_COLLECTING",
                "message": "当前仍有缺失必填参数，不能确认默认值。请先补充缺失参数。",
                "missing_required": existing.get("missing_required") or [],
                "ready_to_invoke": False,
                "task_session": self._task_session_from_conversation(existing),
            }
        api_skill_name = existing.get("resolved_skill_name") or existing.get("selected_skill")
        agent_skill_name = existing.get("agent_skill_name") or self._agent_skill_for_api(api_skill_name)
        input_schema = agent_skill_service.get_skill_local(str(agent_skill_name)).get("input_schema") if agent_skill_name else []
        analysis = platform_client.analyze_input(str(api_skill_name), existing.get("parameter_draft") or {})
        analysis = self._normalize_analysis_labels(analysis, input_schema or [])
        if analysis.get("missing_required"):
            conversation_store.upsert(conversation_id, {"missing_required": analysis.get("missing_required"), "status": "PARAM_COLLECTING"})
            return {
                "conversation_id": conversation_id,
                "status": "PARAMETER_INCOMPLETE",
                "workflow_state": "PARAM_COLLECTING",
                "message": "当前仍有缺失必填参数，不能确认默认值。请先补充缺失参数。",
                "missing_required": analysis.get("missing_required"),
                "ready_to_invoke": False,
                "task_session": self._task_session_from_conversation(self._existing_conversation(conversation_id)),
            }
        draft, sources = self._apply_confirmed_defaults(existing.get("parameter_draft") or {}, existing.get("parameter_sources") or {}, analysis)
        return self._save_task_analysis(
            conversation_id,
            existing,
            str(agent_skill_name),
            str(api_skill_name),
            input_schema or [],
            draft,
            sources,
            "默认值已确认，参数已就绪，可以确认调用。",
            "confirm_defaults",
        )

    def _save_task_analysis(
        self,
        conversation_id: str,
        existing: dict[str, Any],
        agent_skill_name: str,
        api_skill_name: str,
        input_schema: list[dict[str, Any]],
        parameter_draft: dict[str, Any],
        parameter_sources: dict[str, str],
        agent_text: str,
        response_type: str,
    ) -> dict[str, Any]:
        analysis = platform_client.analyze_input(api_skill_name, parameter_draft)
        analysis = self._normalize_analysis_labels(analysis, input_schema)
        missing = analysis.get("missing_required") or []
        invalid = analysis.get("invalid_parameters") or []
        defaults = analysis.get("can_use_default") or []
        ready = bool(parameter_draft) and not missing and not invalid and not defaults
        workflow_state = "PARAM_COLLECTING" if (missing or invalid) else ("DEFAULT_CONFIRMING" if defaults else "READY_TO_INVOKE")
        if workflow_state == "READY_TO_INVOKE":
            ready = True
        elif workflow_state == "DEFAULT_CONFIRMING":
            ready = False
        conversation = conversation_store.upsert(
            conversation_id,
            {
                "agent_skill_name": agent_skill_name,
                "selected_skill": api_skill_name,
                "resolved_skill_name": api_skill_name,
                "parameter_draft": parameter_draft,
                "parameter_sources": parameter_sources,
                "missing_required": missing,
                "invalid_parameters": invalid,
                "can_use_default": defaults,
                "last_questions": analysis.get("questions", []),
                "status": workflow_state,
                "last_response_type": response_type,
                "messages": self._append_messages(existing.get("messages") or [], "", agent_text, False),
                "recent_turns": self._recent_turns(existing, "", response_type, response_type, agent_text),
            },
        )
        response = {
            "conversation_id": conversation_id,
            "response_type": response_type,
            "mode": "optimize",
            "workflow_state": workflow_state,
            "status": workflow_state,
            "agent_skill_name": agent_skill_name,
            "api_skill_name": api_skill_name,
            "resolved_skill_name": api_skill_name,
            "parameter_draft": parameter_draft,
            "parameter_sources": parameter_sources,
            "missing_required": missing,
            "invalid_parameters": invalid,
            "can_use_default": defaults,
            "default_candidates": defaults,
            "requires_default_confirmation": workflow_state == "DEFAULT_CONFIRMING",
            "ready_to_invoke": ready,
            "message": agent_text,
            "agent_message": agent_text,
            "messages": conversation.get("messages", []),
        }
        response["task_session"] = self._task_session_from_response(response)
        return response

    def explain_result(self, body: dict[str, Any]) -> dict[str, Any]:
        conversation = self._existing_conversation(body.get("conversation_id"))
        explanation = {
            "summary": "优化结果已生成，可结合目标值、变量出力和约束校验复核。",
            "skill": self._safe_skill_context(conversation.get("resolved_skill_name")),
            "risk_notes": ["结果为辅助决策建议，执行前需要人工复核。"],
            "next_actions": ["复核输入参数、约束边界和业务解释。"],
        }
        return {
            "conversation_id": conversation.get("conversation_id"),
            "response_type": "result_explanation",
            "summary": explanation["summary"],
            "explanation": explanation,
            "message": self._format_explanation_text(explanation),
            "agent_message": self._format_explanation_text(explanation),
            "requires_human_review": True,
        }

    def optimize_legacy(self, body: Any) -> dict[str, Any]:
        payload = body.model_dump() if hasattr(body, "model_dump") else dict(body or {})
        text = str(payload.get("scenario") or payload.get("business_goal") or payload.get("goal") or payload.get("message") or "")
        skill_name = self._select_skill(text) or "run_economic_dispatch"
        result = platform_client.run_skill(skill_name, payload.get("runtime_parameters") or payload.get("parameters") or {}, {"mode": "sync", "explain": True, "use_sample_data": True})
        matched = skill_name[4:] if skill_name.startswith("run_") else skill_name
        result.setdefault("matched_scenario", matched)
        result.setdefault("summary", result.get("explanation") or (result.get("business_explanation") or {}).get("summary") or "")
        result.setdefault("forecast_inputs", payload.get("runtime_parameters") or payload.get("parameters") or {})
        return result

    def intent_router(self, message: str, existing: dict[str, Any] | None = None, body: dict[str, Any] | None = None) -> str:
        body = body or {}
        compact = "".join(str(message or "").strip().lower().split())
        if body.get("confirm_defaults") or body.get("use_defaults") or compact in {"确认使用默认值", "使用默认值", "默认值确认"}:
            return "confirm_defaults"
        if body.get("confirm_invoke") or compact in {"确认调用", "开始求解", "执行优化", "开始优化", "运行模型"}:
            return "confirm_invoke"
        if any(marker in compact for marker in ["解释结果", "解释上一次结果", "结果解释", "总结结果"]):
            return "result_explanation"
        if any(marker in compact for marker in ["参数示例", "样例参数", "示例参数"]):
            return "parameter_example"
        if any(marker in compact for marker in ["切换到", "换成"]):
            return "switch_skill"
        if any(marker in compact for marker in ["有没有", "支持吗", "能不能做", "是否支持"]):
            return "skill_availability_query"
        if self._select_skill(message) and any(marker in compact for marker in ["帮我", "做", "运行", "求解", "优化", "调度", "dispatch"]):
            return "optimization_request"
        if self._is_casual_chat(message):
            return "casual_chat"
        return "parameter_supplement" if (existing or {}).get("resolved_skill_name") else "chat"

    def should_extract_parameters(self, message: str, intent: str, input_schema: list[dict[str, Any]]) -> bool:
        if intent not in {"optimization_request", "parameter_supplement"}:
            return False
        text = str(message or "")
        if not text.strip():
            return False
        parameter_markers = [
            r"\d",
            r"\{.*\}",
            r"\[.*\]",
            r"[:：=]",
            r"\bU\d+\b",
            r"\bS\d+\b",
            r"MW|MWh|元|小时|时段|负荷\d|负荷[是为:：]|成本\d|成本[是为:：]|上限\d|下限\d|容量\d|SOC\s*\d|来水\d|库容\d|电价\d|热负荷\d",
            r"，|,|、",
        ]
        if any(re.search(pattern, text, re.IGNORECASE) for pattern in parameter_markers):
            return True
        schema_keys = [str(item.get("key") or "") for item in input_schema or []]
        return any(key and key in text for key in schema_keys)

    def _platform_is_test_unavailable(self) -> bool:
        return platform_client.base_url.rstrip("/").endswith(":1")

    def _elapsed_ms(self, started_at: float) -> int:
        return int((time.perf_counter() - started_at) * 1000)

    def _finalize_analyze_response(self, response: dict[str, Any], timing: dict[str, int], started_at: float) -> dict[str, Any]:
        timing["total_ms"] = self._elapsed_ms(started_at)
        response["timing"] = dict(timing)
        response.setdefault("task_session", self._task_session_from_response(response) if self._response_has_task(response) else None)
        return response

    def _response_has_task(self, response: dict[str, Any]) -> bool:
        if response.get("response_type") in {"chat", "how_to_use", "required_parameters_overview", "skill_selection_required"} and not response.get("agent_skill_name"):
            return False
        return bool(response.get("agent_skill_name") or response.get("api_skill_name") or response.get("resolved_skill_name") or response.get("parameter_draft"))

    def _task_session_from_response(self, response: dict[str, Any]) -> dict[str, Any]:
        conversation_id = response.get("conversation_id")
        agent_skill = response.get("agent_skill_name") or self._agent_skill_for_api(response.get("api_skill_name") or response.get("resolved_skill_name"))
        api_skill = response.get("api_skill_name") or response.get("resolved_skill_name") or response.get("skill_name")
        display_name = response.get("display_name") or self._display_name_for_agent_skill(agent_skill)
        workflow_state = response.get("workflow_state") or response.get("status") or "CHAT_IDLE"
        can_use_default = response.get("can_use_default") or response.get("default_candidates") or []
        draft = response.get("parameter_draft") or {}
        sources = response.get("parameter_sources") or {}
        return {
            "conversation_id": conversation_id,
            "task_session_id": response.get("task_session_id") or (f"TASK-{conversation_id}" if conversation_id else None),
            "agent_skill_name": agent_skill,
            "api_skill_name": api_skill,
            "display_name": display_name,
            "workflow_state": workflow_state,
            "parameter_draft": draft,
            "parameter_sources": sources,
            "missing_required": response.get("missing_required") or [],
            "invalid_parameters": response.get("invalid_parameters") or [],
            "default_candidates": can_use_default,
            "confirmed_defaults": {k: draft.get(k) for k, v in sources.items() if v == "default_confirmed" and k in draft},
            "ready_to_invoke": bool(response.get("ready_to_invoke")),
            "invocation_id": response.get("invocation_id"),
            "result": response.get("result"),
            "last_response_type": response.get("response_type"),
        }

    def _task_session_from_conversation(self, conversation: dict[str, Any]) -> dict[str, Any] | None:
        if not self._has_active_optimization(conversation):
            return None
        response = {
            "conversation_id": conversation.get("conversation_id"),
            "agent_skill_name": conversation.get("agent_skill_name") or self._agent_skill_for_api(conversation.get("resolved_skill_name")),
            "api_skill_name": conversation.get("resolved_skill_name") or conversation.get("selected_skill"),
            "resolved_skill_name": conversation.get("resolved_skill_name") or conversation.get("selected_skill"),
            "workflow_state": conversation.get("status") or "PARAM_COLLECTING",
            "status": conversation.get("status") or "PARAM_COLLECTING",
            "parameter_draft": conversation.get("parameter_draft") or {},
            "parameter_sources": conversation.get("parameter_sources") or {},
            "missing_required": conversation.get("missing_required") or [],
            "invalid_parameters": conversation.get("invalid_parameters") or [],
            "can_use_default": conversation.get("can_use_default") or [],
            "ready_to_invoke": conversation.get("status") == "READY_TO_INVOKE",
            "invocation_id": conversation.get("last_invocation_id"),
            "result": conversation.get("last_result"),
            "response_type": conversation.get("last_response_type") or "analysis",
        }
        return self._task_session_from_response(response)

    def _display_name_for_agent_skill(self, agent_skill_name: str | None) -> str | None:
        if not agent_skill_name:
            return None
        try:
            return agent_skill_service.get_skill_local(agent_skill_name).get("display_name") or agent_skill_name
        except Exception:
            return agent_skill_name

    def _workflow_state(self, ready: bool, analysis: dict[str, Any] | None, default_confirmed: bool) -> str:
        analysis = analysis or {}
        if analysis.get("missing_required") or analysis.get("invalid_parameters"):
            return "PARAM_COLLECTING"
        if ready:
            return "READY_TO_INVOKE"
        if analysis.get("can_use_default") and analysis.get("requires_default_confirmation") and not default_confirmed:
            return "DEFAULT_CONFIRMING"
        return "PARAM_COLLECTING"

    def _workflow_message(self, workflow_state: str, default_confirmed: bool) -> str:
        if workflow_state == "READY_TO_INVOKE":
            return "默认值已确认，参数已就绪，可以确认调用。" if default_confirmed else "参数已就绪，可以确认调用。"
        if workflow_state == "DEFAULT_CONFIRMING":
            return "已识别到优化任务，但部分参数需要确认是否使用默认值。"
        if default_confirmed:
            return "已识别到优化任务，但参数还不完整，请继续补充。"
        return "已识别到优化任务，但参数还不完整，请继续补充。"

    def _normalize_analysis_labels(self, analysis: dict[str, Any], input_schema: list[dict[str, Any]]) -> dict[str, Any]:
        labels = {
            str(item.get("key")): self._clean_parameter_name(str(item.get("key") or ""), item.get("name"))
            for item in input_schema or []
            if isinstance(item, dict) and item.get("key")
        }
        result = dict(analysis or {})
        for field in ("missing_required", "invalid_parameters", "can_use_default"):
            rows = []
            for item in result.get(field, []) or []:
                if not isinstance(item, dict):
                    rows.append(item)
                    continue
                key = str(item.get("key") or item.get("field") or "")
                clean = labels.get(key) or self._clean_parameter_name(key, item.get("name"))
                if clean:
                    item = {**item, "name": clean}
                rows.append(item)
            result[field] = rows
        return result

    def _clean_parameter_name(self, key: str, name: Any) -> str:
        text = str(name or "").strip()
        if key in PARAMETER_DISPLAY_NAMES:
            return PARAMETER_DISPLAY_NAMES[key]
        if not text or self._looks_like_mojibake(text) or self._looks_like_technical_english(text):
            return key
        return text

    def _looks_like_mojibake(self, text: str) -> bool:
        return any("\ue000" <= ch <= "\uf8ff" for ch in text)

    def _looks_like_technical_english(self, text: str) -> bool:
        return bool(re.search(r"[A-Za-z]", text)) and not re.search(r"[\u4e00-\u9fff]", text)

    def parameter_example_response(self, conversation_id: str | None, existing: dict[str, Any], message: str, skill_name: str | None = None) -> dict[str, Any]:
        api_skill = skill_name or existing.get("resolved_skill_name")
        agent_skill = self._agent_skill_for_api(api_skill) or api_skill or existing.get("agent_skill_name")
        if not agent_skill:
            return self._skill_selection_required(conversation_id, existing, message)
        payload = self._parameter_example_payload(str(agent_skill), {})
        api_name = payload.get("api_skill_name") or api_skill
        agent_text = payload.get("message") or "以下是参数示例。"
        preserve_task = self._has_active_optimization(existing)
        conversation = conversation_store.upsert(
            conversation_id,
            {
                "status": "HELP",
                "messages": self._append_messages(existing.get("messages") or [], message, agent_text, False),
                "recent_turns": self._recent_turns(existing, message, "parameter_example", "parameter_example", agent_text),
            },
        )
        response = self._chat_response(conversation, agent_text, preserve_task=preserve_task)
        response.update(payload)
        response.update(
            {
                "response_type": "parameter_example",
                "intent": "parameter_example",
                "ready_to_invoke": False,
                "parameter_draft": existing.get("parameter_draft") or {},
                "applied_to_task": False,
                "task_session": self._task_session_from_conversation(existing) if preserve_task else None,
            }
        )
        return response

    def get_parameter_example(self, skill_name: str) -> dict[str, Any]:
        return self._parameter_example_payload(skill_name, {})

    def _parameter_example_payload(self, skill_name: str, skill: dict[str, Any]) -> dict[str, Any]:
        agent_skill = self._agent_skill_for_api(skill_name) or (skill_name[4:] if skill_name.startswith("run_") else skill_name)
        try:
            payload = agent_skill_service.parameter_example(agent_skill)
            payload.setdefault("response_type", "parameter_example")
            return payload
        except Exception:
            api_skill = skill_name if skill_name.startswith("run_") else f"run_{skill_name}"
            api = platform_client.get_skill(api_skill)
            return {"response_type": "parameter_example", "agent_skill_name": agent_skill, "api_skill_name": api_skill, "sample_parameters": self._sample_parameters(api), "message": "以下是参数示例。"}

    def _switch_skill_response(self, conversation_id: str | None, existing: dict[str, Any], message: str, router_result: dict[str, Any] | None = None) -> dict[str, Any]:
        router_result = router_result or {}
        new_skill = router_result.get("api_skill_name") or (f"run_{router_result['agent_skill_name']}" if router_result.get("agent_skill_name") else None) or self._select_skill(message)
        if not new_skill:
            return self._skill_selection_required(conversation_id, existing, message)
        agent_text = "检测到你要切换优化场景。请选择确认清空、迁移参数或取消切换。"
        conversation = conversation_store.upsert(conversation_id, {"pending_switch": {"target_skill": new_skill, "target_agent_skill": router_result.get("agent_skill_name")}, "status": "SWITCH_CONFIRMING", "messages": self._append_messages(existing.get("messages") or [], message, agent_text, False), "recent_turns": self._recent_turns(existing, message, "switch_skill", "switch_skill_confirmation", agent_text)})
        return {**self._chat_response(conversation, agent_text, preserve_task=True), "response_type": "switch_skill_confirmation", "intent": "switch_skill", "pending_switch": conversation.get("pending_switch")}

    def _handle_switch_confirmation(self, conversation_id: str | None, existing: dict[str, Any], message: str, intent: str | None) -> dict[str, Any]:
        target = (existing.get("pending_switch") or {}).get("target_skill") or self._select_skill(message) or "run_storage_dispatch"
        if intent == "cancel_switch":
            conversation = conversation_store.upsert(conversation_id, {"pending_switch": None, "status": existing.get("status", "PARAM_COLLECTING"), "messages": self._append_messages(existing.get("messages") or [], message, "已取消切换。", False), "recent_turns": self._recent_turns(existing, message, intent or "cancel_switch", "chat", "已取消切换。")})
            return {**self._chat_response(conversation, "已取消切换。", preserve_task=True), "intent": intent}
        draft = {}
        dropped: list[str] = []
        if intent == "confirm_switch_migrate":
            draft, dropped = self._compatible_parameter_subset(existing.get("parameter_draft") or {}, existing.get("resolved_skill_name"), target)
        conversation = conversation_store.upsert(conversation_id, {"resolved_skill_name": target, "selected_skill": target, "agent_skill_name": self._agent_skill_for_api(target), "parameter_draft": draft, "parameter_sources": {}, "pending_switch": None, "status": "PARAM_COLLECTING", "messages": self._append_messages(existing.get("messages") or [], message, "已切换优化场景。", False), "recent_turns": self._recent_turns(existing, message, intent or "switch_skill", "switch_skill", "已切换优化场景。")})
        return {**self._chat_response(conversation, "已切换优化场景。", preserve_task=True), "intent": intent, "resolved_skill_name": target, "parameter_draft": draft, "dropped_parameters": dropped}

    def _compatible_parameter_subset(self, draft: dict[str, Any], from_api: str | None, to_api: str | None) -> tuple[dict[str, Any], list[str]]:
        try:
            keys = {item.get("key") for item in platform_client.get_skill(str(to_api)).get("input_schema", [])}
        except Exception:
            keys = set()
        kept = {k: v for k, v in (draft or {}).items() if k in keys}
        dropped = [k for k in (draft or {}) if k not in kept]
        return kept, dropped

    def _result_explanation_chat(self, conversation_id: str | None, existing: dict[str, Any], message: str) -> dict[str, Any]:
        explanation = {"summary": "结果解释已生成。", "skill": self._safe_skill_context(existing.get("resolved_skill_name")), "risk_notes": ["请关注约束边界和输入参数。"], "next_actions": ["复核结果后再执行。"]}
        agent_text = self._format_explanation_text(explanation)
        conversation = conversation_store.upsert(conversation_id, {"status": "RESULT_READY", "messages": self._append_messages(existing.get("messages") or [], message, agent_text, False), "recent_turns": self._recent_turns(existing, message, "result_explanation", "result_explanation", agent_text)})
        return {**self._chat_response(conversation, agent_text, preserve_task=True), "response_type": "result_explanation", "intent": "result_explanation", "explanation": explanation}

    def _how_to_use_response(self, conversation_id: str | None, existing: dict[str, Any], message: str) -> dict[str, Any]:
        agent_text = "\n".join(
            [
                "使用流程分 5 步：",
                "1. 选择场景：从经济调度、日前机组组合、储能调度、风光储协同、电热协同、梯级水电调度中选择。",
                "2. 提供参数：按场景补充负荷、机组、储能、水库、来水或价格等关键数据。",
                "3. 确认默认值：系统会列出可用默认值，确认后才会写入参数草稿。",
                "4. 确认调用：参数齐全后再明确确认调用优化模型。",
                "5. 查看结果解释 / 方案对比：读取目标值、关键变量、风险提示和后续动作。",
            ]
        )
        conversation = conversation_store.upsert(conversation_id, {"status": "HELP", "messages": self._append_messages(existing.get("messages") or [], message, agent_text, False), "recent_turns": self._recent_turns(existing, message, "how_to_use", "how_to_use", agent_text)})
        response = self._chat_response(conversation, agent_text, preserve_task=True)
        response.update({"response_type": "how_to_use", "intent": "how_to_use", "workflow_state": "HELP", "status": "HELP"})
        return response

    def _required_parameters_response(self, conversation_id: str | None, existing: dict[str, Any], message: str, agent_skill_name: str | None) -> dict[str, Any]:
        if not agent_skill_name:
            skills = [s for s in agent_skill_service.list_skills() if s.get("enabled", True)]
            summaries = []
            for skill in skills:
                summaries.append({"agent_skill_name": skill.get("name"), "display_name": skill.get("display_name") or skill.get("name"), "required_parameters": skill.get("required_parameters") or []})
            agent_text = "当前可用场景及核心参数摘要：\n" + "\n".join(
                f"- {item['display_name']}：{('、'.join(item['required_parameters'][:6]) or '无')}{'...' if len(item['required_parameters']) > 6 else ''}"
                for item in summaries
            )
            conversation = conversation_store.upsert(conversation_id, {"status": "HELP", "messages": self._append_messages(existing.get("messages") or [], message, agent_text, False), "recent_turns": self._recent_turns(existing, message, "explain_required_parameters", "required_parameters_overview", agent_text)})
            response = self._chat_response(conversation, agent_text, preserve_task=False)
            response.update({"response_type": "required_parameters_overview", "intent": "explain_required_parameters", "available_scenarios": summaries, "workflow_state": "HELP", "status": "HELP"})
            return response

        skill = agent_skill_service.get_skill_local(agent_skill_name)
        input_schema = skill.get("input_schema") or []
        required_keys = set(skill.get("required_parameters") or [])
        optional_keys = set(skill.get("optional_parameters") or [])
        required = [item for item in input_schema if item.get("required", True) or item.get("key") in required_keys]
        optional = [item for item in input_schema if not item.get("required", True) or item.get("key") in optional_keys]
        display_name = skill.get("display_name") or agent_skill_name
        agent_text = f"{display_name} 的参数清单如下：\n必填参数：" + "、".join(item.get("name") or item.get("key") for item in required)
        if optional:
            agent_text += "\n可选参数：" + "、".join(item.get("name") or item.get("key") for item in optional)
        conversation = conversation_store.upsert(
            conversation_id,
            {
                "agent_skill_name": agent_skill_name,
                "resolved_skill_name": skill.get("canonical_api_skill_name") or existing.get("resolved_skill_name"),
                "selected_skill": skill.get("canonical_api_skill_name") or existing.get("selected_skill"),
                "status": "HELP",
                "messages": self._append_messages(existing.get("messages") or [], message, agent_text, False),
                "recent_turns": self._recent_turns(existing, message, "explain_required_parameters", "required_parameters", agent_text),
            },
        )
        response = self._chat_response(conversation, agent_text, preserve_task=True)
        response.update(
            {
                "response_type": "required_parameters",
                "intent": "explain_required_parameters",
                "agent_skill_name": agent_skill_name,
                "api_skill_name": skill.get("canonical_api_skill_name"),
                "display_name": display_name,
                "required_parameters": required,
                "optional_parameters": optional,
                "ready_to_invoke": False,
            }
        )
        return response

    def _skill_list_text(self) -> str:
        try:
            names = [s.get("display_name") or s.get("name") for s in agent_skill_service.list_skills() if s.get("enabled", True)]
            return "、".join(str(name) for name in names if name) or "经济调度、储能调度、机组组合"
        except Exception:
            return "经济调度、储能调度、机组组合"

    def _skill_availability_response(self, conversation_id: str | None, existing: dict[str, Any], message: str, agent_skill_name: str | None) -> dict[str, Any]:
        if agent_skill_name:
            skill = agent_skill_service.get_skill_local(agent_skill_name)
            api_skill_name = skill.get("canonical_api_skill_name")
            display_name = skill.get("display_name") or agent_skill_name
            description = skill.get("description") or "该模型用于流域梯级电站在来水、负荷、水库容量、流量边界和电站拓扑约束下的调度优化。"
            agent_text = f"有的。当前平台支持{display_name}模型，对应 Agent Skill 为 {agent_skill_name}，API Skill 为 {api_skill_name}。{description}"
            conversation = conversation_store.upsert(
                conversation_id,
                {
                    "agent_skill_name": agent_skill_name,
                    "selected_skill": api_skill_name,
                    "resolved_skill_name": api_skill_name,
                    "status": "HELP",
                    "messages": self._append_messages(existing.get("messages") or [], message, agent_text, False),
                    "recent_turns": self._recent_turns(existing, message, "skill_availability_query", "skill_availability", agent_text),
                },
            )
            response = self._chat_response(conversation, agent_text, preserve_task=True)
            response.update(
                {
                    "response_type": "skill_availability",
                    "intent": "skill_availability_query",
                    "agent_skill_name": agent_skill_name,
                    "api_skill_name": api_skill_name,
                    "display_name": display_name,
                    "description": description,
                    "skill_available": True,
                    "suggested_actions": ["查看参数清单", "查看参数示例", f"开始{display_name}"],
                    "workflow_state": "HELP",
                    "status": "HELP",
                }
            )
            return response
        agent_text = f"暂未命中你询问的模型。当前可用优化场景包括：{self._skill_list_text()}。"
        conversation = conversation_store.upsert(conversation_id, {"status": "HELP", "messages": self._append_messages(existing.get("messages") or [], message, agent_text, False), "recent_turns": self._recent_turns(existing, message, "skill_availability_query", "skill_availability", agent_text)})
        return {**self._chat_response(conversation, agent_text, preserve_task=True), "response_type": "skill_availability", "intent": "skill_availability_query", "agent_skill_name": None, "skill_available": False, "available_scenarios": self._skill_list_text()}

    def _skill_selection_required(self, conversation_id: str | None, existing: dict[str, Any], message: str) -> dict[str, Any]:
        agent_text = f"请先选择要执行的优化场景：{self._skill_list_text()}。"
        if self._last_agent_message(existing) == agent_text:
            agent_text = f"请先选择具体场景，或直接说“我需要提供哪些参数”。当前可用场景：{self._skill_list_text()}。"
        conversation = conversation_store.upsert(conversation_id, {"status": "HELP", "messages": self._append_messages(existing.get("messages") or [], message, agent_text, False), "recent_turns": self._recent_turns(existing, message, "skill_selection_required", "skill_selection_required", agent_text)})
        return {**self._chat_response(conversation, agent_text, preserve_task=True), "response_type": "skill_selection_required", "intent": "skill_selection_required", "workflow_state": "HELP", "status": "HELP"}

    def _resolve_api_skill_name(self, skill_name: str, prefer_custom: bool = False) -> str:
        if not skill_name:
            return skill_name
        skills = platform_client.list_skills()
        if prefer_custom and skill_name == "run_economic_dispatch":
            custom_economic_skills = [
                item
                for item in skills
                if not str(item.get("model_id") or "").startswith("MODEL-POWER-")
                and self._is_economic_dispatch_skill(item)
            ]
            if custom_economic_skills:
                custom_economic_skills.sort(
                    key=lambda item: (
                        str(item.get("updated_at") or item.get("published_at") or ""),
                        str(item.get("skill_name") or ""),
                    ),
                    reverse=True,
                )
                return str(custom_economic_skills[0].get("skill_name") or skill_name)
        matches = [
            item
            for item in skills
            if item.get("skill_name") == skill_name or skill_name in (item.get("skill_aliases") or [])
        ]
        if not matches:
            return skill_name
        if prefer_custom:
            matches.sort(key=lambda item: (str(item.get("model_id") or "").startswith("MODEL-POWER-"), str(item.get("skill_name") or "")))
        else:
            matches.sort(key=lambda item: (not str(item.get("model_id") or "").startswith("MODEL-POWER-"), str(item.get("skill_name") or "")))
        return str(matches[0].get("skill_name") or skill_name)

    @staticmethod
    def _is_economic_dispatch_skill(skill: dict[str, Any]) -> bool:
        searchable = " ".join(
            str(skill.get(key) or "")
            for key in ("skill_name", "display_name", "name", "description", "model_code")
        ).lower()
        return any(marker in searchable for marker in ("经济调度", "economic dispatch", "economic_dispatch"))

    def _select_skill(self, message: str) -> str | None:
        compact = "".join(str(message or "").lower().split())
        if any(key in compact for key in ["售电公司日前现货申报", "售电日前现货申报", "日前现货申报", "日前现货"]):
            return "run_retail_da_spot_bidding_v1"
        if any(key in compact for key in ["合约现货暴露控制", "合约现货暴露", "现货暴露控制", "中长期合约分解"]):
            return "run_contract_spot_exposure_v1"
        if any(key in compact for key in ["光储日前调度", "光伏储能日前"]):
            return "run_pv_storage_day_ahead_dispatch"
        if any(
            key in compact
            for key in [
                "光储日内滚动调度",
                "光储日内滚动优化",
                "光储实时滚动调度",
                "光储协同日内调度",
                "光储日内滚动",
                "光储实时滚动",
                "光储日内调度",
                "光伏储能日内",
            ]
        ):
            return "run_pv_storage_intraday_dispatch"
        if any(key in compact for key in ["光储调度v2", "光储v2"]):
            return "run_pv_storage_dispatch_v2"
        if any(key in compact for key in ["非线性水电", "nlp水电", "ipopt水电"]):
            return "run_nonlinear_hydro_power_demo"
        if any(key in compact for key in ["经济", "economic"]):
            return "run_economic_dispatch"
        if any(key in compact for key in ["日前机组组合", "机组组合", "机组启停", "unitcommitment"]):
            return "run_unit_commitment_day_ahead"
        if any(key in compact for key in ["储能", "峰谷", "storage"]):
            return "run_storage_dispatch"
        if any(key in compact for key in ["水电", "cascade"]):
            return "run_cascade_hydro_dispatch"
        if any(key in compact for key in ["风光储", "新能源"]):
            return "run_renewable_storage_dispatch"
        if any(key in compact for key in ["电热", "chp"]):
            return "run_chp_dispatch"
        return None

    def _is_casual_chat(self, message: str) -> bool:
        compact = "".join(str(message or "").strip().lower().split())
        if not compact:
            return True
        if self._select_skill(message):
            return False
        return compact in {"你好", "您好", "hi", "hello", "hey", "在吗"} or any(key in compact for key in ["能做什么", "怎么使用", "帮助"])

    def _has_active_optimization(self, conversation: dict[str, Any]) -> bool:
        return bool(conversation.get("resolved_skill_name") or conversation.get("selected_skill") or conversation.get("parameter_draft"))

    def _chat_only(self, conversation_id: str | None, existing: dict[str, Any], message: str, preserve_task: bool = False) -> dict[str, Any]:
        agent_text = self._rule_chat_reply(message)
        if self._last_agent_message(existing) == agent_text:
            agent_text = "换一种方式说：你可以先选择一个业务场景，也可以直接描述目标和参数；如果不确定，就问“我需要提供哪些参数”。"
        values = {"status": existing.get("status", "CHAT_IDLE") if preserve_task else "CHAT_IDLE", "messages": self._append_messages(existing.get("messages") or [], message, agent_text, False), "recent_turns": self._recent_turns(existing, message, "chat", "chat", agent_text)}
        if not preserve_task:
            values.update({"parameter_draft": {}, "parameter_sources": {}, "missing_required": [], "last_questions": [], "resolved_skill_name": None, "selected_skill": None, "model_id": None})
        conversation = conversation_store.upsert(conversation_id, values)
        return self._chat_response(conversation, agent_text, preserve_task=preserve_task)

    def _chat_response(self, conversation: dict[str, Any], agent_text: str, preserve_task: bool = False) -> dict[str, Any]:
        return {
            "conversation_id": conversation["conversation_id"],
            "mode": "chat",
            "response_type": "chat",
            "message": agent_text,
            "agent_message": agent_text,
            "selected_skill": conversation.get("selected_skill") if preserve_task else None,
            "resolved_skill_name": conversation.get("resolved_skill_name") if preserve_task else None,
            "model_id": conversation.get("model_id") if preserve_task else None,
            "extracted_parameters": {},
            "normalized_parameters": {},
            "parameter_draft": conversation.get("parameter_draft", {}) if preserve_task else {},
            "parameter_sources": conversation.get("parameter_sources", {}) if preserve_task else {},
            "missing_required": conversation.get("missing_required", []) if preserve_task else [],
            "invalid_parameters": [],
            "can_use_default": [],
            "requires_default_confirmation": False,
            "questions": [],
            "ready_to_invoke": False,
            "llm_enabled": llm_service.enabled(),
            "messages": conversation.get("messages", []),
            "workflow_state": conversation.get("status", "CHAT_IDLE"),
            "status": conversation.get("status", "CHAT_IDLE"),
        }

    def _policy_chat_response(
        self,
        conversation_id: str | None,
        existing: dict[str, Any],
        message: str,
        agent_text: str,
        intent: str,
        router_result: dict[str, Any],
    ) -> dict[str, Any]:
        conversation = conversation_store.upsert(
            conversation_id,
            {
                "status": "CLARIFICATION_REQUIRED" if intent == "clarification_required" else "CHAT",
                "last_response_type": intent,
                "messages": self._append_messages(existing.get("messages") or [], message, agent_text, False),
                "recent_turns": self._recent_turns(existing, message, intent, intent, agent_text),
                "last_router_audit": router_result.get("audit"),
            },
        )
        return {
            **self._chat_response(conversation, agent_text, preserve_task=self._has_active_optimization(existing)),
            "intent": intent,
            "response_type": intent,
            "workflow_state": "CLARIFICATION_REQUIRED" if intent == "clarification_required" else "CHAT",
            "router_result": router_result,
            "route_confidence": router_result.get("final_score", 0.0),
            "candidate_skills": router_result.get("candidate_skills", []),
            "selection_reason": router_result.get("selection_reason"),
            "needs_clarification": bool(router_result.get("need_clarification")),
            "clarification_question": router_result.get("clarification_question"),
            "ready_to_invoke": False,
        }

    def _platform_unavailable_response(self, conversation_id: str | None, existing: dict[str, Any], message: str, api_skill_name: str | None = None, agent_skill_name: str | None = None) -> dict[str, Any]:
        agent_text = "Agent 服务在线，但无法连接运筹优化平台，暂不能调用模型。请检查平台服务地址、Token 和服务状态。"
        agent_skill_name = agent_skill_name or self._agent_skill_for_api(api_skill_name)
        conversation = conversation_store.upsert(
            conversation_id,
            {
                "agent_skill_name": agent_skill_name or existing.get("agent_skill_name"),
                "selected_skill": api_skill_name or existing.get("selected_skill"),
                "resolved_skill_name": api_skill_name or existing.get("resolved_skill_name"),
                "status": "PLATFORM_UNAVAILABLE",
                "messages": self._append_messages(existing.get("messages") or [], message, agent_text, False),
                "recent_turns": self._recent_turns(existing, message, "optimization_request", "platform_unavailable", agent_text),
            },
        )
        response = self._chat_response(conversation, agent_text, preserve_task=bool(agent_skill_name or api_skill_name))
        response.update({"response_type": "platform_unavailable", "intent": "optimization_request", "agent_skill_name": agent_skill_name, "api_skill_name": api_skill_name, "workflow_state": "PLATFORM_UNAVAILABLE", "status": "PLATFORM_UNAVAILABLE"})
        return response

    def _rule_chat_reply(self, message: str) -> str:
        compact = "".join(str(message or "").strip().lower().split())
        if any(key in compact for key in ["能做什么", "怎么使用", "帮助"]):
            return "我可以通过 Skill 帮你完成经济调度、储能调度、机组组合等优化任务。"
        return "你好，我是运筹优化 Agent。你可以描述要优化的业务场景、参数和目标。"

    def _demo_question_response(self, conversation_id: str | None, existing: dict[str, Any], message: str) -> dict[str, Any] | None:
        compact = "".join(str(message or "").strip().lower().split())
        if not compact:
            return None
        hydro_keys = ["水电", "梯级", "milp", "弃水", "库容", "出力最高", "三角形", "函数资产", "水量平衡"]
        nlp_keys = ["nlp", "ipopt", "全局最优", "局部最优", "minlp", "piecewise", "mccormick", "非线性"]
        if not any(key in compact for key in hydro_keys + nlp_keys):
            return None
        if any(marker in compact for marker in ["帮我", "运行", "开始求解", "执行优化", "优化一下", "调度计划"]):
            return None
        if compact.startswith("没有") or ("没有" in compact and "吗" in compact):
            return None
        if any(key in compact for key in nlp_keys):
            agent_text = self._answer_nlp_demo_question(compact, existing)
        else:
            agent_text = self._answer_hydro_demo_question(compact, existing)
        conversation = conversation_store.upsert(
            conversation_id,
            {
                "status": "HELP",
                "messages": self._append_messages(existing.get("messages") or [], message, agent_text, False),
                "recent_turns": self._recent_turns(existing, message, "demo_question", "demo_answer", agent_text),
            },
        )
        response = self._chat_response(conversation, agent_text, preserve_task=True)
        response.update({"response_type": "demo_answer", "intent": "demo_question", "workflow_state": "HELP", "status": "HELP"})
        return response

    def _answer_hydro_demo_question(self, compact: str, existing: dict[str, Any]) -> str:
        templates = get_power_templates()
        hydro_models = [templates[key] for key in ["cascade_hydro_dispatch", "cascade_hydro_dispatch_v1"] if key in templates]
        assets = {asset.function_id: asset for asset in function_asset_service.list_assets()}
        last_result = existing.get("last_result") or {}
        business_output = last_result.get("business_output") or {}
        metrics = last_result.get("metrics") or {}
        if "哪些" in compact and "模型" in compact:
            return "当前水电调度模型包括：" + "；".join(f"{item.get('code')}（{item.get('name')}，{item.get('model_problem_type') or item.get('problem_type')} / {item.get('solver', 'HiGHS')}）" for item in hydro_models)
        if "为什么" in compact and "milp" in compact:
            return "水电 PWL 标杆模型是 MILP，因为水量平衡等主体约束为线性，1D/2D PWL 曲线通过 piecewise_1d、piecewise_2d 和 triangulated_milp_exact 转换为线性约束，并引入二进制三角选择变量；因此交给 HiGHS 求解。"
        if "函数资产" in compact:
            names = [f"{key}（{assets[key].name}）" for key in ["cascade_hydro_level_storage_v1", "cascade_hydro_tailwater_outflow_v1", "cascade_hydro_power_surface_v1"] if key in assets]
            return "水电演示使用的函数资产包括：" + ("；".join(names) if names else "当前函数资产中心未返回水电演示资产。")
        if "三角形" in compact:
            asset = assets.get("cascade_hydro_power_surface_v1")
            count = len(asset.triangles or []) if asset else None
            return f"二维出力曲面 cascade_hydro_power_surface_v1 当前三角形数量为 {count}。" if count is not None else "当前函数资产中心未返回二维出力曲面的三角形数量。"
        if any(key in compact for key in ["总发电量", "弃水", "出力最高", "期末库容", "水量平衡", "外推"]):
            if not last_result:
                return "当前尚未选择任务或该任务尚未产生结果。"
            if "总发电量" in compact:
                return f"当前任务总发电量为 {metrics.get('total_generation_MWh', '结果未返回该指标')}。"
            if "弃水" in compact:
                spill_rows = business_output.get("spill_curve") or []
                periods = [str(row.get("time")) for row in spill_rows if isinstance(row, dict) and float(row.get("spill") or 0) > 1e-6]
                return "出现弃水的时段：" + ("、".join(periods) if periods else "当前结果未返回弃水时段或无明显弃水。")
            if "期末库容" in compact:
                return f"期末库容偏差为 {metrics.get('terminal_storage_deviation', metrics.get('total_terminal_volume_deviation', '结果未返回该指标'))}。"
            if "水量平衡" in compact:
                rows = business_output.get("water_balance_check") or []
                bad = [row for row in rows if isinstance(row, dict) and abs(float(row.get("balance_error") or 0)) > 1e-5]
                return "水量平衡满足。" if rows and not bad else "当前结果未返回水量平衡明细，或存在需要复核的 balance_error。"
        return "梯级水电演示基于真实模板、函数资产诊断和任务结果回答；没有任务结果时，我会明确说明当前尚未选择任务或该任务尚未产生结果。"

    def _answer_nlp_demo_question(self, compact: str, existing: dict[str, Any]) -> str:
        templates = get_power_templates()
        nlp_template = templates.get("nonlinear_hydro_power_demo") or {}
        status = solver_status()
        ipopt = status.get("ipopt") or {}
        if "minlp" in compact or "整数变量" in compact:
            return "当前平台不把 MINLP_RESERVED 作为生产级能力开放。含整数变量的非线性模型不能直接用 Ipopt，因为 Ipopt 面向连续变量 NLP；建议改用 PWL 或 McCormick 线性化。"
        if "是否支持" in compact and "nlp" in compact:
            return "当前平台 NLP / Ipopt 已支持真实求解接入，适用于连续变量非线性模型；结果不承诺全局最优。"
        if "ipopt" in compact and "可用" in compact:
            return f"Ipopt 当前{'可用' if ipopt.get('available') else '不可用'}；路径：{ipopt.get('path') or '-'}；版本：{ipopt.get('version') or '-'}；提示：{ipopt.get('message') or '-'}。"
        if "nonlinear_hydro_power_demo" in compact or ("什么" in compact and "模型" in compact):
            return f"nonlinear_hydro_power_demo 是 {nlp_template.get('name', '非线性水电出力 NLP 演示模型')}，问题类型 NLP，求解器 Ipopt，核心关系是 power = k * flow * head。"
        if "为什么" in compact and "ipopt" in compact:
            return "该模型包含 power = k * flow * head 这类连续变量乘积关系，未通过 PWL/McCormick 线性化，因此需要 Ipopt 处理原生非线性 NLP。"
        if "全局最优" in compact or "局部最优" in compact:
            return "Ipopt 求解结果不是全局最优承诺。平台口径是：NLP / Ipopt 已支持真实求解，但通常返回局部最优或求解器终止状态，需要关注初值、上下界和约束违反摘要。"
        if "2dpwl" in compact or "piecewise" in compact:
            return "NLP 是原生非线性求解，保留 power = k * flow * head 等表达式并使用 Ipopt；2D PWL 是把二维曲面离散为三角面片并转成 MILP，通常交给 HiGHS。"
        if "mccormick" in compact or "不用nlp" in compact:
            return "如果不用 NLP，可以根据关系形态改用 piecewise_1d、piecewise_2d 或 McCormick 线性化，把问题转成 LP/MILP 后用 HiGHS；这会带来近似、松弛或规模上的边界。"
        if "失败" in compact or "排查" in compact:
            return "NLP 求解失败通常检查：Ipopt 是否可用、变量上下界是否完整、初值是否合理、模型尺度是否过大、约束违反摘要和 termination_condition。"
        return "NLP / Ipopt 已支持真实求解；结果不承诺全局最优；MINLP_RESERVED 不作为生产级能力开放。"

    def _no_active_task_response(self, conversation_id: str | None, existing: dict[str, Any], message: str, intent: str) -> dict[str, Any]:
        agent_text = "当前没有待确认默认值的优化任务。" if intent == "confirm_defaults" else "当前会话没有可调用的优化任务。"
        conversation = conversation_store.upsert(conversation_id, {"status": "NO_OPTIMIZATION_TASK", "messages": self._append_messages(existing.get("messages") or [], message, agent_text, False)})
        return {**self._chat_response(conversation, agent_text, preserve_task=False), "response_type": intent, "intent": intent, "workflow_state": "NO_OPTIMIZATION_TASK", "status": "NO_OPTIMIZATION_TASK"}

    def _sample_parameters(self, skill: dict[str, Any]) -> dict[str, Any]:
        params: dict[str, Any] = {}
        for item in skill.get("input_schema", []) or []:
            value = item.get("sample_value", item.get("default_value"))
            if value is not None and item.get("key"):
                params[item["key"]] = value
        return params

    def _is_sample_run_request(self, message: str, intent: str) -> bool:
        compact = "".join(str(message or "").strip().lower().split())
        if intent != "optimization_request":
            return False
        return any(key in compact for key in ["示例参数", "样例参数", "sample"]) and any(key in compact for key in ["跑", "运行", "调用", "求解", "优化", "run"])

    def _mark_sample_values_pending_confirmation(self, analysis: dict[str, Any], input_schema: list[dict[str, Any]], parameter_draft: dict[str, Any]) -> dict[str, Any]:
        result = dict(analysis or {})
        schema_by_key = {str(item.get("key")): item for item in input_schema or [] if item.get("key")}
        candidates = []
        for key, value in parameter_draft.items():
            item = schema_by_key.get(str(key), {})
            candidates.append({"key": key, "name": item.get("name") or key, "value": value, "source": "SAMPLE_VALUE"})
        existing = result.get("can_use_default") or []
        result["can_use_default"] = existing or candidates
        result["requires_default_confirmation"] = True
        result["ready"] = False
        return result

    def _existing_conversation(self, conversation_id: str | None) -> dict[str, Any]:
        if not conversation_id:
            return {}
        try:
            return conversation_store.get(conversation_id)
        except HTTPException:
            return {}

    def _broadcast_scalars(self, extracted: dict[str, Any], input_schema: list[dict[str, Any]], reference_draft: dict[str, Any]) -> dict[str, Any]:
        unit_keys: list[str] = []
        for value in (reference_draft or {}).values():
            if isinstance(value, dict):
                unit_keys = list(value.keys())
                break
        if not unit_keys:
            for value in extracted.values():
                if isinstance(value, dict):
                    unit_keys = list(value.keys())
                    break
        if not unit_keys:
            storage_scalar_keys = {"storage_capacity", "charge_power_max", "discharge_power_max", "charge_efficiency", "discharge_efficiency", "initial_soc", "soc_min"}
            if set(extracted).intersection(storage_scalar_keys):
                for item in input_schema or []:
                    sample = item.get("sample_value") or item.get("default_value")
                    if isinstance(sample, dict) and sample:
                        unit_keys = list(sample.keys())
                        break
        if not unit_keys:
            return extracted
        schema = {item.get("key"): item for item in input_schema}
        result: dict[str, Any] = {}
        for key, value in extracted.items():
            sample = (schema.get(key) or {}).get("sample_value") or (schema.get(key) or {}).get("default_value")
            result[key] = {unit: value for unit in unit_keys} if isinstance(value, (int, float)) and isinstance(sample, dict) else value
        return result

    def _deep_merge(self, base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
        result = dict(base or {})
        for key, value in (override or {}).items():
            result[key] = self._deep_merge(result[key], value) if isinstance(value, dict) and isinstance(result.get(key), dict) else value
        return result

    def _merge_sources(self, previous_sources: dict[str, Any], extracted: dict[str, Any], analysis: dict[str, Any]) -> dict[str, str]:
        sources = dict(previous_sources or {})
        for key in extracted:
            sources[key] = "user_provided"
        for key, source in (analysis.get("parameter_sources") or {}).items():
            if key not in sources:
                sources[key] = "default_suggested" if str(source).upper() in {"DEFAULT_VALUE", "SAMPLE_VALUE"} else str(source)
        return sources

    def _apply_confirmed_defaults(self, draft: dict[str, Any], sources: dict[str, str], analysis: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
        normalized = analysis.get("normalized_parameters") or {}
        result = dict(draft or {})
        out_sources = dict(sources or {})
        for item in analysis.get("can_use_default", []) or []:
            key = item.get("key")
            if key and key in normalized and key not in result:
                result[key] = normalized[key]
            if key and key in result:
                out_sources[key] = "default_confirmed"
        return result, out_sources

    def _safe_skill_context(self, skill_name: str | None) -> dict[str, Any]:
        if not skill_name:
            return {}
        try:
            skill = platform_client.get_skill(skill_name)
        except Exception:
            return {"skill_name": skill_name}
        return {"skill_name": skill.get("skill_name") or skill_name, "display_name": skill.get("display_name") or skill.get("name"), "model_id": skill.get("model_id"), "description": skill.get("description") or skill.get("business_description")}

    def _agent_skill_for_api(self, api_skill_name: str | None) -> str | None:
        if not api_skill_name:
            return None
        raw = str(api_skill_name)
        if raw.startswith("run_"):
            raw = raw[4:]
        for base in [
            "economic_dispatch",
            "storage_dispatch",
            "unit_commitment_day_ahead",
            "cascade_hydro_dispatch_v1",
            "cascade_hydro_dispatch",
            "renewable_storage_dispatch",
            "chp_dispatch",
            "pv_storage_day_ahead_dispatch_v2",
            "pv_storage_intraday_dispatch_v2",
            "pv_storage_dispatch_v2",
            "pv_storage_day_ahead_dispatch",
            "pv_storage_intraday_dispatch",
            "nonlinear_hydro_power_demo",
            "contract_spot_exposure_v1",
            "retail_da_spot_bidding_v1",
        ]:
            if raw == base or raw.startswith(f"{base}_"):
                return base
        return raw

    def _agent_skill_for_select_skill(self, api_skill_name: str | None) -> str | None:
        return self._agent_skill_for_api(api_skill_name)

    def _format_explanation_text(self, explanation: dict[str, Any]) -> str:
        parts = [str(explanation.get("summary") or "优化结果解释已生成。")]
        if explanation.get("risk_notes"):
            parts.append("风险提示：" + "；".join(str(item) for item in explanation["risk_notes"]))
        if explanation.get("next_actions"):
            parts.append("下一步动作：" + "；".join(str(item) for item in explanation["next_actions"]))
        return "\n".join(parts)

    def _last_agent_message(self, existing: dict[str, Any]) -> str:
        for item in reversed(existing.get("messages") or []):
            if item.get("role") == "agent":
                return str(item.get("text") or "")
        return ""

    def _recent_turns(self, existing: dict[str, Any], user_message: str, intent: str, response_type: str, agent_text: str) -> list[dict[str, Any]]:
        signature = " ".join(str(agent_text or "").split())[:160]
        rows = list(existing.get("recent_turns") or [])
        rows.append(
            {
                "user_message": user_message,
                "intent": intent,
                "response_type": response_type,
                "message_signature": signature,
            }
        )
        return rows[-3:]

    def _append_messages(self, messages: list[dict[str, Any]], user_message: str, agent_text: str, default_confirmed: bool) -> list[dict[str, Any]]:
        text = "确认使用默认值" if default_confirmed else user_message
        rows = list(messages or [])
        if text:
            rows.append({"role": "user", "text": text})
        rows.append({"role": "agent", "text": agent_text})
        return rows[-50:]


agent_orchestrator = AgentOrchestrator()
