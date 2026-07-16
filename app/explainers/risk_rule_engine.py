from __future__ import annotations

import ast
from typing import Any


class RiskRuleEngine:
    def evaluate(self, profile: dict[str, Any] | None, context: dict[str, Any]) -> list[dict[str, Any]]:
        notes: list[dict[str, Any]] = []
        for rule in (profile or {}).get("risk_rules") or []:
            try:
                triggered = bool(self._eval(ast.parse(str(rule.get("condition") or "False"), mode="eval").body, context))
            except (ValueError, SyntaxError, TypeError):
                triggered = False
            if triggered:
                notes.append({"name": rule.get("name"), "level": rule.get("level", "medium"), "message": rule.get("message")})
        return notes

    def _eval(self, node: ast.AST, context: dict[str, Any]) -> Any:
        if isinstance(node, ast.Constant): return node.value
        if isinstance(node, ast.Name): return context.get(node.id, 0)
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
