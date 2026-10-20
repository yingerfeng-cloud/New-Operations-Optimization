"""Keep a known dimensional error out of completed-result explanations."""
import re


def ground_completed_explanation(content: str, context: list[dict]) -> tuple[str, dict | None]:
    # MW is per-period power. Summing samples does not create a total MW load.
    bad_power_sum = re.search(r"(?:累计(?:总)?(?:出力|功率)|全周期[^。；\n]{0,30}(?:总负荷|总出力))[^。；\n]{0,60}\d[\d,.]*\s*MW(?!h)", content, re.IGNORECASE)
    if not bad_power_sum:
        return content, None
    row = next((item for item in context if item.get("read_only") and item.get("status") == "SUCCEEDED" and item.get("physical_aggregates")), None)
    if not row:
        return content, None
    evidence = row.get("recorded_result") or {}
    model, solver = evidence.get("model") or {}, evidence.get("solver") or {}
    lines = [f"根据已保存的求解证据：模型版本 {model.get('model_version', '未记录')}，求解器 {solver.get('solver_name', '未记录')}。",
             f"目标值为 {solver.get('objective_value', '未记录')}，目标定义为 {(model.get('objective') or {}).get('name') or '以模型定义为准'}。",
             f"记录的时段长度为 {row.get('recorded_time_step_hours')} 小时。各时段出力使用 MW；累计电量使用 MWh。"]
    for name, energy in row["physical_aggregates"].items():
        lines.append(f"{name} 累计电量为 {energy['value']:g} MWh。")
    lines.append("功率平衡按每个时段核对；出力上下限和爬坡约束按本次模型及逐时结果复核。目标的业务含义按上述模型定义解释，方案须经人工复核。")
    return "\n".join(lines), {"status": "evidence_fallback", "reason": "power_sum_unit_mismatch"}
