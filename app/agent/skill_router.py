from __future__ import annotations

from typing import Any


HOW_TO_USE_MARKERS = ["我该怎么用", "怎么使用", "这个平台怎么用", "怎么开始", "使用流程是什么"]
HELP_MARKERS = ["参数示例", "样例参数", "给我一个参数", "怎么填写", "怎么填参数"]
REQUIRED_MARKERS = [
    "我需要提供哪些参数",
    "需要哪些参数",
    "要填什么参数",
    "我要准备什么数据",
    "这个模型要填啥",
    "缺哪些参数",
    "参数清单",
]
SWITCH_MARKERS = ["切换到", "换成"]
CONFIRM_DEFAULT_MARKERS = ["确认使用默认值", "使用默认值", "默认值确认"]
CONFIRM_INVOKE_MARKERS = ["确认调用", "开始求解", "执行优化", "开始优化", "运行模型"]
RESULT_MARKERS = ["解释结果", "结果解释", "总结结果", "分析结果", "上一次结果", "上一次优化结果"]
CONFIRM_SWITCH_CLEAR_MARKERS = ["确认清空", "清空后切换", "确认切换", "清空参数"]
CONFIRM_SWITCH_MIGRATE_MARKERS = ["迁移参数", "保留兼容参数", "迁移后切换"]
CANCEL_SWITCH_MARKERS = ["取消切换", "不切换", "保持当前"]
AVAILABILITY_MARKERS = ["有没有", "支持", "能不能做", "平台有", "是否支持", "有模型", "没有"]
OPTIMIZATION_MARKERS = ["帮我", "做", "运行", "求解", "优化", "调度", "分配", "dispatch", "optimize", "调用"]


class AgentSkillRouter:
    def route(self, message: str, conversation_state: dict[str, Any] | None = None, available_agent_skills: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        state = conversation_state or {}
        skills = available_agent_skills or []
        text = str(message or "")
        compact = "".join(text.lower().split())
        current_agent_skill = state.get("agent_skill_name")
        current_api_skill = state.get("resolved_skill_name") or state.get("selected_skill")
        mentioned = self._match_skill(text, skills)

        if state.get("pending_switch"):
            pending = state.get("pending_switch") or {}
            if any(marker in compact for marker in CANCEL_SWITCH_MARKERS):
                return self._result("cancel_switch", current_agent_skill, skills, 0.95, False, "用户取消 Skill 切换")
            if any(marker in compact for marker in CONFIRM_SWITCH_MIGRATE_MARKERS):
                return self._result("confirm_switch_migrate", pending.get("to_agent_skill") or pending.get("target_agent_skill"), skills, 0.95, False, "用户确认迁移兼容参数后切换")
            if any(marker in compact for marker in CONFIRM_SWITCH_CLEAR_MARKERS):
                return self._result("confirm_switch_clear", pending.get("to_agent_skill") or pending.get("target_agent_skill"), skills, 0.95, False, "用户确认清空参数后切换")
        if any(marker in compact for marker in HOW_TO_USE_MARKERS):
            return self._result("how_to_use", current_agent_skill or mentioned, skills, 0.95, False, "用户询问平台使用流程")
        if any(marker in compact for marker in CONFIRM_DEFAULT_MARKERS):
            return self._result("confirm_defaults", current_agent_skill or mentioned, skills, 0.9, False, "用户确认默认值")
        if any(marker in compact for marker in CONFIRM_INVOKE_MARKERS):
            return self._result("confirm_invoke", current_agent_skill or mentioned, skills, 0.9, True, "用户确认调用")
        if any(marker in compact for marker in RESULT_MARKERS):
            return self._result("result_explanation", current_agent_skill or mentioned, skills, 0.85, False, "用户要求解释已有结果")
        if any(marker in compact for marker in REQUIRED_MARKERS):
            chosen = mentioned or current_agent_skill or self._agent_skill_from_api(current_api_skill, skills)
            return self._result("explain_required_parameters", chosen, skills, 0.94, False, "用户请求参数清单，不应调用模型")
        if any(marker in compact for marker in HELP_MARKERS):
            chosen = mentioned or current_agent_skill or self._agent_skill_from_api(current_api_skill, skills)
            return self._result("parameter_example", chosen, skills, 0.92, False, "用户请求参数示例，不应调用模型")
        if any(marker in compact for marker in AVAILABILITY_MARKERS):
            return self._result("skill_availability_query", mentioned, skills, 0.9 if mentioned else 0.62, False, "用户询问平台是否支持某场景")

        explicit_switch = any(marker in compact for marker in SWITCH_MARKERS)
        if mentioned and current_agent_skill and mentioned != current_agent_skill and explicit_switch:
            return self._result("switch_skill", mentioned, skills, 0.88, False, f"检测到场景切换：{current_agent_skill} -> {mentioned}")
        if current_agent_skill and not mentioned and any(ch.isdigit() for ch in compact):
            return self._result("parameter_supplement", current_agent_skill, skills, 0.78, False, "沿用当前 Agent Skill 收集参数")
        if mentioned and current_agent_skill and mentioned != current_agent_skill:
            return self._result("optimization_request", mentioned, skills, 0.86, False, "识别到新的优化场景请求")
        if mentioned:
            if self._optimization_intent(compact):
                return self._result("optimization_request", mentioned, skills, 0.86, False, "识别到优化请求和场景")
            return self._result("casual_chat", mentioned, skills, 0.45, False, "提到场景但未明确要求执行")
        if self._optimization_intent(compact):
            return {"intent": "skill_selection_required", "agent_skill_name": None, "api_skill_name": None, "confidence": 0.4, "should_invoke": False, "reason": "识别到优化意图但无法确定 Agent Skill"}
        return {"intent": "casual_chat", "agent_skill_name": current_agent_skill, "api_skill_name": current_api_skill, "confidence": 0.5, "should_invoke": False, "reason": "未识别到优化调用意图"}

    def _result(self, intent: str, agent_skill_name: str | None, skills: list[dict[str, Any]], confidence: float, should_invoke: bool, reason: str) -> dict[str, Any]:
        skill = next((item for item in skills if item.get("name") == agent_skill_name), {})
        return {
            "intent": intent,
            "agent_skill_name": agent_skill_name,
            "api_skill_name": skill.get("canonical_api_skill_name"),
            "confidence": confidence,
            "should_invoke": should_invoke,
            "reason": reason,
        }

    def _match_skill(self, message: str, skills: list[dict[str, Any]]) -> str | None:
        text = message.lower()
        for skill in skills:
            names = [skill.get("name", ""), skill.get("display_name", "")]
            names += list(skill.get("scenario_tags") or [])
            names += list(skill.get("trigger_intents") or [])
            if any(str(item).lower() and str(item).lower() in text for item in names):
                return skill.get("name")
        aliases = [
            ("retail_da_spot_bidding_v1", ["售电公司日前现货申报", "售电日前现货申报", "日前现货申报", "日前现货", "申报优化", "retail da", "spot bidding"]),
            ("contract_spot_exposure_v1", ["合约现货暴露控制", "合约现货暴露", "现货暴露控制", "中长期合约分解", "contract spot exposure"]),
            ("pv_storage_day_ahead_dispatch", ["光储日前调度", "光伏储能日前", "pv storage day ahead"]),
            (
                "pv_storage_intraday_dispatch",
                [
                    "光储日内滚动调度",
                    "光储日内滚动优化",
                    "光储实时滚动调度",
                    "光储协同日内调度",
                    "光储日内滚动",
                    "光储实时滚动",
                    "光储日内调度",
                    "光伏储能日内",
                    "pv storage intraday",
                ],
            ),
            ("pv_storage_day_ahead_dispatch_v2", ["光储日前调度v2", "光储日前v2", "pv storage day ahead v2"]),
            ("pv_storage_intraday_dispatch_v2", ["光储日内滚动调度v2", "光储实时滚动调度v2", "光储日内调度v2", "光储日内v2", "pv storage intraday v2"]),
            ("pv_storage_dispatch_v2", ["光储调度v2", "光储v2", "pv storage dispatch v2"]),
            ("nonlinear_hydro_power_demo", ["非线性水电", "nlp水电", "ipopt水电", "nonlinear hydro"]),
            ("cascade_hydro_dispatch_v1", ["梯级水电调度v1", "梯级水电v1", "cascade hydro v1"]),
            ("unit_commitment_day_ahead", ["日前机组组合", "机组组合", "机组启停", "启停", "备用", "unit commitment"]),
            ("storage_dispatch", ["储能调度", "储能", "峰谷", "soc", "storage"]),
            ("renewable_storage_dispatch", ["风光储", "新能源", "可再生", "renewable"]),
            ("chp_dispatch", ["电热协同", "热电", "chp"]),
            (
                "cascade_hydro_dispatch",
                [
                    "梯级水电",
                    "梯级水电调度",
                    "梯级电站",
                    "梯级电站调度",
                    "水电调度",
                    "水库调度",
                    "水库群调度",
                    "流域梯级",
                    "来水调度",
                    "水电日前",
                    "帮我做梯级电站调度",
                    "帮我做梯级水电调度计划",
                    "cascade hydro",
                    "hydro dispatch",
                ],
            ),
            ("economic_dispatch", ["经济调度", "经济负荷分配", "出力分配", "负荷分配", "economic dispatch"]),
        ]
        available = {item.get("name") for item in skills}
        for name, markers in aliases:
            if name in available and any(marker in text for marker in markers):
                return name
        return None

    def _agent_skill_from_api(self, api_skill_name: str | None, skills: list[dict[str, Any]]) -> str | None:
        for skill in skills:
            if api_skill_name and skill.get("canonical_api_skill_name") == api_skill_name:
                return skill.get("name")
        return None

    def _optimization_intent(self, compact: str) -> bool:
        return any(marker in compact for marker in OPTIMIZATION_MARKERS)


agent_skill_router = AgentSkillRouter()
