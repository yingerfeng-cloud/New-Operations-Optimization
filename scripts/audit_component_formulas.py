from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.formulas.service import analyze_formula  # noqa: E402
from app.model_components.formula_components import normalize_component_payload  # noqa: E402
from app.model_components.formula_contracts import (  # noqa: E402
    formula_expression,
    normalize_participation,
    participates_in_solve,
    participation_fields,
)
from app.model_components.registry import list_component_catalog  # noqa: E402
from app.schemas.formula import FormulaAnalyzeRequest  # noqa: E402


FIXTURE_PATH = ROOT / "tests" / "fixtures" / "component_audit" / "compatibility_components.json"
DEFAULT_REPORT_PATH = ROOT / "reports" / "component_formula_audit.json"
INDEX_ALIASES = {"time": "t", "time_volume": "t", "state_time": "t", "soc_time": "t", "station": "s", "unit": "u", "edge": "e", "scenario": "sc"}


def _rows(value: Any) -> list[dict[str, Any]]:
    return [item for item in value or [] if isinstance(item, dict)]


def _row_id(row: dict[str, Any], kind: str, index: int) -> str:
    return str(row.get("constraint_id") or row.get("term_id") or row.get("code") or row.get("name") or f"{kind}_{index + 1}")


def _source_field(row: dict[str, Any]) -> str | None:
    for key in ("dsl_formula", "formula", "expression"):
        if row.get(key) is not None and str(row.get(key)).strip():
            return key
    return None


def _set_values(code: str) -> list[Any]:
    if code == "time":
        return [0, 1]
    if code in {"state_time", "time_volume", "soc_time"}:
        return [0, 1, 2]
    return [0, 1]


def _compile_context(component: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    set_rows = _rows(component.get("sets")) + _rows(component.get("required_sets"))
    sets: dict[str, dict[str, Any]] = {}
    for item in set_rows:
        code = str(item.get("code") or item.get("key") or item.get("name") or "")
        if code:
            sets[code] = {"code": code, "values": list(item.get("values") or item.get("members") or _set_values(code))}
    parameters = _rows(component.get("parameters") or component.get("inputs")) + _rows(component.get("derived_parameters"))
    variables = _rows(component.get("variables"))
    for item in [*parameters, *variables]:
        for dimension in item.get("dimension") or item.get("indices") or []:
            code = str(dimension)
            sets.setdefault(code, {"code": code, "values": _set_values(code)})
    time_set = next((code for code, item in sets.items() if code == "time" or item.get("type") == "time_period"), "time")
    state_set = next((code for code in sets if code in {"state_time", "time_volume", "soc_time"}), None)
    symbols = {
        "sets": sets,
        "parameters": [
            {"code": str(item.get("code") or item.get("key") or item.get("name")), "dimension": list(item.get("dimension") or item.get("indices") or [])}
            for item in parameters
        ],
        "variables": [
            {"code": str(item.get("code") or item.get("key") or item.get("name")), "dimension": list(item.get("dimension") or item.get("indices") or [])}
            for item in variables
        ],
    }
    return symbols, {"component_compile_sample_only": True, "time_dimension": {"time_set": time_set, "state_time_set": state_set}}


def _scope(row: dict[str, Any]) -> list[dict[str, str]]:
    source = row.get("scope") or row.get("indices") or []
    scope: list[dict[str, str]] = []
    for item in source:
        if isinstance(item, str):
            scope.append({"set": item, "alias": INDEX_ALIASES.get(item, item)})
        elif isinstance(item, dict):
            set_code = str(item.get("set") or item.get("code") or item.get("name") or "")
            if set_code:
                scope.append({"set": set_code, "alias": str(item.get("alias") or INDEX_ALIASES.get(set_code, set_code))})
    return scope


def audit_components() -> dict[str, Any]:
    builtins = [{**item, "_audit_source": "builtin"} for item in list_component_catalog()]
    fixtures = [{**item, "_audit_source": "fixture"} for item in json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))]
    details: list[dict[str, Any]] = []
    constraint_count = 0
    objective_count = 0
    empty_count = 0
    compile_failure_count = 0
    mismatch_count = 0

    for component in [*builtins, *fixtures]:
        normalized = normalize_component_payload(component)
        symbols, base_model_context = _compile_context(normalized)
        raw_sections = {
            "constraint": _rows(component.get("constraints") or component.get("generated_constraints")),
            "objective": _rows(component.get("objective_terms") or component.get("generated_objective_terms")),
        }
        normalized_sections = {
            "constraint": _rows(normalized.get("generated_constraints")),
            "objective": _rows(normalized.get("generated_objective_terms")),
        }
        for kind in ("constraint", "objective"):
            if kind == "constraint":
                constraint_count += len(normalized_sections[kind])
            else:
                objective_count += len(normalized_sections[kind])
            raw_by_id = {_row_id(row, kind, index): row for index, row in enumerate(raw_sections[kind])}
            for index, row in enumerate(normalized_sections[kind]):
                identifier = _row_id(row, kind, index)
                original = raw_by_id.get(identifier, raw_sections[kind][index] if index < len(raw_sections[kind]) else {})
                expression = formula_expression(row)
                source_field = _source_field(original)
                expected_fields = participation_fields(original, default="preview_only" if kind == "objective" else "solve_active")
                mismatch = any(row.get(key) != expected_fields[key] for key in expected_fields)
                empty = not expression
                if mismatch:
                    mismatch_count += 1
                if empty:
                    empty_count += 1
                compile_result: dict[str, Any] = {"success": False, "status": "not_run", "diagnostics": []}
                programmatic = bool(row.get("programmatic") or row.get("generation_mode") == "programmatic")
                if programmatic:
                    compile_result = {"success": True, "status": "programmatic", "diagnostics": []}
                elif expression:
                    boundary_strategy = str(row.get("boundary_strategy") or "strict")
                    request = FormulaAnalyzeRequest(
                        formula=expression,
                        formula_type=kind,
                        participation="solve_active" if participates_in_solve(row, default="preview_only" if kind == "objective" else "solve_active") else "preview_only",
                        ast_version="1.0",
                        formula_id=identifier,
                        objective_direction="minimize" if kind == "objective" else None,
                        scope=_scope(row),
                        symbols=symbols,
                        model_context={**base_model_context, "boundary_strategy": boundary_strategy},
                    )
                    compile_result = analyze_formula(request, compile_requested=True, expand_requested=True)
                    expected_compiled = participates_in_solve(row, default="preview_only" if kind == "objective" else "solve_active")
                    compiled_ok = bool(compile_result.get("compiled_fragment")) if expected_compiled else compile_result.get("status") == "preview_only"
                    if not compile_result.get("success") or not compiled_ok:
                        compile_failure_count += 1
                details.append(
                    {
                        "component_id": normalized.get("component_id"),
                        "source": component.get("_audit_source"),
                        "formula_id": identifier,
                        "kind": kind,
                        "source_field": source_field,
                        "normalized_expression": expression,
                        "empty": empty,
                        "participation": normalize_participation(row, default="preview_only" if kind == "objective" else "solve_active"),
                        "enters_solve": participates_in_solve(row, default="preview_only" if kind == "objective" else "solve_active"),
                        "participation_mismatch": mismatch,
                        "boundary_strategy": row.get("boundary_strategy"),
                        "has_state_offset": "t+" in expression.replace(" ", "") or "t-" in expression.replace(" ", ""),
                        "compile_status": compile_result.get("status"),
                        "compile_success": compile_result.get("success"),
                        "boundary_artifact": {
                            key: (compile_result.get("compiled_fragment") or {}).get(key)
                            for key in ("boundary_strategy", "source_set", "target_set", "offset", "effective_scope", "excluded_boundary_count")
                            if key in (compile_result.get("compiled_fragment") or {})
                        },
                        "diagnostics": compile_result.get("diagnostics") or [],
                    }
                )
    return {
        "component_ids": sorted(str(item.get("component_id") or item.get("type")) for item in [*builtins, *fixtures]),
        "component_count": len(builtins) + len(fixtures),
        "builtin_component_count": len(builtins),
        "fixture_component_count": len(fixtures),
        "constraint_count": constraint_count,
        "objective_count": objective_count,
        "empty_formula_count": empty_count,
        "compile_failure_count": compile_failure_count,
        "participation_mismatch_count": mismatch_count,
        "details": details,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit built-in and fixed-fixture component formulas without runtime_store.json.")
    parser.add_argument("--output", type=Path, default=DEFAULT_REPORT_PATH)
    args = parser.parse_args()
    report = audit_components()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    failures = report["empty_formula_count"] + report["compile_failure_count"] + report["participation_mismatch_count"]
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
