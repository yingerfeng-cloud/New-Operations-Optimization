from __future__ import annotations

import ast
from typing import Any


class MetricEngine:
    """Compute profile metrics through an explicit, auditable function registry."""

    BUILTIN_FUNCTIONS = {
        "identity", "total_energy", "sum_value", "max_value", "min_value", "avg_value",
        "non_zero_count", "switch_count", "range_value", "binding_count",
        "binding_periods", "curtailment_rate", "exposure_ratio", "max_period",
        "top_periods",
    }

    def compute(self, profile: dict[str, Any] | None, context: dict[str, Any]) -> dict[str, Any]:
        return self.compute_with_diagnostics(profile, context)[0]

    def compute_with_diagnostics(
        self,
        profile: dict[str, Any] | None,
        context: dict[str, Any],
    ) -> tuple[dict[str, Any], list[str]]:
        metrics: dict[str, Any] = {}
        limitations: list[str] = []
        rows = (profile or {}).get("metrics") or (profile or {}).get("key_metrics") or []
        for item in rows:
            name = str(item.get("key") or item.get("name") or "")
            function = str(item.get("function") or "")
            expression = str(item.get("expression") or "")
            source = item.get("source") if isinstance(item.get("source"), dict) else None
            if source:
                source_kind = str(source.get("kind") or "")
                source_key = source.get("key")
                context_key = "objective" if source_kind == "objective" else f"{source_kind}:{source_key}"
                item = {**item, "args": [context_key]}
                function = function or "identity"
            if not name or (not function and not expression):
                continue
            try:
                if function:
                    value = self._call(function, list(item.get("args") or []), item, context)
                else:
                    value = self._eval(ast.parse(expression, mode="eval").body, context)
            except (ValueError, TypeError, KeyError, ZeroDivisionError, SyntaxError) as exc:
                limitations.append(f"指标“{item.get('label') or name}”无法计算：{exc}")
                continue
            metrics[name] = {
                "label": item.get("label") or name,
                "value": value,
                "unit": item.get("unit") or "",
                "function": function or "expression",
                "source": source,
                "evidence_ref": f"derived_metrics.{name}",
            }
        return metrics, limitations

    def _call(
        self,
        function: str,
        args: list[Any],
        item: dict[str, Any],
        context: dict[str, Any],
    ) -> Any:
        if function not in self.BUILTIN_FUNCTIONS:
            raise ValueError(f"不支持的指标函数 {function}")
        values = [self._resolve_arg(arg, context) for arg in args]
        primary = values[0] if values else []
        numbers = self._numbers(primary)
        if function == "identity":
            if primary is None:
                raise ValueError("所需结果字段为空")
            if isinstance(primary, (int, float, str, bool)):
                return primary
            if len(numbers) == 1:
                return numbers[0]
            raise ValueError("identity 指标要求标量来源")
        if function in {"total_energy", "sum_value"}:
            factor = float(item.get("time_step_hours", 1)) if function == "total_energy" else 1.0
            return round(sum(numbers) * factor, 8)
        if not numbers and function not in {"binding_periods", "top_periods", "max_period"}:
            raise ValueError("所需结果字段缺失或没有数值")
        if function == "max_value":
            return max(numbers)
        if function == "min_value":
            return min(numbers)
        if function == "avg_value":
            return sum(numbers) / len(numbers)
        if function == "non_zero_count":
            tolerance = float(item.get("tolerance", 1e-9))
            return len([value for value in numbers if abs(value) > tolerance])
        if function == "switch_count":
            tolerance = float(item.get("tolerance", 1e-9))
            states = [abs(value) > tolerance for value in numbers]
            return sum(left != right for left, right in zip(states, states[1:]))
        if function == "range_value":
            return max(numbers) - min(numbers)
        if function in {"binding_count", "binding_periods"}:
            if len(values) < 2:
                raise ValueError("binding 函数需要序列和边界两个参数")
            bound = self._numbers(values[1])
            tolerance = float(item.get("tolerance", 1e-6))
            pairs = self._period_values(primary)
            bound_values = bound if len(bound) > 1 else bound * len(pairs)
            periods = [
                period for (period, value), limit in zip(pairs, bound_values)
                if abs(value - limit) <= tolerance
            ]
            return len(periods) if function == "binding_count" else periods
        if function in {"curtailment_rate", "exposure_ratio"}:
            if len(values) < 2:
                raise ValueError(f"{function} 需要分子和分母")
            denominator = sum(self._numbers(values[1]))
            if abs(denominator) <= 1e-12:
                raise ZeroDivisionError("分母为零")
            return round(sum(numbers) / denominator, 8)
        pairs = self._period_values(primary)
        if not pairs:
            raise ValueError("所需时序结果字段缺失")
        ranked = sorted(pairs, key=lambda row: row[1], reverse=True)
        if function == "max_period":
            return ranked[0][0]
        if function == "top_periods":
            count = int(item.get("count", 3))
            return [period for period, _ in ranked[:count]]
        raise ValueError(f"不支持的指标函数 {function}")

    def _resolve_arg(self, arg: Any, context: dict[str, Any]) -> Any:
        if isinstance(arg, str):
            if arg not in context:
                raise KeyError(f"缺少结果字段 {arg}")
            return context[arg]
        return arg

    def _numbers(self, value: Any) -> list[float]:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return [float(value)]
        if isinstance(value, dict):
            output: list[float] = []
            for child in value.values():
                output.extend(self._numbers(child))
            return output
        if isinstance(value, (list, tuple)):
            output = []
            for child in value:
                output.extend(self._numbers(child))
            return output
        return []

    def _period_values(self, value: Any) -> list[tuple[Any, float]]:
        if isinstance(value, dict):
            return [
                (key, float(child))
                for key, child in value.items()
                if isinstance(child, (int, float)) and not isinstance(child, bool)
            ]
        return [
            (index, float(child))
            for index, child in enumerate(value if isinstance(value, (list, tuple)) else [])
            if isinstance(child, (int, float)) and not isinstance(child, bool)
        ]

    def _eval(self, node: ast.AST, context: dict[str, Any]) -> Any:
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            if node.id not in context:
                raise KeyError(f"缺少指标字段 {node.id}")
            return context[node.id]
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
