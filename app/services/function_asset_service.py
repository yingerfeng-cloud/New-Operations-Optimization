from __future__ import annotations

import csv
import uuid
from copy import deepcopy
from io import StringIO
from typing import Any

from fastapi import HTTPException

from app.schemas.function_asset import FunctionAsset
from app.storage.memory_store import STORE
from app.utils import now_text

PUBLISH_READY_STATUSES = {"published", "trial", "active", "tested", "已发布", "试运行", "已测试"}


class FunctionAssetService:
    def list_assets(self) -> list[FunctionAsset]:
        with STORE.lock:
            raw_assets = [deepcopy(item) for item in STORE.function_assets.values()]
        rows = [self._with_references(_normalize_schema_fields(item)) for item in raw_assets]
        return sorted((FunctionAsset(**item) for item in rows), key=lambda item: item.updated_at or "", reverse=True)

    def create_asset(self, payload: dict[str, Any]) -> FunctionAsset:
        asset = self._normalize(payload, creating=True)
        with STORE.lock:
            if asset["function_id"] in STORE.function_assets:
                raise HTTPException(status_code=409, detail=f"Function asset already exists: {asset['function_id']}")
            STORE.function_assets[asset["function_id"]] = asset
            STORE.save_runtime()
        return FunctionAsset(**self._with_references(asset))

    def get_asset(self, function_id: str) -> FunctionAsset:
        with STORE.lock:
            asset = deepcopy(STORE.function_assets.get(function_id) or {})
        if not asset:
            raise HTTPException(status_code=404, detail="Function asset not found")
        return FunctionAsset(**self._with_references(asset))

    def update_asset(self, function_id: str, payload: dict[str, Any]) -> FunctionAsset:
        existing = self.get_asset(function_id)
        asset = self._normalize({**existing.model_dump(), **payload, "function_id": function_id}, creating=False)
        with STORE.lock:
            STORE.function_assets[function_id] = asset
            STORE.save_runtime()
        return FunctionAsset(**self._with_references(asset))

    def validate_asset(self, function_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        asset = self._asset_payload(function_id, payload)
        return validate_function_asset(asset)

    def preview_asset(self, function_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        asset = self._asset_payload(function_id, payload)
        validation = validate_function_asset(asset)
        if not validation["valid"]:
            raise HTTPException(status_code=422, detail={"message": "Function asset validation failed", **validation})
        points = [[float(point[0]), float(point[1])] for point in asset.get("points") or []]
        raw_inputs = (payload or {}).get("inputs")
        if raw_inputs is None:
            xs = [point[0] for point in points]
            if len(xs) >= 2:
                step = (xs[-1] - xs[0]) / 4
                raw_inputs = [xs[0] + step * i for i in range(5)]
            else:
                raw_inputs = xs
        values = [{"x": float(x), "y": _interpolate_piecewise_1d(float(x), points)} for x in raw_inputs]
        return {
            "function_id": asset["function_id"],
            "function_type": asset.get("function_type", "piecewise_1d"),
            "interpolation": asset.get("interpolation", "linear"),
            "domain": validation["domain"],
            "values": values,
            "diagnostics": validation["diagnostics"],
            "validation_status": validation["validation_status"],
            "validation_errors": validation["errors"],
            "validation_warnings": validation["warnings"],
        }

    def import_csv(self, payload: dict[str, Any]) -> FunctionAsset:
        csv_text = str(payload.get("csv_text") or payload.get("content") or "")
        if not csv_text.strip():
            raise HTTPException(status_code=422, detail="csv_text is required")
        reader = csv.DictReader(StringIO(csv_text))
        fields = list(reader.fieldnames or [])
        x_field = str(payload.get("x_field") or (fields[0] if fields else "")).strip()
        y_field = str(payload.get("y_field") or (fields[1] if len(fields) > 1 else "")).strip()
        group_field = str(payload.get("group_field") or "").strip()
        if not x_field or not y_field or x_field not in fields or y_field not in fields:
            raise HTTPException(status_code=422, detail={"message": "CSV must include selected x/y fields", "fields": fields, "x_field": x_field, "y_field": y_field})
        rows = list(reader)
        points: list[list[float]] = []
        grouped: dict[str, list[list[float]]] = {}
        for index, row in enumerate(rows, start=2):
            try:
                point = [float(row[x_field]), float(row[y_field])]
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=422, detail={"message": "CSV x/y fields must be numeric", "row": index, "x_field": x_field, "y_field": y_field}) from exc
            if group_field and group_field in fields:
                grouped.setdefault(str(row.get(group_field) or ""), []).append(point)
            else:
                points.append(point)
        if grouped:
            # First phase stores the first group as the solvable 1D curve and keeps all groups in metadata.
            first_group = next(iter(grouped))
            points = grouped[first_group]
            group_warning = "当前轻量版仅使用第一组曲线参与求解，其余分组仅保存为元数据。"
            groups_used_for_solving = [first_group]
        else:
            group_warning = ""
            groups_used_for_solving = []
        asset_payload = {
            "function_id": payload.get("function_id") or f"curve_{uuid.uuid4().hex[:8]}",
            "name": payload.get("name") or payload.get("asset_name") or "CSV imported curve",
            "description": payload.get("description") or "Imported from CSV; Excel multi-sheet import is reserved.",
            "function_type": payload.get("function_type") or "piecewise_1d",
            "input_schema": [{"code": x_field, "name": payload.get("x_name") or x_field, "unit": payload.get("x_unit") or "", "type": "number"}],
            "output_schema": {"code": y_field, "name": payload.get("y_name") or y_field, "unit": payload.get("y_unit") or "", "type": "number"},
            "group_keys": [group_field] if group_field else [],
            "interpolation": payload.get("interpolation") or "linear",
            "solve_strategy": payload.get("solve_strategy") or "convex_combination_lp",
            "status": "draft",
            "points": points,
            "metadata": {
                "source": "csv_import",
                "fields": fields,
                "sample_rows": rows[:20],
                "groups": grouped if grouped else None,
                "groups_used_for_solving": groups_used_for_solving,
                "warning": group_warning or None,
                "reserved_capability": "multi_group_curve_solving" if grouped else None,
            },
        }
        return self.create_asset(asset_payload)

    def _asset_payload(self, function_id: str, payload: dict[str, Any] | None) -> dict[str, Any]:
        if payload:
            base = self.get_asset(function_id).model_dump() if function_id in self._ids() else {}
            return self._normalize({**base, **payload, "function_id": function_id}, creating=False)
        return self.get_asset(function_id).model_dump()

    def _ids(self) -> set[str]:
        with STORE.lock:
            return set(STORE.function_assets)

    def _normalize(self, payload: dict[str, Any], *, creating: bool) -> dict[str, Any]:
        timestamp = now_text()
        function_id = str(payload.get("function_id") or payload.get("id") or f"FUNC-{uuid.uuid4().hex[:8].upper()}").strip()
        if not function_id:
            raise HTTPException(status_code=422, detail="function_id is required")
        points = _normalize_points(payload.get("points") or [])
        normalized = {
            **deepcopy(payload),
            "function_id": function_id,
            "name": payload.get("name") or function_id,
            "function_type": payload.get("function_type") or "piecewise_1d",
            "input_schema": _normalize_input_schema(payload.get("input_schema")),
            "output_schema": _normalize_output_schema(payload.get("output_schema")),
            "group_keys": list(payload.get("group_keys") or []),
            "interpolation": payload.get("interpolation") or "linear",
            "points": points,
            "domain": dict(payload.get("domain") or {}),
            "monotonicity": payload.get("monotonicity"),
            "solve_strategy": payload.get("solve_strategy") or "convex_combination_lp",
            "status": payload.get("status") or "draft",
            "description": payload.get("description") or "",
            "metadata": dict(payload.get("metadata") or {}),
            "created_at": payload.get("created_at") or timestamp,
            "updated_at": timestamp,
        }
        validation = validate_function_asset(normalized)
        if str(normalized["status"]) in PUBLISH_READY_STATUSES and not validation["valid"]:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Function asset validation failed",
                    "validation_status": "invalid",
                    "validation_errors": validation["errors"],
                },
            )
        normalized["domain"] = validation["domain"] or normalized["domain"]
        normalized["monotonicity"] = validation["diagnostics"].get("monotonicity")
        normalized["convexity"] = validation["diagnostics"].get("convexity")
        normalized["diagnostics"] = validation["diagnostics"]
        normalized["validation_status"] = validation["validation_status"]
        normalized["validation_errors"] = validation["errors"]
        normalized["validation_warnings"] = validation["warnings"]
        return normalized

    def _with_references(self, asset: dict[str, Any]) -> dict[str, Any]:
        asset["referenced_by"] = function_asset_references(str(asset.get("function_id") or ""))
        return asset


def _normalize_schema_fields(asset: dict[str, Any]) -> dict[str, Any]:
    normalized = deepcopy(asset)
    normalized["input_schema"] = _normalize_input_schema(normalized.get("input_schema"))
    normalized["output_schema"] = _normalize_output_schema(normalized.get("output_schema"))
    normalized["metadata"] = dict(normalized.get("metadata") or {})
    return normalized


def _normalize_input_schema(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, list):
        return [dict(item) for item in raw if isinstance(item, dict)]
    if isinstance(raw, dict):
        if "code" in raw:
            row = dict(raw)
            row.setdefault("type", "number")
            return [row]
        rows: list[dict[str, Any]] = []
        for code, value in raw.items():
            meta = value if isinstance(value, dict) else {}
            rows.append(
                {
                    "code": str(code),
                    "name": str(meta.get("name") or code),
                    "unit": str(meta.get("unit") or ""),
                    "type": str(meta.get("type") or "number"),
                }
            )
        if rows:
            return rows
    return [{"code": "x", "name": "x", "unit": "", "type": "number"}]


def _normalize_output_schema(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        if "code" in raw:
            row = dict(raw)
            row.setdefault("type", "number")
            row.setdefault("name", row.get("code") or "y")
            row.setdefault("unit", "")
            return row
        if len(raw) == 1:
            code, value = next(iter(raw.items()))
            meta = value if isinstance(value, dict) else {}
            return {
                "code": str(code),
                "name": str(meta.get("name") or code),
                "unit": str(meta.get("unit") or ""),
                "type": str(meta.get("type") or "number"),
            }
    return {"code": "y", "name": "y", "unit": "", "type": "number"}


def validate_function_asset(asset: dict[str, Any]) -> dict[str, Any]:
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    function_type = str(asset.get("function_type") or "piecewise_1d")
    interpolation = str(asset.get("interpolation") or "linear").lower()
    points = asset.get("points") or []
    declared_domain = asset.get("domain") or {}
    domain: dict[str, Any] = {}
    diagnostics: dict[str, Any] = {}
    if function_type != "piecewise_1d":
        errors.append({"field": "function_type", "message": "only piecewise_1d is supported in this phase", "actual": function_type})
    if interpolation != "linear":
        errors.append({"field": "interpolation", "message": "piecewise_1d only supports linear interpolation", "actual": interpolation})
    if not isinstance(points, list) or len(points) < 2:
        errors.append({"field": "points", "message": "at least two breakpoints are required"})
    previous_x: float | None = None
    normalized_points: list[list[float]] = []
    for index, point in enumerate(points if isinstance(points, list) else []):
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            errors.append({"field": f"points[{index}]", "message": "point must be [x, y]"})
            continue
        x, y = point
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            errors.append({"field": f"points[{index}]", "message": "x/y must be numeric", "actual": point})
            continue
        x_float = float(x)
        y_float = float(y)
        if previous_x is not None and x_float <= previous_x:
            errors.append({"field": f"points[{index}].x", "message": "x must be strictly increasing and unique", "actual": x})
        previous_x = x_float
        normalized_points.append([x_float, y_float])
    if normalized_points:
        y_values = [point[1] for point in normalized_points]
        domain = {
            "x_min": normalized_points[0][0],
            "x_max": normalized_points[-1][0],
            "y_min": min(y_values),
            "y_max": max(y_values),
            "breakpoint_count": len(normalized_points),
        }
        for key in ("x_min", "x_max"):
            if key in declared_domain and declared_domain.get(key) is not None:
                try:
                    declared = float(declared_domain[key])
                except (TypeError, ValueError):
                    errors.append({"field": f"domain.{key}", "message": "domain value must be numeric", "actual": declared_domain.get(key)})
                    continue
                if declared != domain[key]:
                    errors.append({"field": f"domain.{key}", "message": "domain must match points", "actual": declared, "expected": domain[key]})
        diagnostics.update(_curve_shape_diagnostics(normalized_points))
        if diagnostics.get("monotonicity") == "non_monotone":
            warnings.append({"field": "points", "message": "curve is non-monotone", "actual": diagnostics.get("monotonicity")})
        if diagnostics.get("convexity") == "unknown":
            warnings.append({"field": "points", "message": "curve convexity is unknown", "actual": "unknown"})
        if _has_slope_jump(diagnostics.get("slopes") or []):
            warnings.append({"field": "points", "message": "curve has abrupt slope changes", "actual": diagnostics.get("slopes")})
    declared_monotonicity = asset.get("monotonicity")
    if declared_monotonicity and diagnostics.get("monotonicity") not in {declared_monotonicity, "constant"}:
        warnings.append(
            {
                "field": "monotonicity",
                "message": "declared monotonicity differs from point diagnostics",
                "actual": diagnostics.get("monotonicity"),
                "expected": declared_monotonicity,
            }
        )
    validation_status = "invalid" if errors else "warning" if warnings else "valid"
    diagnostics["valid"] = not errors
    diagnostics["validation_status"] = validation_status
    return {
        "valid": not errors,
        "validation_status": validation_status,
        "validation_errors": errors,
        "validation_warnings": warnings,
        "errors": errors,
        "warnings": warnings,
        "domain": domain,
        "diagnostics": diagnostics,
    }


def function_asset_references(function_id: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with STORE.lock:
        models = list(STORE.models.values())
    for model in models:
        component_spec = model.component_spec or {}
        for component in component_spec.get("components") or []:
            config = component.get("config") if isinstance(component.get("config"), dict) else {}
            if str(component.get("function_asset_id") or component.get("curve_asset_id") or config.get("function_asset_id") or config.get("curve_asset_id") or "") == function_id:
                rows.append(
                    {
                        "asset_type": "model",
                        "model_id": model.id,
                        "model_name": model.name,
                        "component_id": component.get("component_id") or component.get("type"),
                        "constraint_id": component.get("constraint_id") or config.get("constraint_id"),
                        "referenced_at": model.updated_at or model.published_at or model.created_at,
                    }
                )
        for binding in component_spec.get("parameter_bindings") or model.parameter_bindings or []:
            if str(binding.get("function_asset_id") or binding.get("asset_id") or binding.get("value") or "") == function_id:
                rows.append({"asset_type": "binding", "model_id": model.id, "model_name": model.name, "parameter": binding.get("parameter") or binding.get("code")})
    return rows


def get_function_asset_points(function_id: str) -> list[list[float]]:
    with STORE.lock:
        asset = deepcopy(STORE.function_assets.get(function_id) or {})
    if not asset:
        raise RuntimeError(f"function asset not found: {function_id}")
    validation = validate_function_asset(asset)
    if not validation["valid"]:
        raise RuntimeError(f"function asset {function_id} is invalid: {validation['errors']}")
    return [[float(point[0]), float(point[1])] for point in asset.get("points") or []]


def get_function_asset(function_id: str) -> dict[str, Any]:
    with STORE.lock:
        asset = deepcopy(STORE.function_assets.get(function_id) or {})
    if not asset:
        raise RuntimeError(f"function asset not found: {function_id}")
    return asset


def _normalize_points(points: Any) -> list[list[float]]:
    rows: list[list[float]] = []
    if not isinstance(points, list):
        return rows
    for point in points:
        if isinstance(point, dict):
            point = [point.get("x"), point.get("y")]
        if isinstance(point, (list, tuple)) and len(point) == 2 and all(isinstance(value, (int, float)) for value in point):
            rows.append([float(point[0]), float(point[1])])
        else:
            rows.append(point)
    return rows


def _curve_shape_diagnostics(points: list[list[float]]) -> dict[str, Any]:
    deltas = [points[i + 1][1] - points[i][1] for i in range(len(points) - 1)]
    slopes = [
        (points[i + 1][1] - points[i][1]) / (points[i + 1][0] - points[i][0])
        for i in range(len(points) - 1)
        if points[i + 1][0] != points[i][0]
    ]
    increasing = all(delta >= 0 for delta in deltas)
    decreasing = all(delta <= 0 for delta in deltas)
    monotonicity = "increasing" if increasing and any(delta > 0 for delta in deltas) else "decreasing" if decreasing and any(delta < 0 for delta in deltas) else "constant" if all(delta == 0 for delta in deltas) else "non_monotone"
    convexity = "unknown"
    if len(slopes) >= 2:
        if all(slopes[i + 1] >= slopes[i] for i in range(len(slopes) - 1)):
            convexity = "convex"
        elif all(slopes[i + 1] <= slopes[i] for i in range(len(slopes) - 1)):
            convexity = "concave"
        else:
            convexity = "nonconvex"
    return {"monotonicity": monotonicity, "convexity": convexity, "slopes": slopes}


def _has_slope_jump(slopes: list[float]) -> bool:
    if len(slopes) < 2:
        return False
    non_zero = [abs(value) for value in slopes if abs(value) > 1e-9]
    baseline = min(non_zero) if non_zero else 0
    if baseline == 0:
        return any(abs(value) > 1e-9 for value in slopes)
    return max(abs(value) for value in slopes) / baseline >= 10


def _interpolate_piecewise_1d(x: float, points: list[list[float]]) -> float:
    if x < points[0][0] or x > points[-1][0]:
        raise HTTPException(status_code=422, detail={"message": "preview input is outside function domain", "x": x, "domain": {"x_min": points[0][0], "x_max": points[-1][0]}})
    for index in range(len(points) - 1):
        x0, y0 = points[index]
        x1, y1 = points[index + 1]
        if x0 <= x <= x1:
            if x1 == x0:
                return y0
            ratio = (x - x0) / (x1 - x0)
            return y0 + ratio * (y1 - y0)
    return points[-1][1]


function_asset_service = FunctionAssetService()
