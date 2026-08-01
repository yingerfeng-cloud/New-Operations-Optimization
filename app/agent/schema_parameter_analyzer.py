from __future__ import annotations

from typing import Any

from app.agent.default_value_resolver import default_value_resolver


class SchemaParameterAnalyzer:
    """Pure schema validation used by Agent v2.

    Keep this layer independent from invocation_service, model builders and
    solver imports. Invocation may consume this result, but never owns it.
    """

    def analyze(
        self,
        input_schema: list[dict[str, Any]],
        partial_parameters: dict[str, Any] | None,
    ) -> dict[str, Any]:
        supplied = dict(partial_parameters or {})
        normalized = dict(supplied)
        missing: list[dict[str, Any]] = []
        invalid: list[dict[str, Any]] = []
        defaults: list[dict[str, Any]] = []
        questions: list[str] = []
        sources = {key: "USER_INPUT" for key in supplied}

        for item in input_schema or []:
            key = item.get("key")
            if not key or str(item.get("default_policy") or "") == "derived":
                continue
            has_value = key in supplied and supplied.get(key) not in (None, "")
            if has_value:
                error = self._validate_shape(item, supplied[key])
                if error:
                    invalid.append(error)
                continue
            has_default, value = default_value_resolver.resolve(item)
            if has_default:
                defaults.append(
                    {
                        "key": key,
                        "name": item.get("name") or key,
                        "value": value,
                        "source": "DEFAULT_VALUE",
                    }
                )
                normalized.setdefault(key, value)
                sources.setdefault(key, "DEFAULT_VALUE")
            elif item.get("required", True):
                missing.append(
                    {
                        "key": key,
                        "name": item.get("name") or key,
                        "dimension": list(item.get("dimension") or []),
                        "unit": item.get("unit", ""),
                    }
                )
                questions.append(self._question(item))

        requires_confirmation = bool(defaults)
        return {
            "ready": not missing and not invalid and not requires_confirmation,
            "missing_required": missing,
            "invalid_parameters": invalid,
            "can_use_default": defaults,
            "requires_default_confirmation": requires_confirmation,
            "questions": questions,
            "normalized_parameters": normalized,
            "parameter_sources": sources,
        }

    def _validate_shape(self, item: dict[str, Any], value: Any) -> dict[str, Any] | None:
        key = item.get("key")
        dimensions = list(item.get("dimension") or [])
        expected_type = str(item.get("type") or "").lower()
        if dimensions:
            if not isinstance(value, (dict, list)):
                return {
                    "key": key,
                    "error": "dimension parameter must be dict or list",
                    "expected": dimensions,
                    "actual": type(value).__name__,
                }
            if expected_type == "dict" and not isinstance(value, dict):
                return self._type_error(key, "dict", value)
            if expected_type == "array" and not isinstance(value, list):
                return self._type_error(key, "array", value)
            expected_length = self._expected_length(item)
            if isinstance(value, list) and expected_length is not None and len(value) != expected_length:
                return {
                    "key": key,
                    "error": "length mismatch",
                    "expected": expected_length,
                    "actual": len(value),
                }
            expected_keys = self._expected_keys(item) if isinstance(value, dict) else []
            if expected_keys:
                actual = set(map(str, value.keys()))
                unknown = sorted(actual - set(expected_keys))
                absent = sorted(set(expected_keys) - actual)
                if unknown:
                    return {
                        "key": key,
                        "error": "unknown dict keys",
                        "expected": expected_keys,
                        "actual": sorted(actual),
                        "unknown": unknown,
                    }
                if absent:
                    return {
                        "key": key,
                        "error": "missing dict keys",
                        "expected": expected_keys,
                        "actual": sorted(actual),
                        "missing": absent,
                    }
        elif expected_type in {"number", "float", "integer", "int"} and (
            not isinstance(value, (int, float)) or isinstance(value, bool)
        ):
            return self._type_error(key, expected_type, value)
        return None

    def _expected_length(self, item: dict[str, Any]) -> int | None:
        dimensions = list(item.get("dimension") or [])
        if len(dimensions) != 1:
            return None
        dimension = str(dimensions[0])
        values = (item.get("sets") or {}).get(dimension)
        if values:
            return len(values)
        for source in ("sample_value", "default_value"):
            value = item.get(source)
            if isinstance(value, (list, dict)):
                return len(value)
        return None

    def _expected_keys(self, item: dict[str, Any]) -> list[str]:
        dimensions = list(item.get("dimension") or [])
        if len(dimensions) != 1:
            return []
        dimension = str(dimensions[0])
        values = (item.get("sets") or {}).get(dimension)
        if values:
            return [str(value) for value in values]
        for source in ("sample_value", "default_value"):
            value = item.get(source)
            if isinstance(value, dict):
                return [str(key) for key in value]
        return []

    def _question(self, item: dict[str, Any]) -> str:
        name = item.get("name") or item.get("key")
        dimension = "、".join(item.get("dimension") or []) or "标量"
        unit = item.get("unit")
        suffix = f"，单位 {unit}" if unit else ""
        return f"请提供{name}（{dimension}{suffix}）。"

    def _type_error(self, key: Any, expected: Any, value: Any) -> dict[str, Any]:
        return {
            "key": key,
            "error": "parameter type mismatch",
            "expected": expected,
            "actual": type(value).__name__,
        }


schema_parameter_analyzer = SchemaParameterAnalyzer()
