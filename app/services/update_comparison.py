"""Compare observed business evidence only when inputs/settings/definitions agree."""
from copy import deepcopy

from app.services.model_service import model_service


def baseline_evidence(model):
    check = (model.dry_run_result or {}).get("solver_check") or {}
    return {"model_id": model.id, "version": model.version, "content_hash": model.content_hash,
        "tested_at": model.tested_at, "evidence": deepcopy(check.get("evidence")),
        "environment": deepcopy(check.get("execution_environment")),
        "parameters": deepcopy(model.last_test_parameters or model_service._default_test_parameters(model)),
        "solver_config": deepcopy(model.last_test_solver_config)}


def compare_evidence(before, after):
    if not before or not after:
        return {"comparable": False, "message": "无可比旧结果或当前测试未保留完整业务证据；不能据此宣称收益提升。", "metrics": [], "decisions": [], "constraints": []}
    reasons = []
    if before.get("business_inputs") != after.get("business_inputs"):
        reasons.append("业务输入或时间口径不同")
    if before.get("settings") != after.get("settings"):
        reasons.append("求解设置或实际后端不同")
    comparable = not reasons

    def rows(section):
        old = {row["key"]: row for row in before.get(section) or []}
        new = {row["key"]: row for row in after.get(section) or []}
        output = []
        for key in dict.fromkeys([*old, *new]):
            left, right = old.get(key), new.get(key)
            same_definition = bool(left and right and left.get("definition") == right.get("definition") and left.get("unit") == right.get("unit"))
            unit_known = (right or left).get("unit") != "未声明"
            valid = comparable and same_definition and unit_known
            output.append({"key": key, "name": (right or left).get("name", key), "unit": (right or left).get("unit", "未声明"),
                "before": left, "after": right, "comparable": valid,
                "change": "新增" if not left else "移除" if not right else "定义或单位变化" if not same_definition else "可比" if valid else "口径不可比",
                "delta": right["value"] - left["value"] if valid and "value" in left and "value" in right else None})
        return output

    old_objective, new_objective = before.get("objective") or {}, after.get("objective") or {}
    objective_comparable = comparable and all(old_objective.get(key) == new_objective.get(key) for key in ("definition", "unit", "sense"))
    return {"comparable": comparable, "message": "相同业务输入与求解设置；各指标仍逐项核对定义和单位。差值不自动代表业务收益。" if comparable else "；".join(reasons) + "，不计算收益改善。",
        "input_checks": {"same_inputs": before.get("business_inputs") == after.get("business_inputs"), "same_settings": before.get("settings") == after.get("settings")},
        "objective": {"before": old_objective.get("value"), "after": new_objective.get("value"), "unit": new_objective.get("unit"), "comparable": objective_comparable,
            "delta": new_objective["value"] - old_objective["value"] if objective_comparable else None},
        "metrics": rows("metrics"), "decisions": rows("decisions"), "constraints": rows("constraints"),
        "residuals": {"before": before.get("max_constraint_violation"), "after": after.get("max_constraint_violation")}}


def model_update_comparison(model_id):
    model = model_service.get_model(model_id)
    context = model.ui_metadata.get("function_update") or model.ui_metadata.get("component_update") or {}
    baseline = context.get("comparison_baseline") or {}
    check = (model.dry_run_result or {}).get("solver_check") or {}
    current = check.get("evidence") if model.tested_content_hash == model.content_hash and model.tested_model_id == model.id else None
    return {"source_model_id": context.get("source_model_id"), "candidate_model_id": model.id,
        "source_environment": baseline.get("environment"), "candidate_environment": check.get("execution_environment"),
        **compare_evidence(baseline.get("evidence"), current)}
