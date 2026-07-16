from __future__ import annotations

from typing import Any

from app.explainers.base import ADVISORY_DISCLAIMER, BaseExplainer


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
        facts: list[str] = []
        if error_code:
            facts.append(self._failure_message(error_code, error_text))
        else:
            facts.append(f"求解状态为 {solver.get('status') or 'unknown'}。")
            if solver.get("objective_value") is not None:
                facts.append(f"目标函数值为 {solver['objective_value']}。")
            if evidence_package.get("variables_summary"):
                facts.append(f"结果返回 {len(evidence_package['variables_summary'])} 个变量摘要。")
            binding = [item for item in evidence_package.get("constraint_checks") or [] if item.get("status") == "binding"]
            if binding:
                facts.append(f"检测到 {len(binding)} 个触边约束。")

        inferences: list[str] = []
        if not error_code and evidence_package.get("risk_notes"):
            inferences.append("配置的风险规则命中，需重点复核相应时段或边界。")
        recommendations = [] if error_code else ["在采用方案前复核关键输入、约束边界与现场业务条件。"]
        manual = [str(item) for item in evidence_package.get("manual_review_points") or []]
        limitations = [str(item) for item in evidence_package.get("explanation_limits") or []]
        if ADVISORY_DISCLAIMER not in limitations:
            limitations.append(ADVISORY_DISCLAIMER)
        summary = facts[0] if facts else "未获得可解释的求解事实。"
        return {
            "facts": facts,
            "inferences": inferences,
            "recommendations": recommendations,
            "risk_notes": evidence_package.get("risk_notes") or [],
            "manual_review_points": manual,
            "limitations": limitations,
            "summary": summary,
            "disclaimer": ADVISORY_DISCLAIMER,
            "grounded_on": "evidence_package",
        }

    def _error_code(self, status: str, error: str) -> str | None:
        combined = f"{status} {error}".upper()
        if "IPOPT" in combined and any(term in combined for term in ("UNAVAILABLE", "NOT FOUND", "MISSING")):
            return "SOLVER_UNAVAILABLE"
        for code in FAILURE_MESSAGES:
            if code in combined:
                return code
        if status in {"FAILED", "ERROR", "CANCELLED"}:
            return "MODEL_BUILD_ERROR"
        return None

    def _failure_message(self, code: str, error: str) -> str:
        if code == "SOLVER_UNAVAILABLE" and "IPOPT" in error.upper():
            return "本次非线性模型未完成求解，原因是 NLP 求解器 Ipopt 不可用，平台未启用替代求解器。当前结果不是有效优化方案。请安装 Ipopt，或切换为线性化/分段线性近似模型后重试。"
        return FAILURE_MESSAGES[code]


generic_explainer = GenericExplainer()
