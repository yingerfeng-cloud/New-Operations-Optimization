from __future__ import annotations

import ast
from typing import Any


class MetricEngine:
    """Evaluate a small, read-only metric expression language over evidence data."""

    def compute(self, profile: dict[str, Any] | None, context: dict[str, Any]) -> dict[str, Any]:
        metrics: dict[str, Any] = {}
        for item in (profile or {}).get("key_metrics") or []:
            name = str(item.get("name") or "")
            expression = str(item.get("expression") or "")
            if not name or not expression:
                continue
            try:
                value = self._eval(ast.parse(expression, mode="eval").body, context)
            except (ValueError, TypeError, KeyError, ZeroDivisionError, SyntaxError):
                continue
            metrics[name] = {"label": item.get("label") or name, "value": value, "unit": item.get("unit") or ""}
        return metrics

    def _eval(self, node: ast.AST, context: dict[str, Any]) -> Any:
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            return context.get(node.id, 0)
        if isinstance(node, ast.BinOp):
            left, right = self._eval(node.left, context), self._eval(node.right, context)
            if isinstance(node.op, ast.Add): return left + right
            if isinstance(node.op, ast.Sub): return left - right
            if isinstance(node.op, ast.Mult): return left * right
            if isinstance(node.op, ast.Div): return left / right
            raise ValueError("unsupported operator")
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -self._eval(node.operand, context)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"sum", "min", "max", "len", "abs"}:
            fn = {"sum": sum, "min": min, "max": max, "len": len, "abs": abs}[node.func.id]
            return fn(*(self._eval(item, context) for item in node.args))
        if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name):
            value = context.get(node.value.id, {})
            key = self._eval(node.slice, context)
            return value[key]
        if isinstance(node, ast.List):
            return [self._eval(item, context) for item in node.elts]
        raise ValueError("unsupported metric expression")


metric_engine = MetricEngine()
