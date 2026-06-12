from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import importlib.util
import re
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.model_draft import build_mathematical_expansion, create_model_draft_from_template, generate_set_members
from app.problem_type_diagnosis import infer_problem_type_from_draft
from app.semantic.semantic_validator import FORMULA_NOT_GENERATED, constraint_display_formula
from app.services.template_service import template_library
from app.storage.memory_store import STORE


ROOT = Path(__file__).resolve().parents[1]
FRONTEND_MODELING = (ROOT / "static" / "js" / "platform-pages-modeling.js").read_text(encoding="utf-8")
FRONTEND_DIAGNOSIS = (ROOT / "static" / "js" / "problem_type_diagnosis.js").read_text(encoding="utf-8")
FRONTEND_CSS = (ROOT / "static" / "css" / "platform.css").read_text(encoding="utf-8")
client = TestClient(app)


def _minimal_generic_model_payload(model_id: str) -> dict:
    return {
        "id": model_id,
        "name": f"generic-zero-check-{uuid.uuid4().hex[:6]}",
        "scene": "自定义模型",
        "semantic_spec": {
            "model_code": "custom_optimization_model",
            "sets": [
                {"key": "unit", "name": "机组集合", "values": ["U1", "U2"]},
                {"key": "time", "name": "调度时段集合", "values": ["T0", "T1"]},
            ],
            "parameters": [
                {"key": "load_forecast", "math_param": "load_forecast", "dimension": ["time"], "runtime_injected": True},
                {"key": "fuel_cost", "math_param": "fuel_cost", "dimension": ["unit"], "runtime_injected": True},
            ],
            "variables": [{"key": "unit_output", "math_var": "unit_output", "dimension": ["unit", "time"], "domain": "NonNegativeReals"}],
            "constraints": [{"code": "power_balance", "foreach": ["time"], "business_rule": "供需平衡"}],
            "objectives": [{"code": "total_cost_min", "name": "总成本最小", "sense": "minimize"}],
        },
        "generic_spec": {
            "sense": "minimize",
            "sets": {"unit": ["U1", "U2"], "time": ["T0", "T1"]},
            "parameters": {
                "load_forecast": {"T0": 100, "T1": 120},
                "fuel_cost": {"U1": 10, "U2": 20},
            },
            "variables": [{"name": "unit_output", "indices": ["unit", "time"], "domain": "NonNegativeReals", "lb": 0}],
            "constraints": [
                {
                    "name": "power_balance",
                    "foreach": ["time"],
                    "terms": [{"var": "unit_output", "foreach": ["unit"], "key": ["unit", "time"], "coef": 1}],
                    "sense": ">=",
                    "rhs_param": "load_forecast",
                    "rhs_key": ["time"],
                }
            ],
            "objective": {
                "terms": [{"name": "total_cost_min", "var": "unit_output", "foreach": ["unit", "time"], "key": ["unit", "time"], "coef_param": "fuel_cost", "param_key": ["unit"]}],
                "constant": 0,
            },
        },
    }


def test_blank_model_does_not_inherit_unit_commitment_semantics() -> None:
    assert "function resetBlankModelState" in FRONTEND_MODELING
    reset_body = FRONTEND_MODELING[
        FRONTEND_MODELING.index("function resetBlankModelState") : FRONTEND_MODELING.index("function buildModelPackage")
    ]
    assert "semantic.sets = []" in reset_body
    assert "semantic.parameters = []" in reset_body
    assert "semantic.variables = []" in reset_body
    assert "state.modelDraft = {}" in reset_body
    assert "state.componentSpecText = '{}'" in reset_body
    assert "state.genericIndexedConstraintsText = JSON.stringify([], null, 2)" in reset_body
    assert "state.runtimeParametersText = JSON.stringify({}, null, 2)" in reset_body


def test_blank_model_forms_use_neutral_seed_values() -> None:
    assert 'id="semanticObjectName" value="火电机组"' not in FRONTEND_MODELING
    assert 'id="semanticParamKey" value="load_forecast"' not in FRONTEND_MODELING
    assert 'id="semanticVarKey" value="unit_output"' not in FRONTEND_MODELING
    assert 'id="semanticConstraintCode" value="power_balance"' not in FRONTEND_MODELING
    assert "inferSemanticSetType(key, name" in FRONTEND_MODELING
    assert "标量直接填值；数组/对象使用 JSON 的 [] 或 {}" in FRONTEND_MODELING


def test_formula_layer_uses_unified_formula_list_entries() -> None:
    assert "addGenericConstraintFormula" in FRONTEND_MODELING
    assert "addGenericObjectiveFormula" in FRONTEND_MODELING
    assert "openGenericConstraintFormulaEditor" in FRONTEND_MODELING
    assert "openGenericObjectiveFormulaEditor" in FRONTEND_MODELING
    assert "indexedConstraintAggregate" not in FRONTEND_MODELING[FRONTEND_MODELING.index("function formulaConstraintBlock") : FRONTEND_MODELING.index("function formulaObjectiveBlock")]
    assert "indexedObjectiveForeach" not in FRONTEND_MODELING[FRONTEND_MODELING.index("function formulaObjectiveBlock") : FRONTEND_MODELING.index("function formulaPreviewBlock")]
    assert "`objective_term_${(parts.objective?.terms || []).length + 1}`" not in FRONTEND_MODELING


def test_power_balance_generates_real_expression() -> None:
    constraint = _minimal_generic_model_payload(f"MODEL-FORMULA-{uuid.uuid4().hex[:6]}")["generic_spec"]["constraints"][0]
    assert constraint_display_formula(constraint) == "sum(unit_output[unit,time] for unit in unit) >= load_forecast[time]"


def test_empty_constraint_expression_not_fallback_to_zero() -> None:
    constraint = {"name": "empty", "foreach": ["time"], "terms": [], "sense": ">=", "rhs": 0}
    assert constraint_display_formula(constraint) == FORMULA_NOT_GENERATED
    assert "0 >= 0" not in constraint_display_formula(constraint)


def test_publish_rejects_trivial_zero_constraint() -> None:
    payload = _minimal_generic_model_payload(f"MODEL-ZERO-{uuid.uuid4().hex[:6]}")
    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text
    model_id = created.json()["id"]
    with STORE.lock:
        model = STORE.models[model_id]
        generic = dict(model.generic_spec or {})
        generic["constraints"] = [{"name": "bad_zero", "formula": "0 >= 0", "sense": ">=", "terms": [], "rhs": 0}]
        STORE.models[model_id] = model.model_copy(update={"generic_spec": generic})
    published = client.post(f"/api/models/{model_id}/publish")
    assert published.status_code == 422
    assert any("formula" in item["field"] for item in published.json()["detail"]["errors"])


def test_generic_builder_constraint_uses_variable_parameter_indices() -> None:
    constraint = {
        "name": "power_balance",
        "foreach": ["time"],
        "terms": [{"var": "unit_output", "foreach": ["unit"], "key": ["unit", "time"], "coef": 1}],
        "sense": ">=",
        "rhs_param": "load_forecast",
        "rhs_key": ["time"],
    }
    formula = constraint_display_formula(constraint)
    assert "unit_output[unit,time]" in formula
    assert "for unit in unit" in formula
    assert "load_forecast[time]" in formula
    assert formula != "0 >= 0"


def test_formula_table_cells_are_not_collapsed() -> None:
    match = re.search(r"td\.formula-cell\s*\{(?P<body>.*?)\}", FRONTEND_CSS, re.S)
    assert match is not None
    body = match.group("body")
    assert "display: table-cell" in body
    assert not re.search(r"max-width\s*:\s*0\b", body)


def test_time_period_horizon_update_regenerates_members() -> None:
    sets = generate_set_members(
        [
            {
                "code": "time",
                "type": "time_period",
                "horizon": 96,
                "time_granularity": 60,
                "time_unit": "minute",
                "members": list(range(24)),
                "values": list(range(24)),
            }
        ]
    )

    time_set = sets[0]
    assert time_set["members"] == list(range(96))
    assert time_set["values"] == list(range(96))


def test_component_templates_time_period_sets_are_publish_configured() -> None:
    for code in ["cascade_hydro_dispatch", "pv_storage_intraday_dispatch_v2"]:
        template = template_library.get_template(code)
        sets = {
            item.get("code") or item.get("key"): item
            for item in ((template.get("model_draft") or {}).get("semantic") or {}).get("sets", [])
        }
        time_set = sets["time"]
        assert time_set["type"] == "time_period"
        assert time_set["horizon"] == template["sample_runtime_parameters"]["horizon"]
        assert time_set["time_granularity"] > 0
        assert time_set["configured"] is True


def test_template_publish_rejects_incomplete_time_period() -> None:
    template = deepcopy(template_library.get_template("pv_storage_intraday_dispatch_v2"))
    template["name"] = f"incomplete-time-period-{uuid.uuid4().hex[:8]}"
    template["status"] = "developing"
    template["sample_runtime_parameters"].pop("delta_t", None)
    template["sample_runtime_parameters"].pop("time_step_seconds", None)
    for item in [*(template.get("sets") or []), *(template["component_spec"]["sets"])]:
        if item.get("code") == "time":
            item.pop("time_granularity", None)
            item.pop("horizon", None)
            item["configured"] = False
    template.pop("model_draft", None)

    created = client.post("/api/models", json=template)
    assert created.status_code == 200, created.text
    published = client.post(f"/api/models/{created.json()['id']}/publish")

    assert published.status_code == 422
    assert "time_period set requires horizon and time_granularity" in published.text


def test_time_period_window_duration_display() -> None:
    sets = generate_set_members([{"code": "time", "type": "time_period", "horizon": 96, "time_granularity": 60}])
    assert sets[0]["window_hours"] == 96
    assert sets[0]["window_days"] == 4
    assert "window=${formatTimeWindow(s)}" in FRONTEND_MODELING
    assert "window=${hours}h" in FRONTEND_MODELING


def test_switch_normal_set_to_time_period_clears_stale_members() -> None:
    assert "item.values = [];" in FRONTEND_MODELING
    assert "item.members = [];" in FRONTEND_MODELING
    assert "manualMembers.disabled = showTimePeriod" in FRONTEND_MODELING
    sets = generate_set_members(
        [{"code": "time", "type": "time_period", "horizon": 3, "time_granularity": 15, "members": ["A", "B"]}]
    )
    assert sets[0]["members"] == [0, 1, 2]


def test_math_expansion_constraint_and_objective_formula_not_blank() -> None:
    template = template_library.get_template("cascade_hydro_dispatch")
    draft = create_model_draft_from_template(template)
    expansion = build_mathematical_expansion(draft)

    assert expansion["objective"]["formula"] != "0"
    assert all((section.get("formula") or "").strip() for section in expansion["sections"])
    assert "displayFormula" in FRONTEND_MODELING


def test_generic_builder_variable_expansion_indices_display_not_blank() -> None:
    assert "function getVariableDisplayExpansion(variable = {})" in FRONTEND_MODELING
    assert "getVariableDisplayExpansion(v)" in FRONTEND_MODELING
    assert "item.display_formula = item.display_formula || (item.indices.length ? `${item.name}[${item.indices.join(',')}]`" in FRONTEND_MODELING


def test_generic_builder_constraint_expression_display_not_blank() -> None:
    assert "function getConstraintDisplayFormula(row = {})" in FRONTEND_MODELING
    assert "item.expression = firstNonBlank(item.expression, formula)" in FRONTEND_MODELING
    assert "getConstraintDisplayFormula(c)" in FRONTEND_MODELING
    assert "FORMULA_NOT_GENERATED" in FRONTEND_MODELING


def test_generic_builder_objective_formula_display_not_blank() -> None:
    assert "function getObjectiveDisplayFormula(term = {})" in FRONTEND_MODELING
    assert "item.expression = firstNonBlank(item.expression, formula)" in FRONTEND_MODELING
    assert "getObjectiveDisplayFormula(t)" in FRONTEND_MODELING


def test_component_builder_constraint_expression_display_not_blank() -> None:
    template = template_library.get_template("cascade_hydro_dispatch")
    draft = create_model_draft_from_template(template)

    assert draft["components"]
    for row in build_mathematical_expansion(draft)["sections"]:
        if row["type"] != "constraint":
            continue
        assert row["formula"].strip()
        assert row["expression"].strip()
        assert row["display_formula"].strip()


def test_component_builder_objective_expression_display_not_blank() -> None:
    template = template_library.get_template("cascade_hydro_dispatch")
    draft = create_model_draft_from_template(template)

    terms = draft["objective"]["terms"]
    assert terms
    for term in terms:
        assert (term.get("expression") or term.get("formula") or term.get("display_formula") or "").strip()


def test_formula_preview_and_table_use_same_expression_source() -> None:
    assert "objectivePreviewText()" in FRONTEND_MODELING
    assert "lines.push(`${prefix} ${getObjectiveDisplayFormula(term)}`.trim())" in FRONTEND_MODELING
    assert "title=\"${escapeHtml(getObjectiveDisplayFormula(t))}\"" in FRONTEND_MODELING
    assert "getConstraintDisplayFormula(row)" in FRONTEND_MODELING


def test_no_option_value_question_marks_in_frontend() -> None:
    assert not re.search(r"<option\s+value=(?:\"\?\"|'\?'|\?)(?:\s|>)", FRONTEND_MODELING)


def test_frontend_backend_problem_type_diagnosis_consistent_for_pv_storage_intraday_v2() -> None:
    template = template_library.get_template("pv_storage_intraday_dispatch_v2")
    draft = create_model_draft_from_template(template)
    diagnosis = infer_problem_type_from_draft(draft, "HiGHS")

    assert diagnosis["inferred_problem_type"] == "MILP"
    assert diagnosis["publish_valid"] is True
    assert "expressionClassFromText(text = '', variableNames = new Set())" in FRONTEND_DIAGNOSIS
    assert "variableNames.has(match[1]) && variableNames.has(match[2])" in FRONTEND_DIAGNOSIS


def test_unit_commitment_diagnosed_as_milp_not_minlp() -> None:
    template = template_library.get_template("unit_commitment_day_ahead")
    draft = create_model_draft_from_template(template)
    diagnosis = infer_problem_type_from_draft(draft, "HiGHS")

    assert diagnosis["inferred_problem_type"] == "MILP"
    assert diagnosis["expression_class"] == "linear"
    assert diagnosis["publish_valid"] is True


def test_publish_rejects_when_problem_diagnosis_not_supported() -> None:
    template = deepcopy(template_library.get_template("pv_storage_intraday_dispatch_v2"))
    template["name"] = f"unsupported-problem-type-{uuid.uuid4().hex[:8]}"
    template["template_id"] = f"unsupported_problem_type_{uuid.uuid4().hex[:8]}"
    template["model_problem_type"] = "MINLP"
    template["problem_type"] = "MINLP"
    template["status"] = "developing"
    template["component_spec"]["model_problem_type"] = "MINLP"
    template["model_draft"]["advanced"]["manual_problem_type_override"] = "MINLP"

    created = client.post("/api/models", json=template)
    assert created.status_code == 200, created.text
    published = client.post(f"/api/models/{created.json()['id']}/publish")

    assert published.status_code == 422
    body = published.json()
    assert body["detail"]["problem_type_diagnosis"]["publish_valid"] is False


def test_publish_dry_run_backfills_empty_indexed_parameter_defaults() -> None:
    payload = _minimal_generic_model_payload(f"MODEL-empty-index-param-{uuid.uuid4().hex[:8]}")
    payload["name"] = f"empty-index-param-{uuid.uuid4().hex[:8]}"
    payload["semantic_spec"]["sets"][1] = {
        "key": "time",
        "code": "time",
        "name": "调度时段集合",
        "type": "time_period",
        "horizon": 4,
        "time_granularity": 60,
        "values": [0, 1, 2, 3],
        "members": [0, 1, 2, 3],
    }
    payload["semantic_spec"]["parameters"].append(
        {
            "key": "load_with_reserve",
            "math_param": "load_with_reserve",
            "name": "负荷加备用容量要求",
            "dimension": ["time"],
            "default_value": {},
            "validation": {"required": True},
        }
    )
    payload["generic_spec"]["sets"]["time"] = [0, 1, 2, 3]
    payload["generic_spec"]["parameters"]["load_forecast"] = {"0": 100, "1": 120, "2": 110, "3": 90}
    payload["generic_spec"]["parameters"]["load_with_reserve"] = {}
    payload["generic_spec"]["constraints"].append(
        {
            "name": "reserve_margin",
            "foreach": ["time"],
            "terms": [{"var": "unit_output", "foreach": ["unit"], "key": ["unit", "time"], "coef": 1}],
            "sense": ">=",
            "rhs_param": "load_with_reserve",
            "rhs_key": ["time"],
        }
    )

    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text
    published = client.post(f"/api/models/{created.json()['id']}/publish")

    assert published.status_code == 200, published.text
    assert published.json()["dry_run_result"]["structure_check"]["status"] == "passed"


def test_cascade_hydro_clone_publish_invoke_sample_success() -> None:
    template = deepcopy(template_library.get_template("cascade_hydro_dispatch"))
    template["name"] = f"cascade-hydro-sample-{uuid.uuid4().hex[:8]}"
    template["template_id"] = f"cascade_hydro_dispatch_custom_{uuid.uuid4().hex[:8]}"
    created = client.post("/api/models", json=template)
    assert created.status_code == 200, created.text
    model_id = created.json()["id"]
    assert "load_forecast" in created.json()["parameters"]

    published = client.post(f"/api/models/{model_id}/publish")
    assert published.status_code == 200, published.text
    assert "load_forecast" in published.json()["parameters"]

    invoked = client.post(
        f"/api/models/{model_id}/invoke",
        json={"runtime_parameters": deepcopy(template["sample_runtime_parameters"]), "options": {"mode": "sync", "time_limit_seconds": 30}},
    )
    assert invoked.status_code == 200, invoked.text
    assert invoked.json()["status"] == "SUCCESS"


def test_invoke_accepts_runtime_parameters_alias() -> None:
    models = client.get("/api/models")
    assert models.status_code == 200, models.text
    model_id = next(item["id"] for item in models.json() if item.get("template_id") == "economic_dispatch")
    params = deepcopy(template_library.get_template("economic_dispatch")["sample_runtime_parameters"])

    invoked = client.post(
        f"/api/models/{model_id}/invoke",
        json={"runtime_parameters": params, "options": {"mode": "sync", "time_limit_seconds": 30}},
    )
    assert invoked.status_code == 200, invoked.text
    assert invoked.json()["status"] == "SUCCESS"


playwright_available = importlib.util.find_spec("playwright") is not None


def _require_playwright_browser() -> None:
    if not playwright_available:
        pytest.skip("playwright is not installed")
    from playwright.sync_api import Error, sync_playwright

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            browser.close()
    except Error as exc:
        pytest.skip(f"Playwright Chromium browser is not installed: {exc}")


def _new_builder_page():
    _require_playwright_browser()
    from playwright.sync_api import sync_playwright

    manager = sync_playwright()
    p = manager.start()
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto((ROOT / "prototype.html").resolve().as_uri())
    return manager, browser, page


@pytest.mark.skipif(not playwright_available, reason="playwright is not installed")
def test_frontend_state_blank_model_does_not_inherit_template_semantics() -> None:
    manager, browser, page = _new_builder_page()
    try:
        result = page.evaluate(
            """() => {
                window.prompt = () => 'blank-state-test';
                createBlankModel();
                setBuilderStep(1);
                const spec = getSemanticSpec();
                return {
                    builderStep: state.builderStep,
                    sets: spec.sets.length,
                    parameters: spec.parameters.length,
                    variables: spec.variables.length,
                    constraints: spec.constraints.length,
                    tableText: document.body.innerText
                };
            }"""
        )
        assert result["builderStep"] == 1
        assert result["sets"] == 0
        assert result["parameters"] == 0
        assert result["variables"] == 0
        assert result["constraints"] == 0
        assert "unit_output" not in result["tableText"]
    finally:
        browser.close()
        manager.stop()


@pytest.mark.skipif(not playwright_available, reason="playwright is not installed")
def test_frontend_state_time_period_members_and_window_update() -> None:
    manager, browser, page = _new_builder_page()
    try:
        result = page.evaluate(
            """() => {
                window.prompt = () => 'time-period-state-test';
                createBlankModel();
                setBuilderStep(1);
                document.getElementById('semanticSetKey').value = 'time';
                document.getElementById('semanticSetName').value = 'time';
                document.getElementById('semanticSetType').value = 'time_period';
                updateSemanticSetTypeVisibility();
                document.getElementById('semanticSetHorizon').value = '96';
                document.getElementById('semanticSetGranularity').value = '15';
                document.getElementById('semanticSetTimeUnit').value = 'minute';
                addSemanticSetFromForm();
                const set = getSemanticSpec().sets.find(s => (s.key || s.code) === 'time');
                return { members: set.members, text: document.body.innerText };
            }"""
        )
        assert result["members"] == list(range(96))
        assert "members=0..95" in result["text"]
        assert "window=24h / 1.00d" in result["text"]
    finally:
        browser.close()
        manager.stop()


@pytest.mark.skipif(not playwright_available, reason="playwright is not installed")
def test_frontend_state_math_formulas_and_pv_storage_diagnosis() -> None:
    manager, browser, page = _new_builder_page()
    try:
        hydro = template_library.get_template("cascade_hydro_dispatch")
        pv = template_library.get_template("pv_storage_intraday_dispatch_v2")
        result = page.evaluate(
            """async ({hydro, pv}) => {
                window.apiFetch = async (path) => path.includes('pv_storage') ? pv : hydro;
                apiFetch = window.apiFetch;
                await loadComponentTemplateExample('cascade_hydro_dispatch', {preserveScene:false});
                setBuilderStep(2);
                const hydroDraft = state.modelDraft;
                const formulas = [
                    ...(hydroDraft.generated_constraints || []).map(row => row.formula || row.expression || ''),
                    ...(hydroDraft.objective?.terms || []).map(row => row.expression || '')
                ];
                const formulaText = document.body.innerText;
                await loadComponentTemplateExample('pv_storage_intraday_dispatch_v2', {preserveScene:false});
                setBuilderStep(1);
                return {
                    formulas,
                    formulaText,
                    pvDiagnosis: state.modelDraft.problem_type_diagnosis,
                    pvText: document.body.innerText
                };
            }""",
            {"hydro": hydro, "pv": pv},
        )
        assert result["formulas"]
        assert all(str(item).strip() for item in result["formulas"])
        assert "未生成" not in result["formulaText"]
        assert result["pvDiagnosis"]["inferred_problem_type"] == "MILP"
        assert result["pvDiagnosis"]["recommended_problem_type"] == "MILP"
        assert "系统推荐类型" in result["pvText"]
        assert "MIQP" not in result["pvDiagnosis"]["inferred_problem_type"]
    finally:
        browser.close()
        manager.stop()
