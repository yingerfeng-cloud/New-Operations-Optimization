from __future__ import annotations

import ast
from typing import Any


class RiskRuleEngine:
    def evaluate(self, profile: dict[str, Any] | None, context: dict[str, Any]) -> list[dict[str, Any]]:
        return self.evaluate_with_diagnostics(profile, context)[0]

    def evaluate_with_diagnostics(
        self,
        profile: dict[str, Any] | None,
        context: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], list[str]]:
        notes: list[dict[str, Any]] = []
        limitations: list[str] = []
        for rule in (profile or {}).get("risk_rules") or []:
            try:
                if rule.get("metric_key") and rule.get("operator"):
                    metric_key = str(rule["metric_key"])
                    if metric_key not in context:
                        raise KeyError(metric_key)
                    triggered = self._compare(context[metric_key], str(rule["operator"]), rule.get("threshold"))
                else:
                    triggered = bool(self._eval(ast.parse(str(rule.get("condition") or "False"), mode="eval").body, context))
            except (ValueError, SyntaxError, TypeError, KeyError) as exc:
                limitations.append(f"风险规则“{rule.get('key') or rule.get('name') or 'unnamed'}”未执行：缺少或不支持的证据 {exc}")
                continue
            if triggered:
                notes.append({
                    "key": rule.get("key") or rule.get("name"),
                    "name": rule.get("name") or rule.get("key"),
                    "level": rule.get("level", "medium"),
                    "message": rule.get("message"),
                    "metric_key": rule.get("metric_key"),
                    "threshold": rule.get("threshold"),
                    "evidence_ref": f"derived_metrics.{rule.get('metric_key')}" if rule.get("metric_key") else "metric_context",
                })
        return notes, limitations

    def _compare(self, value: Any, operator: str, threshold: Any) -> bool:
        operations = {
            "gt": lambda left, right: left > right,
            "gte": lambda left, right: left >= right,
            "lt": lambda left, right: left < right,
            "lte": lambda left, right: left <= right,
            "eq": lambda left, right: left == right,
            "neq": lambda left, right: left != right,
        }
        if operator not in operations:
            raise ValueError(f"unsupported operator {operator}")
        return bool(operations[operator](value, threshold))

    def _eval(self, node: ast.AST, context: dict[str, Any]) -> Any:
        if isinstance(node, ast.Constant): return node.value
        if isinstance(node, ast.Name):
            if node.id not in context:
                raise KeyError(node.id)
            return context[node.id]
        if isinstance(node, ast.BoolOp):
            values = [bool(self._eval(value, context)) for value in node.values]
            return all(values) if isinstance(node.op, ast.And) else any(values)
        if isinstance(node, ast.Compare):
            left = self._eval(node.left, context)
            right = self._eval(node.comparators[0], context)
            op = node.ops[0]
            if isinstance(op, ast.Gt): return left > right
            if isinstance(op, ast.GtE): return left >= right
            if isinstance(op, ast.Lt): return left < right
            if isinstance(op, ast.LtE): return left <= right
            if isinstance(op, ast.Eq): return left == right
        raise ValueError("unsupported risk expression")


risk_rule_engine = RiskRuleEngine()
