from __future__ import annotations

from typing import Any

from app.explainers.base import ADVISORY_DISCLAIMER, BaseExplainer
from app.solvers.status import ipopt_unavailable_explanation


FAILURE_MESSAGES = {
    "SOLVER_UNAVAILABLE": "求解器不可用，本次未形成有效优化方案。请安装或配置所需求解器后重试。",
    "INFEASIBLE": "模型不可行，本次未形成有效优化方案。请复核输入边界和冲突约束。",
    "TIMEOUT": "求解超时，本次结果不代表已获得有效最优方案。请调整时限、模型规模或求解参数后重试。",
    "NUMERICAL_ERROR": "求解发生数值错误，本次结果不可作为有效优化方案。请检查数据尺度和模型数值稳定性。",
    "VALIDATION_ERROR": "输入校验失败，模型尚未执行。请修正缺失或非法参数后重试。",
    "MODEL_BUILD_ERROR": "模型构建失败，尚未进入有效求解阶段。请检查模型定义和运行输入。",
    "SKILL_DISABLED": "Skill 已停用，未执行模型。",
    "PERMISSION_DENIED": "当前用户无权调用该 Skill，未执行模型。",
}


class GenericExplainer(BaseExplainer):
    def explain(self, evidence_package: dict[str, Any]) -> dict[str, Any]:
        solver = evidence_package.get("solver") or {}
        status = str(solver.get("status") or "unknown").upper()
        error_text = str(solver.get("error") or "")
        error_code = self._error_code(status, error_text)
        fact_items: list[dict[str, Any]] = []
        if error_code:
            fact_items.append({"text": self._failure_message(error_code, error_text), "evidence_refs": ["solver.status", "solver.error"]})
        else:
            fact_items.append({"text": f"求解状态为 {solver.get('status') or 'unknown'}。", "evidence_refs": ["solver.status", "solver.termination_condition"]})
            if solver.get("objective_value") is not None:
                objective = (evidence_package.get("model") or {}).get("objective") or {}
                objective_name = objective.get("name") or objective.get("key") or "目标函数"
                unit = objective.get("unit") or ""
                fact_items.append({
                    "text": f"{objective_name}的求解值为 {solver['objective_value']}{unit}。",
                    "evidence_refs": ["solver.objective_value", "model.objective"],
                })
            for key, metric in (evidence_package.get("derived_metrics") or {}).items():
                value = metric.get("value")
                unit = metric.get("unit") or ""
                fact_items.append({
                    "text": f"{metric.get('label') or key}为 {value}{unit}。",
                    "evidence_refs": [metric.get("evidence_ref") or f"derived_metrics.{key}"],
                })
            for variable in evidence_package.get("variables_summary") or []:
                pieces = []
                for label in ("min", "max", "sum", "non_zero_count"):
                    if variable.get(label) is not None:
                        pieces.append(f"{label}={variable[label]}")
                fact_items.append({
                    "text": f"变量“{variable.get('business_name') or variable.get('name')}”摘要：{', '.join(pieces) or '无可用数值'}。",
                    "evidence_refs": [variable.get("evidence_ref") or f"variables_summary.{variable.get('name')}"],
                })
            checks = evidence_package.get("constraint_checks") or []
            binding = [item for item in checks if str(item.get("status") or "").lower() == "binding"]
            violated = [item for item in checks if str(item.get("status") or "").lower() in {"violated", "failed", "infeasible"}]
            if binding:
                fact_items.append({"text": f"检测到 {len(binding)} 个触边约束。", "evidence_refs": [item.get("evidence_ref") for item in binding]})
            if violated:
                fact_items.append({"text": f"检测到 {len(violated)} 个未满足约束。", "evidence_refs": [item.get("evidence_ref") for item in violated]})

        inference_items: list[dict[str, Any]] = []
        if not error_code and evidence_package.get("risk_notes"):
            for risk in evidence_package.get("risk_notes") or []:
                inference_items.append({
                    "text": str(risk.get("message") or risk.get("name") or "声明的风险规则已命中。"),
                    "evidence_refs": [risk.get("evidence_ref") or "risk_notes"],
                    "level": risk.get("level") or "medium",
                })
        manual = [str(item) for item in evidence_package.get("manual_review_points") or []]
        recommendation_items = [] if error_code else [
            {"text": item, "evidence_refs": ["manual_review_points"]}
            for item in (manual or ["在采用方案前复核关键输入、约束边界与现场业务条件。"])
        ]
        limitations = [str(item) for item in evidence_package.get("explanation_limits") or []]
        if ADVISORY_DISCLAIMER not in limitations:
            limitations.append(ADVISORY_DISCLAIMER)
        facts = [str(item["text"]) for item in fact_items]
        inferences = [str(item["text"]) for item in inference_items]
        recommendations = [str(item["text"]) for item in recommendation_items]
        summary = facts[0] if facts else "未获得可解释的求解事实。"
        return {
            "explanation_schema_version": "2.0",
            "facts": facts,
            "fact_items": fact_items,
            "inferences": inferences,
            "inference_items": inference_items,
            "recommendations": recommendations,
            "recommendation_items": recommendation_items,
            "risk_notes": evidence_package.get("risk_notes") or [],
            "manual_review_points": manual,
            "limitations": limitations,
            "summary": summary,
            "disclaimer": ADVISORY_DISCLAIMER,
            "grounded_on": "evidence_package",
        }

    def _error_code(self, status: str, error: str) -> str | None:
        combined = f"{status} {error}".upper()
        unavailable_terms = (
            "UNAVAILABLE", "NOT AVAILABLE", "NOT INSTALLED", "NOT FOUND",
            "MISSING", "NO EXECUTABLE", "NOT IN PATH", "SOLVER_UNAVAILABLE",
        )
        if "IPOPT" in combined and any(term in combined for term in unavailable_terms):
            return "SOLVER_UNAVAILABLE"
        for code in FAILURE_MESSAGES:
            if code in combined:
                return code
        if status in {"FAILED", "ERROR", "CANCELLED"}:
            return "MODEL_BUILD_ERROR"
        return None

    def _failure_message(self, code: str, error: str) -> str:
        if code == "SOLVER_UNAVAILABLE" and "IPOPT" in error.upper():
            return ipopt_unavailable_explanation()
        return FAILURE_MESSAGES[code]


generic_explainer = GenericExplainer()
