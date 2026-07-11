from __future__ import annotations

import csv
import math
import uuid
from copy import deepcopy
from io import StringIO
from typing import Any

from fastapi import HTTPException

from app.schemas.function_asset import FunctionAsset
from app.storage.memory_store import STORE
from app.utils import now_text

PUBLISH_READY_STATUSES = {"published", "trial", "active", "tested", "已发布", "试运行", "已测试"}

CASCADE_HYDRO_SAMPLE_FUNCTION_ASSETS: list[dict[str, Any]] = [
    {
        "function_id": "cascade_hydro_level_storage_v1",
        "name": "梯级水电样例水位库容曲线 v1",
        "description": "Sample 1D PWL asset for cascade_hydro_dispatch_v1: level = f(storage).",
        "function_type": "piecewise_1d",
        "input_schema": [{"code": "storage", "name": "库容", "unit": "million m3", "type": "number"}],
        "output_schema": {"code": "level", "name": "上游水位", "unit": "m", "type": "number"},
        "points": [[80, 300], [100, 306], [120, 312], [140, 319], [170, 330]],
        "solve_strategy": "segment_binary",
        "interpolation_mode": "segment_binary",
        "out_of_domain_policy": "reject",
        "allow_extrapolation": False,
        "status": "published",
        "metadata": {"sample_asset": True, "model_code": "cascade_hydro_dispatch", "asset_version": "2026-07-11-strict-pwl"},
    },
    {
        "function_id": "cascade_hydro_tailwater_outflow_v1",
        "name": "梯级水电样例尾水位流量曲线 v1",
        "description": "Sample 1D PWL asset for cascade_hydro_dispatch_v1: tailwater = f(outflow).",
        "function_type": "piecewise_1d",
        "input_schema": [{"code": "outflow", "name": "出库流量", "unit": "m3/s", "type": "number"}],
        "output_schema": {"code": "tailwater", "name": "尾水位", "unit": "m", "type": "number"},
        "points": [[40, 262], [80, 264], [120, 266], [160, 268]],
        "solve_strategy": "segment_binary",
        "interpolation_mode": "segment_binary",
        "out_of_domain_policy": "reject",
        "allow_extrapolation": False,
        "status": "published",
        "metadata": {"sample_asset": True, "model_code": "cascade_hydro_dispatch", "asset_version": "2026-07-11-strict-pwl"},
    },
    {
        "function_id": "cascade_hydro_power_flow_v1",
        "name": "梯级水电示例流量出力曲线 v1",
        "description": "示例 1D 严格 PWL 资产，仅用于工程演示：power = f(generation flow)。",
        "function_type": "piecewise_1d",
        "input_schema": [{"code": "q_gen", "name": "发电流量", "unit": "m3/s", "type": "number"}],
        "output_schema": {"code": "power", "name": "出力", "unit": "MW", "type": "number"},
        "points": [[40, 14], [80, 30], [120, 49], [160, 70]],
        "solve_strategy": "segment_binary",
        "interpolation_mode": "segment_binary",
        "out_of_domain_policy": "reject",
        "allow_extrapolation": False,
        "status": "published",
        "metadata": {"sample_asset": True, "model_code": "cascade_hydro_dispatch", "asset_version": "2026-07-11-strict-pwl", "data_class": "illustrative_not_station_curve"},
    },
    {
        "function_id": "cascade_hydro_power_surface_v1",
        "name": "梯级水电样例出力曲面 v1",
        "description": "Sample 2D PWL asset for cascade_hydro_dispatch_v1: power = f(outflow, head).",
        "function_type": "piecewise_2d",
        "input_schema": [
            {"code": "outflow", "name": "出库流量", "unit": "m3/s", "type": "number"},
            {"code": "head", "name": "水头", "unit": "m", "type": "number"},
        ],
        "output_schema": {"code": "power", "name": "出力", "unit": "MW", "type": "number"},
        "points_2d": [
            [40, 35, 12.012], [40, 45, 15.444], [40, 55, 18.876], [40, 65, 22.308],
            [80, 35, 24.024], [80, 45, 30.888], [80, 55, 37.752], [80, 65, 44.616],
            [120, 35, 36.036], [120, 45, 46.332], [120, 55, 56.628], [120, 65, 66.924],
            [160, 35, 48.048], [160, 45, 61.776], [160, 55, 75.504], [160, 65, 89.232]
        ],
        "triangles": [
            [0, 4, 1], [4, 5, 1], [1, 5, 2], [5, 6, 2], [2, 6, 3], [6, 7, 3],
            [4, 8, 5], [8, 9, 5], [5, 9, 6], [9, 10, 6], [6, 10, 7], [10, 11, 7],
            [8, 12, 9], [12, 13, 9], [9, 13, 10], [13, 14, 10], [10, 14, 11], [14, 15, 11]
        ],
        "solve_strategy": "triangulated_milp_exact",
        "out_of_domain_policy": "reject",
        "allow_extrapolation": False,
        "status": "published",
        "metadata": {"sample_asset": True, "model_code": "cascade_hydro_dispatch", "asset_version": "2026-07-11-grid-4x4", "data_class": "illustrative_not_station_curve"},
    },
]


class FunctionAssetService:
    def list_assets(self) -> list[FunctionAsset]:
        self.seed_default_assets()
        with STORE.lock:
            raw_assets = [deepcopy(item) for item in STORE.function_assets.values()]
        rows = [self._with_references(_normalize_schema_fields(item)) for item in raw_assets]
        return sorted((FunctionAsset(**item) for item in rows), key=lambda item: item.updated_at or "", reverse=True)

    def seed_default_assets(self) -> None:
        with STORE.lock:
            rows_to_seed = []
            for payload in CASCADE_HYDRO_SAMPLE_FUNCTION_ASSETS:
                existing = STORE.function_assets.get(str(payload["function_id"]))
                existing_meta = existing.get("metadata") if isinstance(existing, dict) else {}
                payload_meta = payload.get("metadata") or {}
                if not existing or (
                    existing_meta.get("sample_asset") is True
                    and existing_meta.get("asset_version") != payload_meta.get("asset_version")
                ):
                    rows_to_seed.append(payload)
        if not rows_to_seed:
            return
        normalized = [self._normalize(payload, creating=True) for payload in rows_to_seed]
        created = False
        with STORE.lock:
            for asset in normalized:
                existing = STORE.function_assets.get(asset["function_id"])
                existing_meta = existing.get("metadata") if isinstance(existing, dict) else {}
                if not existing or existing_meta.get("sample_asset") is True:
                    STORE.function_assets[asset["function_id"]] = asset
                    created = True
            if created:
                STORE.save_runtime()

    def create_asset(self, payload: dict[str, Any]) -> FunctionAsset:
        asset = self._normalize(payload, creating=True)
        with STORE.lock:
            if asset["function_id"] in STORE.function_assets:
                raise HTTPException(status_code=409, detail=f"Function asset already exists: {asset['function_id']}")
            STORE.function_assets[asset["function_id"]] = asset
            STORE.save_runtime()
        return FunctionAsset(**self._with_references(asset))

    def get_asset(self, function_id: str) -> FunctionAsset:
        self.seed_default_assets()
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
        if str(asset.get("function_type") or "piecewise_1d") == "piecewise_2d":
            return _preview_piecewise_2d(asset, payload or {}, validation)
        points = [[float(point[0]), float(point[1])] for point in asset.get("points") or []]
        raw_inputs = (payload or {}).get("inputs")
        if raw_inputs is None:
            xs = [point[0] for point in points]
            if len(xs) >= 2:
                step = (xs[-1] - xs[0]) / 4
                raw_inputs = [xs[0] + step * i for i in range(5)]
            else:
                raw_inputs = xs
        policy = str(asset.get("out_of_domain_policy") or "reject")
        values = []
        for raw_x in raw_inputs:
            requested_x = float(raw_x)
            evaluated_x = requested_x
            clamped = False
            if policy == "clamp":
                evaluated_x = min(max(requested_x, points[0][0]), points[-1][0])
                clamped = evaluated_x != requested_x
            values.append({"x": evaluated_x, "requested_x": requested_x, "y": _interpolate_piecewise_1d(evaluated_x, points), "boundary_clamped": clamped})
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
        function_type = str(payload.get("function_type") or "piecewise_1d")
        x_field = str(payload.get("x_field") or (fields[0] if fields else "")).strip()
        y_field = str(payload.get("y_field") or (fields[1] if len(fields) > 1 else "")).strip()
        z_field = str(payload.get("z_field") or (fields[2] if function_type == "piecewise_2d" and len(fields) > 2 else "")).strip()
        group_field = str(payload.get("group_field") or "").strip()
        if not x_field or not y_field or x_field not in fields or y_field not in fields:
            raise HTTPException(status_code=422, detail={"message": "CSV must include selected x/y fields", "fields": fields, "x_field": x_field, "y_field": y_field})
        if function_type == "piecewise_2d" and (not z_field or z_field not in fields):
            raise HTTPException(status_code=422, detail={"message": "CSV must include selected x/y/z fields", "fields": fields, "x_field": x_field, "y_field": y_field, "z_field": z_field})
        rows = list(reader)
        points: list[list[float]] = []
        points_2d: list[list[float]] = []
        grouped: dict[str, list[list[float]]] = {}
        for index, row in enumerate(rows, start=2):
            try:
                if function_type == "piecewise_2d":
                    point_2d = [float(row[x_field]), float(row[y_field]), float(row[z_field])]
                else:
                    point = [float(row[x_field]), float(row[y_field])]
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=422, detail={"message": "CSV selected numeric fields must be numeric", "row": index, "x_field": x_field, "y_field": y_field, "z_field": z_field or None}) from exc
            if function_type == "piecewise_2d":
                points_2d.append(point_2d)
                continue
            if group_field and group_field in fields:
                grouped.setdefault(str(row.get(group_field) or ""), []).append(point)
            else:
                points.append(point)
        if function_type != "piecewise_2d" and grouped:
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
            "function_type": function_type,
            "input_schema": (
                [
                    {"code": x_field, "name": payload.get("x_name") or x_field, "unit": payload.get("x_unit") or "", "type": "number"},
                    {"code": y_field, "name": payload.get("y_name") or y_field, "unit": payload.get("y_unit") or "", "type": "number"},
                ]
                if function_type == "piecewise_2d"
                else [{"code": x_field, "name": payload.get("x_name") or x_field, "unit": payload.get("x_unit") or "", "type": "number"}]
            ),
            "output_schema": (
                {"code": z_field, "name": payload.get("z_name") or z_field, "unit": payload.get("z_unit") or "", "type": "number"}
                if function_type == "piecewise_2d"
                else {"code": y_field, "name": payload.get("y_name") or y_field, "unit": payload.get("y_unit") or "", "type": "number"}
            ),
            "group_keys": [group_field] if group_field else [],
            "interpolation": payload.get("interpolation") or "linear",
            "interpolation_mode": payload.get("interpolation_mode") or ("triangulated" if function_type == "piecewise_2d" else "segment_binary"),
            "out_of_domain_policy": payload.get("out_of_domain_policy") or "reject",
            "allow_extrapolation": bool(payload.get("allow_extrapolation", False)),
            "solve_strategy": payload.get("solve_strategy") or ("triangulated_milp_exact" if function_type == "piecewise_2d" else "segment_binary"),
            "status": "draft",
            "points": points,
            "points_2d": points_2d,
            "triangles": payload.get("triangles") or [],
            "surface_mode": payload.get("surface_mode") or ("triangulated" if function_type == "piecewise_2d" else None),
            "metadata": {
                "source": "csv_import",
                "fields": fields,
                "sample_rows": rows[:20],
                "field_mapping": {"x": x_field, "y": y_field, "z": z_field or None, "group": group_field or None},
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
        function_type = str(payload.get("function_type") or "piecewise_1d")
        points = _normalize_points(payload.get("points") or [])
        points_2d = _normalize_points_2d(payload.get("points_2d") or [])
        triangles = _normalize_triangles(payload.get("triangles") or [])
        normalized = {
            **deepcopy(payload),
            "function_id": function_id,
            "name": payload.get("name") or function_id,
            "function_type": function_type,
            "input_schema": _normalize_input_schema(payload.get("input_schema")),
            "output_schema": _normalize_output_schema(payload.get("output_schema")),
            "group_keys": list(payload.get("group_keys") or []),
            "interpolation": payload.get("interpolation") or "linear",
            "points": points,
            "points_2d": points_2d,
            "triangles": triangles,
            "surface_mode": payload.get("surface_mode") or ("triangulated" if function_type == "piecewise_2d" else None),
            "domain": dict(payload.get("domain") or {}),
            "x_domain": payload.get("x_domain"),
            "y_domain": payload.get("y_domain"),
            "z_range": payload.get("z_range"),
            "triangulation_status": payload.get("triangulation_status"),
            "surface_diagnostics": dict(payload.get("surface_diagnostics") or {}),
            "monotonicity": payload.get("monotonicity"),
            "solve_strategy": payload.get("solve_strategy") or ("triangulated_milp_exact" if function_type == "piecewise_2d" else "convex_combination_lp"),
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
        if normalized["function_type"] == "piecewise_2d":
            normalized["triangles"] = validation["diagnostics"].get("triangles") or normalized["triangles"]
            normalized["surface_mode"] = normalized.get("surface_mode") or "triangulated"
            normalized["x_domain"] = validation["domain"].get("x_domain")
            normalized["y_domain"] = validation["domain"].get("y_domain")
            normalized["z_range"] = validation["domain"].get("z_range")
            normalized["triangulation_status"] = validation["diagnostics"].get("triangulation_status")
            normalized["surface_diagnostics"] = validation["diagnostics"]
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
    interpolation_mode = str(asset.get("interpolation_mode") or asset.get("solve_strategy") or "segment_binary").lower()
    out_of_domain_policy = str(asset.get("out_of_domain_policy") or "reject").lower()
    if function_type == "piecewise_2d":
        return _validate_piecewise_2d(asset)
    if function_type == "piecewise_nd":
        return {
            "valid": False,
            "validation_status": "invalid",
            "validation_errors": [{"field": "function_type", "message": "piecewise_nd is reserved and cannot be published or solved in this phase", "actual": function_type}],
            "validation_warnings": [],
            "errors": [{"field": "function_type", "message": "piecewise_nd is reserved and cannot be published or solved in this phase", "actual": function_type}],
            "warnings": [],
            "domain": {},
            "diagnostics": {"valid": False, "validation_status": "invalid", "recommended_solve_strategy": "display_only"},
        }
    points = asset.get("points") or []
    declared_domain = asset.get("domain") or {}
    domain: dict[str, Any] = {}
    diagnostics: dict[str, Any] = {}
    if function_type != "piecewise_1d":
        errors.append({"field": "function_type", "message": "only piecewise_1d is supported in this phase", "actual": function_type})
    if interpolation != "linear":
        errors.append({"field": "interpolation", "message": "piecewise_1d only supports linear interpolation", "actual": interpolation})
    if interpolation_mode not in {"segment_binary", "sos2", "binary_segment_milp", "convex_combination_lp"}:
        errors.append({"field": "interpolation_mode", "message": "unsupported 1D interpolation mode", "actual": interpolation_mode})
    if out_of_domain_policy not in {"reject", "clamp"}:
        errors.append({"field": "out_of_domain_policy", "message": "policy must be reject or clamp", "actual": out_of_domain_policy})
    if bool(asset.get("allow_extrapolation", False)):
        errors.append({"field": "allow_extrapolation", "message": "production PWL assets do not permit extrapolation", "actual": True, "expected": False})
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
        diagnostics["interpolation_mode"] = "segment_binary" if interpolation_mode in {"binary_segment_milp", "convex_combination_lp"} else interpolation_mode
        diagnostics["out_of_domain_policy"] = out_of_domain_policy
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


def _validate_piecewise_2d(asset: dict[str, Any]) -> dict[str, Any]:
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    points = asset.get("points_2d") or []
    triangles = _normalize_triangles(asset.get("triangles") or [])
    strategy = str(asset.get("solve_strategy") or "triangulated_milp_exact")
    diagnostics: dict[str, Any] = {
        "surface_mode": asset.get("surface_mode") or "triangulated",
        "solve_strategy": strategy,
        "recommended_solve_strategy": "triangulated_milp_exact",
    }
    domain: dict[str, Any] = {}
    normalized_points: list[list[float]] = []
    seen_xy: dict[tuple[float, float], int] = {}

    if strategy not in {"display_only", "triangulated_milp_exact", "convex_hull_lp_approx"}:
        errors.append({"field": "solve_strategy", "message": "unsupported 2D solve strategy", "actual": strategy})
    if not isinstance(points, list) or len(points) < 3:
        errors.append({"field": "points_2d", "message": "piecewise_2d requires at least three [x, y, z] points"})
    for index, point in enumerate(points if isinstance(points, list) else []):
        if not isinstance(point, (list, tuple)) or len(point) != 3:
            errors.append({"field": f"points_2d[{index}]", "message": "point must be [x, y, z]"})
            continue
        x, y, z = point
        if not all(isinstance(value, (int, float)) and math.isfinite(float(value)) for value in (x, y, z)):
            errors.append({"field": f"points_2d[{index}]", "message": "x/y/z must be finite numeric values", "actual": point})
            continue
        row = [float(x), float(y), float(z)]
        key = (row[0], row[1])
        if key in seen_xy:
            errors.append({"field": f"points_2d[{index}]", "message": "duplicate (x,y) point is not allowed", "actual": point, "first_index": seen_xy[key]})
        else:
            seen_xy[key] = index
        normalized_points.append(row)

    if normalized_points:
        xs = sorted({point[0] for point in normalized_points})
        ys = sorted({point[1] for point in normalized_points})
        zs = [point[2] for point in normalized_points]
        domain = {
            "x_min": min(xs),
            "x_max": max(xs),
            "y_min": min(ys),
            "y_max": max(ys),
            "z_min": min(zs),
            "z_max": max(zs),
            "x_domain": [min(xs), max(xs)],
            "y_domain": [min(ys), max(ys)],
            "z_range": [min(zs), max(zs)],
            "point_count": len(normalized_points),
            "breakpoint_count": len(normalized_points),
        }
        grid = _regular_grid_diagnostics(normalized_points)
        diagnostics.update(grid)
        if grid["is_regular_grid"] and not triangles:
            triangles = _triangulate_regular_grid(normalized_points, grid["x_values"], grid["y_values"])
            diagnostics["triangulation_status"] = "auto_grid_triangulated"
        elif triangles:
            diagnostics["triangulation_status"] = "provided"
        else:
            diagnostics["triangulation_status"] = "missing"
            diagnostics["recommended_solve_strategy"] = "display_only"
            warnings.append({"field": "triangles", "message": "non-grid scattered 2D points require user-provided triangles for solve participation"})
            if strategy == "triangulated_milp_exact":
                errors.append({"field": "triangles", "message": "triangles are required for non-grid triangulated_milp_exact assets"})
        diagnostics["triangles"] = triangles
        diagnostics["triangle_count"] = len(triangles)
        diagnostics["can_triangulate"] = bool(triangles)
        diagnostics["possible_extrapolation"] = "preview and solve are restricted to the triangulated domain"
        diagnostics.update(_surface_shape_diagnostics(normalized_points, triangles))
        for tri_index, triangle in enumerate(triangles):
            if len(triangle) != 3:
                errors.append({"field": f"triangles[{tri_index}]", "message": "triangle must contain exactly three point indices", "actual": triangle})
                continue
            if any(not isinstance(idx, int) or idx < 0 or idx >= len(normalized_points) for idx in triangle):
                errors.append({"field": f"triangles[{tri_index}]", "message": "triangle point index out of range", "actual": triangle})
                continue
            if _triangle_area(normalized_points, triangle) <= 1e-10:
                errors.append({"field": f"triangles[{tri_index}]", "message": "degenerate triangle: three points are collinear", "actual": triangle})
        if grid.get("missing_grid_points") and diagnostics["surface_mode"] in {"regular_grid", "grid"}:
            warnings.append({"field": "points_2d", "message": "regular grid has missing points", "actual": grid["missing_grid_points"][:10]})
        if strategy == "convex_hull_lp_approx":
            warnings.append({"field": "solve_strategy", "message": "convex_hull_lp_approx is not an exact representation for general 2D surfaces"})
        if len(normalized_points) > 200:
            warnings.append({"field": "points_2d", "message": "2D PWL point count exceeds the default recommended limit of 200", "actual": len(normalized_points)})
        if len(triangles) > 400:
            warnings.append({"field": "triangles", "message": "2D PWL triangle count exceeds the default recommended limit of 400", "actual": len(triangles)})

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


def _regular_grid_diagnostics(points: list[list[float]]) -> dict[str, Any]:
    xs = sorted({point[0] for point in points})
    ys = sorted({point[1] for point in points})
    existing = {(point[0], point[1]) for point in points}
    expected = {(x, y) for x in xs for y in ys}
    missing = sorted(expected - existing)
    return {
        "x_values": xs,
        "y_values": ys,
        "is_regular_grid": len(xs) >= 2 and len(ys) >= 2 and not missing and len(points) == len(expected),
        "missing_grid_points": [[x, y] for x, y in missing],
    }


def _triangulate_regular_grid(points: list[list[float]], xs: list[float], ys: list[float]) -> list[list[int]]:
    index_by_xy = {(point[0], point[1]): index for index, point in enumerate(points)}
    triangles: list[list[int]] = []
    for xi in range(len(xs) - 1):
        for yi in range(len(ys) - 1):
            p00 = index_by_xy[(xs[xi], ys[yi])]
            p10 = index_by_xy[(xs[xi + 1], ys[yi])]
            p01 = index_by_xy[(xs[xi], ys[yi + 1])]
            p11 = index_by_xy[(xs[xi + 1], ys[yi + 1])]
            triangles.append([p00, p10, p01])
            triangles.append([p10, p11, p01])
    return triangles


def _triangle_area(points: list[list[float]], triangle: list[int]) -> float:
    p1, p2, p3 = [points[index] for index in triangle]
    return abs((p2[0] - p1[0]) * (p3[1] - p1[1]) - (p3[0] - p1[0]) * (p2[1] - p1[1])) / 2.0


def _surface_shape_diagnostics(points: list[list[float]], triangles: list[list[int]]) -> dict[str, Any]:
    if not points:
        return {"monotonicity": "unknown", "convexity": "unknown"}
    by_y: dict[float, list[list[float]]] = {}
    by_x: dict[float, list[list[float]]] = {}
    for point in points:
        by_y.setdefault(point[1], []).append(point)
        by_x.setdefault(point[0], []).append(point)

    def direction(groups: dict[float, list[list[float]]], sort_pos: int) -> str:
        signs: list[int] = []
        for rows in groups.values():
            ordered = sorted(rows, key=lambda item: item[sort_pos])
            for idx in range(len(ordered) - 1):
                delta = ordered[idx + 1][2] - ordered[idx][2]
                if abs(delta) > 1e-9:
                    signs.append(1 if delta > 0 else -1)
        if not signs:
            return "constant"
        if all(item >= 0 for item in signs):
            return "increasing"
        if all(item <= 0 for item in signs):
            return "decreasing"
        return "non_monotone"

    return {
        "monotonicity": {"x": direction(by_y, 0), "y": direction(by_x, 1)},
        "convexity": "unknown",
        "degenerate_triangle_count": sum(1 for tri in triangles if len(tri) == 3 and _triangle_area(points, tri) <= 1e-10),
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
    function_asset_service.seed_default_assets()
    with STORE.lock:
        asset = deepcopy(STORE.function_assets.get(function_id) or {})
    if not asset:
        raise RuntimeError(f"function asset not found: {function_id}")
    validation = validate_function_asset(asset)
    if not validation["valid"]:
        raise RuntimeError(f"function asset {function_id} is invalid: {validation['errors']}")
    return [[float(point[0]), float(point[1])] for point in asset.get("points") or []]


def get_function_asset_surface(function_id: str) -> dict[str, Any]:
    function_asset_service.seed_default_assets()
    with STORE.lock:
        asset = deepcopy(STORE.function_assets.get(function_id) or {})
    if not asset:
        raise RuntimeError(f"function asset not found: {function_id}")
    validation = validate_function_asset(asset)
    if not validation["valid"]:
        raise RuntimeError(f"function asset {function_id} is invalid: {validation['errors']}")
    if asset.get("function_type") != "piecewise_2d":
        raise RuntimeError(f"function asset {function_id} is not piecewise_2d")
    return {
        "asset": asset,
        "points_2d": [[float(point[0]), float(point[1]), float(point[2])] for point in asset.get("points_2d") or []],
        "triangles": validation["diagnostics"].get("triangles") or asset.get("triangles") or [],
        "domain": validation["domain"],
        "diagnostics": validation["diagnostics"],
    }


def get_function_asset(function_id: str) -> dict[str, Any]:
    function_asset_service.seed_default_assets()
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


def _normalize_points_2d(points: Any) -> list[list[float]]:
    rows: list[list[float]] = []
    if not isinstance(points, list):
        return rows
    for point in points:
        if isinstance(point, dict):
            point = [point.get("x"), point.get("y"), point.get("z")]
        if isinstance(point, (list, tuple)) and len(point) == 3 and all(isinstance(value, (int, float)) for value in point):
            rows.append([float(point[0]), float(point[1]), float(point[2])])
        else:
            rows.append(point)
    return rows


def _normalize_triangles(triangles: Any) -> list[list[int]]:
    rows: list[list[int]] = []
    if not isinstance(triangles, list):
        return rows
    for triangle in triangles:
        if isinstance(triangle, (list, tuple)) and len(triangle) == 3 and all(isinstance(value, int) for value in triangle):
            rows.append([int(triangle[0]), int(triangle[1]), int(triangle[2])])
        else:
            rows.append(triangle)
    return rows


def _preview_piecewise_2d(asset: dict[str, Any], payload: dict[str, Any], validation: dict[str, Any]) -> dict[str, Any]:
    points = [[float(point[0]), float(point[1]), float(point[2])] for point in asset.get("points_2d") or []]
    triangles = validation["diagnostics"].get("triangles") or asset.get("triangles") or []
    x = payload.get("x")
    y = payload.get("y")
    if x is None or y is None:
        domain = validation.get("domain") or {}
        x = (float(domain.get("x_min", 0)) + float(domain.get("x_max", 0))) / 2
        y = (float(domain.get("y_min", 0)) + float(domain.get("y_max", 0))) / 2
    requested_x = float(x)
    requested_y = float(y)
    x_float = requested_x
    y_float = requested_y
    boundary_clamped = False
    if str(asset.get("out_of_domain_policy") or "reject") == "clamp":
        domain = validation.get("domain") or {}
        x_float = min(max(x_float, float(domain.get("x_min", x_float))), float(domain.get("x_max", x_float)))
        y_float = min(max(y_float, float(domain.get("y_min", y_float))), float(domain.get("y_max", y_float)))
        boundary_clamped = x_float != requested_x or y_float != requested_y
    found = _interpolate_piecewise_2d(x_float, y_float, points, triangles)
    base = {
        "function_id": asset["function_id"],
        "function_type": "piecewise_2d",
        "x": x_float,
        "y": y_float,
        "requested_x": requested_x,
        "requested_y": requested_y,
        "boundary_clamped": boundary_clamped,
        "domain": validation["domain"],
        "diagnostics": validation["diagnostics"],
        "validation_status": validation["validation_status"],
        "validation_errors": validation["errors"],
        "validation_warnings": validation["warnings"],
    }
    if found is None:
        return {**base, "status": "outside_domain", "message": "输入点超出二维曲面定义域"}
    z, triangle, lambdas = found
    return {**base, "z": z, "triangle": triangle, "lambda": lambdas, "status": "inside_domain"}


def _interpolate_piecewise_2d(x: float, y: float, points: list[list[float]], triangles: list[list[int]]) -> tuple[float, list[int], list[float]] | None:
    for triangle in triangles:
        if len(triangle) != 3:
            continue
        lambdas = _barycentric_weights(x, y, [points[index] for index in triangle])
        if lambdas is None:
            continue
        if all(value >= -1e-8 for value in lambdas):
            cleaned = [0.0 if abs(value) < 1e-8 else float(value) for value in lambdas]
            total = sum(cleaned)
            if total:
                cleaned = [value / total for value in cleaned]
            z = sum(cleaned[idx] * points[triangle[idx]][2] for idx in range(3))
            return float(z), list(triangle), cleaned
    return None


def _barycentric_weights(x: float, y: float, triangle_points: list[list[float]]) -> list[float] | None:
    (x1, y1, _), (x2, y2, _), (x3, y3, _) = triangle_points
    det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
    if abs(det) <= 1e-12:
        return None
    l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / det
    l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / det
    l3 = 1.0 - l1 - l2
    return [l1, l2, l3]


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
