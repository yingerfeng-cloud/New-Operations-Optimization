from __future__ import annotations

import re
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app


ROOT = Path(__file__).resolve().parents[1]
PROTOTYPE = (ROOT / "prototype.html").read_text(encoding="utf-8")
SCRIPT_SRCS = re.findall(r'<script\s+src="([^"]+)"\s*></script>', PROTOTYPE)
SCRIPT_PATHS = [
    ROOT / match.split("?", 1)[0]
    for match in SCRIPT_SRCS
]
SPLIT_JS_SOURCES = "\n".join(path.read_text(encoding="utf-8") for path in SCRIPT_PATHS)
FRONTEND_SOURCES = PROTOTYPE + "\n" + SPLIT_JS_SOURCES
FRONTEND_CSS = (ROOT / "static" / "css" / "platform.css").read_text(encoding="utf-8")
client = TestClient(app)


def test_prototype_script_paths_strip_query_params() -> None:
    assert SCRIPT_SRCS
    assert all("?v=20260605-final" in src for src in SCRIPT_SRCS)
    assert all("?" not in str(path) for path in SCRIPT_PATHS)
    assert all(path.exists() for path in SCRIPT_PATHS)


def test_prototype_loads_latest_split_frontend_assets() -> None:
    expected = [
        "static/js/platform-api.js",
        "static/js/platform-core.js",
        "static/js/problem_type_diagnosis.js",
        "static/js/platform-pages-main.js",
        "static/js/platform-formula-editor.js",
        "static/js/platform-pages-modeling.js",
        "static/js/platform-component-editor.js",
        "static/js/platform-actions.js",
        "static/js/platform-init.js",
    ]
    actual = [src.split("?", 1)[0] for src in SCRIPT_SRCS]
    assert actual == expected
    assert "20260601" not in PROTOTYPE
    assert "20260603" not in PROTOTYPE
    assert "20260605-split-entry" not in PROTOTYPE
    assert '<script>' not in PROTOTYPE


def test_prototype_open_without_state_initialization_error() -> None:
    playwright = pytest.importorskip("playwright.sync_api")
    errors: list[str] = []
    with playwright.sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as exc:
            pytest.skip(f"Playwright Chromium browser is not installed: {exc}")
        page = browser.new_page()
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto((ROOT / "prototype.html").resolve().as_uri(), wait_until="load")
        page.wait_for_timeout(2500)
        content = page.locator("#content").inner_text(timeout=5000)
        status = page.locator("#backendStatusPill").inner_text(timeout=5000)
        browser.close()
    assert "Cannot access 'state' before initialization" not in "\n".join(errors)
    assert content.strip()
    assert status == "未连接"


def _function_body(name: str) -> str:
    patterns = [f"function {name}", f"async function {name}", f"const {name} ="]
    starts = [FRONTEND_SOURCES.find(pattern) for pattern in patterns]
    starts = [index for index in starts if index >= 0]
    assert starts, f"{name} not found in split frontend sources"
    start = min(starts)
    next_function = FRONTEND_SOURCES.find("\n    function ", start + len(name))
    if next_function == -1:
        next_function = FRONTEND_SOURCES.find("\nfunction ", start + len(name))
    if next_function == -1:
        return FRONTEND_SOURCES[start:]
    return FRONTEND_SOURCES[start:next_function]


def test_frontend_static_suite_reads_all_split_javascript_files() -> None:
    names = [path.name for path in SCRIPT_PATHS]
    assert "platform-api.js" in names
    assert "platform-pages-main.js" in names
    assert "platform-component-editor.js" in names
    assert "function pageComponents" in SPLIT_JS_SOURCES
    assert "async function refreshComponentRegistry" in SPLIT_JS_SOURCES


def test_component_builder_uses_backend_catalog_and_visual_editor_flow() -> None:
    page_body = _function_body("pageComponents")
    assert "/components/catalog" in _function_body("refreshComponentRegistry")
    assert "beginCreateComponent" in page_body
    assert "editComponentJson" in FRONTEND_SOURCES
    assert "validateSingleComponentDependencies" in FRONTEND_SOURCES
    assert "buildModelPackage" in FRONTEND_SOURCES
    assert "componentSpec.components" in _function_body("nextBuilderStep")


def test_component_library_frontend_displays_problem_type_and_chinese_expression_label() -> None:
    table_body = _function_body("componentRegistryTable")
    assert "componentProblemTypes(item)" in table_body
    assert "expressionClassLabel(item.expression_class)" in table_body
    assert "function componentProblemTypes" in FRONTEND_SOURCES
    assert "function expressionClassLabel" in FRONTEND_SOURCES
    assert "linear: '线性'" in FRONTEND_SOURCES
    assert "quadratic: '二次'" in FRONTEND_SOURCES
    assert "nonlinear: '非线性'" in FRONTEND_SOURCES


def test_runtime_template_panel_loads_published_backend_templates() -> None:
    body = _function_body("runtimeTemplatePanel")
    assert "runtimeCallableModels()" in body
    assert "syncRuntimeTemplateSelection" in FRONTEND_SOURCES
    assert "applyRuntimeConfigFromModel(selected)" in _function_body("syncRuntimeTemplateSelection")
    assert 'onclick="refreshModels()"' in body


def test_pv_storage_v2_templates_are_visible_to_frontend_model_list() -> None:
    response = client.get("/api/templates")
    assert response.status_code == 200, response.text
    codes = {item.get("model_code") or item.get("code") for item in response.json()}
    assert "pv_storage_dispatch_v2" in codes
    assert "pv_storage_day_ahead_dispatch_v2" in codes
    assert "pv_storage_intraday_dispatch_v2" in codes


def test_pv_storage_v2_template_schema_contains_closing_parameters() -> None:
    response = client.get("/api/templates/pv_storage_day_ahead_dispatch_v2")
    assert response.status_code == 200, response.text
    params = {param["code"]: param for param in response.json()["parameters"]}
    assert params["deviation_limit"]["validation"]["length_matches"] == "time"
    assert params["deviation_penalty_price"]["validation"]["min"] == 0
    assert params["soc_max"]["validation"]["greater_than"] == "soc_min"
    assert params["degradation_cost_yuan_per_mwh"]["validation"]["min"] == 0


def test_frontend_does_not_render_invalid_empty_option_values() -> None:
    invalid_empty_option = "value=" + "??"
    assert invalid_empty_option not in FRONTEND_SOURCES
    assert '<option value="">选择已发布组件</option>' in FRONTEND_SOURCES
    assert '<option value="">未绑定</option>' in FRONTEND_SOURCES
    assert '<option value="">常数系数</option>' not in _function_body("formulaObjectiveBlock")


def test_formula_editor_rejects_single_equals_with_clear_message() -> None:
    body = _function_body("validateFormulaText")
    assert "hasSingleEquals" in body
    assert "请使用 ==" in body
    single_equals = "x[t] = limit[t]"
    assert re.search(r"(^|[^<>=!])=([^=]|$)", single_equals)
    assert not re.search(r"(^|[^<>=!])=([^=]|$)", "x[t] == limit[t]")


def test_component_editor_static_flow_covers_create_edit_validate_publish_and_model_refresh() -> None:
    editor = FRONTEND_SOURCES
    drawer = _function_body("componentEditorDrawer")
    controls = _function_body("componentEditorControl")
    assert "新增组件" in drawer
    assert "编辑组件" in drawer
    assert "componentArrayEditor('parameters'" in editor
    assert "componentArrayEditor('variables'" in editor
    assert "addComponentEditorArrayRow('${field}')" in editor
    assert "addComponentEditorArrayRow('constraints')" in editor
    assert "addComponentEditorArrayRow('objective_terms')" in editor
    assert "openStructuredFormulaBuilder" in editor
    assert "validateFormulaText(row.expression" in editor
    assert "`/components/${encodeURIComponent(component.component_id)}/validate`" in editor
    assert "`/components/${encodeURIComponent(saved.component_id || component.component_id)}/publish`" in editor
    assert "select multiple" in controls
    assert "continuous" in controls and "binary" in controls and "integer" in controls
    assert "boundary_strategy" in editor
    assert "solve_participation" in controls
    assert "componentLibraryOptions" in editor
    assert "addComponentToDraft" in editor
    assert "refreshComponentSpecFromUi" in editor
    assert "mathematicalExpansionHtml" in editor


def test_semantic_step_has_editable_set_type_selector() -> None:
    body = _function_body("semanticSetEditorForm")
    assert "semanticSetType" in body
    assert "normal" in body
    assert "time_period" in body
    assert "state_time" in body
    assert "derived" in body
    assert "custom" in body


def test_time_period_set_editor_has_horizon_granularity_delta_t() -> None:
    body = _function_body("semanticSetEditorForm") + _function_body("previewSemanticSetGeneration")
    assert "semanticSetHorizon" in body
    assert "semanticSetGranularity" in body
    assert "semanticSetTimeUnit" in body
    assert "semanticSetStartTime" in body
    assert "delta_t" in body


def test_state_time_set_editor_has_base_set_generation_rule() -> None:
    body = _function_body("semanticSetEditorForm") + _function_body("addSemanticSetFromForm")
    assert "semanticSetBaseSet" in body
    assert "semanticSetGenerationRule" in body
    assert "horizon_plus_1" in body


def test_component_add_required_sets_prompts_user_to_configure_sets() -> None:
    body = _function_body("addComponentToDraft") + _function_body("requiredSetsPromptHtml")
    assert "requiredSetPrompt" in body
    assert "新增集合" in body
    assert "待配置" in body
    assert "goConfigureRequiredSets" in body


def test_remove_component_prunes_generated_sets() -> None:
    body = _function_body("removeComponentFromDraft") + _function_body("pruneComponentGeneratedArtifacts") + _function_body("mergeRequiredSets")
    assert "pruneComponentGeneratedArtifacts" in body
    assert "spec.sets = pruneList(spec.sets)" in body
    assert "component_required_set" in body
    assert "activeRequiredCodes" in body


def test_remove_component_prunes_generated_parameters_variables() -> None:
    body = _function_body("pruneComponentGeneratedArtifacts") + _function_body("componentSemanticKeys") + _function_body("tagSemanticArtifactsForComponents")
    assert "spec.parameters = pruneList(spec.parameters)" in body
    assert "spec.variables = pruneList(spec.variables)" in body
    assert "draft.semantic" in body
    assert "definition.inputs" in body
    assert "definition.outputs" in body


def test_remove_component_prunes_generated_constraints_objective_terms() -> None:
    body = _function_body("pruneComponentGeneratedArtifacts")
    assert "spec.constraints = pruneList(spec.constraints)" in body
    assert "current.objective" in body
    assert "draft.objective" in body
    assert "draft.mathematical_expansion" in body


def test_remove_component_keeps_shared_required_set_if_other_component_uses_it() -> None:
    body = _function_body("mergeRequiredSets") + _function_body("keepSemanticArtifactForComponents")
    assert "required_by" in body
    assert "used_by" in body
    assert "activeRequiredCodes.has(code)" in body
    assert "activeComponentIds.has(owner)" in body
    assert "const activeOwners" in body


def test_semantic_sets_table_shows_required_by() -> None:
    body = _function_body("semanticObjectsAndSetsEditor")
    assert "requiredByLabel" in body
    assert "required_by" in body
    assert "used_by" in body


def test_business_objects_are_not_user_maintained_in_set_editor() -> None:
    combined_body = _function_body("semanticObjectsAndSetsEditor")
    set_form_body = _function_body("semanticSetEditorForm")
    set_save_body = _function_body("addSemanticSetFromForm")

    assert "semanticObjectKey" not in combined_body
    assert "semanticObjectDimension" not in combined_body
    assert "addSemanticObjectFromForm" not in combined_body
    assert "业务对象 objects" not in combined_body
    assert "semanticSetObject" not in set_form_body
    assert "business_object: document.getElementById('semanticSetObject')" not in set_save_body
    assert "业务对象与索引集合" not in FRONTEND_SOURCES
    assert "业务对象不再单独维护" in combined_body


def test_remove_all_components_leaves_no_component_generated_semantics() -> None:
    body = _function_body("pruneComponentGeneratedArtifacts") + _function_body("isComponentGeneratedArtifact")
    assert "isComponentGeneratedArtifact" in body
    assert "source === 'component_generated'" in body
    assert "source.startsWith('component_required_set:')" in body


def test_readd_single_component_does_not_restore_deleted_component_semantics() -> None:
    body = _function_body("removeComponentFromDraft") + _function_body("refreshComponentSpecFromUi")
    assert "state.modelDraft = {" in body
    assert "components: list.map" in body
    assert "mergeRequiredSets(current.sets || getCurrentModelDraft().semantic?.sets || [], draftComponents)" in body
    assert "visibleSemantic.sets = state.modelDraft.semantic?.sets" in body
    assert "componentSpec.variables && componentSpec.variables.length ? componentSpec.variables : semanticSpec.variables" in FRONTEND_SOURCES


def test_edit_time_required_set_loads_time_into_set_form() -> None:
    body = _function_body("editSemanticItem") + _function_body("semanticSetEditorForm")
    assert "state.editingSetCode = item.key || item.code" in body
    assert "state.semanticSetFormDraft = { ...item" in body
    assert 'data-editing-set-code="${escapeHtml(state.editingSetCode || \'\')}"' in body


def test_set_editor_form_not_reset_to_default_unit_after_render() -> None:
    body = _function_body("semanticSetEditorForm")
    assert 'value="unit"' not in body
    assert 'value="U1,U2,U3"' not in body
    assert "semanticSetFormDraft()" in body


def test_set_editor_shows_current_editing_set_code() -> None:
    body = _function_body("semanticSetEditorForm")
    assert "正在编辑集合" in body
    assert "form.key || form.code" in body


def test_save_set_configuration_updates_existing_set_not_create_unit() -> None:
    body = _function_body("addSemanticSetFromForm") + _function_body("semanticSetEditorForm")
    assert "保存集合配置" in body
    assert "spec.sets = [...(spec.sets || []).filter(s => (s.key || s.code) !== item.key), item]" in body
    assert "state.editingSetCode = item.key" in body


def test_time_period_set_editor_preserves_component_required_source() -> None:
    body = _function_body("addSemanticSetFromForm") + _function_body("semanticSetFormDraft")
    assert "item.source = draftItem.source || item.source || (item.source_component ? 'component_required_set' : 'user_defined')" in body
    assert "source_component" in body
    assert "time_granularity" in body


def test_formula_editor_main_area_is_token_based_not_plain_textarea() -> None:
    body = _function_body("formulaEditorHtml")
    assert 'id="formulaTokenEditor"' in body
    assert 'class="formula-token-editor"' in FRONTEND_SOURCES
    assert '<input type="hidden" id="unifiedFormulaText"' not in body
    assert '<textarea id="unifiedFormulaText"' in body
    assert "高级模式：DSL 表达式" in body


def test_insert_parameter_creates_readonly_token() -> None:
    body = _function_body("formulaObjectToToken") + _function_body("insertFormulaTokenFromObject")
    assert "type: actualType" in body
    assert "readonly: true" in body
    assert "parameter" in FRONTEND_SOURCES


def test_insert_variable_creates_readonly_token_with_code_label_and_chinese_tooltip() -> None:
    body = _function_body("formulaObjectLabel") + _function_body("formulaObjectToToken")
    assert "formulaIndexContext(state.formulaEditor?.context" in body
    assert "indexContext.aliases[dim] || defaultIndexAlias(dim)" in body
    assert "`${code}[${indices.join(',')}]`" in body
    assert "readonly: true" in body
    assert "${name} ${code}" not in body
    assert "中文：" in _function_body("formulaTokenTooltip")


def test_insert_set_creates_readonly_token() -> None:
    body = _function_body("formulaObjectLabel") + _function_body("insertFormulaTokenFromObject")
    assert "if (type === 'set') return code" in body
    assert "formulaObjectToToken" in body
    assert "readonly: true" in _function_body("formulaObjectToToken")


def test_insert_operator_creates_operator_token() -> None:
    body = _function_body("insertFormulaOperatorToken")
    assert "type: 'operator'" in body
    assert "FORMULA_OPERATOR_LABELS" in FRONTEND_SOURCES
    assert "×" in FRONTEND_SOURCES and "≤" in FRONTEND_SOURCES


def test_tokens_generate_dsl_expression() -> None:
    body = _function_body("formulaTokensToDsl") + _function_body("tokensToDslLinear") + _function_body("aggregateTokenToDsl")
    assert "aggregateTokenToDsl" in body
    assert "${token.fn || 'sum'}(" in body
    assert "for ${alias} in ${setCode}" in body
    assert "objectTokenToDsl" in body


def test_dsl_expression_parse_back_to_tokens() -> None:
    body = _function_body("parseDslExpressionToTokens") + _function_body("parseDslLinearTokens")
    assert "sumMatch" in body
    assert "aliasToSet" in body
    assert "formulaObjectToToken" in body


def test_formula_editor_displays_code_tags_with_chinese_tooltips() -> None:
    body = _function_body("formulaTokensToDisplay") + _function_body("formulaTokenLabel")
    assert "formulaObjectLabel" in FRONTEND_SOURCES
    assert "displayFormula" in _function_body("openFormulaEditor")
    assert "formulaDisplayPreview" in _function_body("formulaEditorHtml")
    assert "中文：" in _function_body("formulaTokenTooltip")


def test_formula_token_hover_contains_code_dimension_unit() -> None:
    body = _function_body("formulaTokenTooltip")
    assert "编码：" in body
    assert "维度：" in body
    assert "单位：" in body
    assert "业务含义：" in body


def test_advanced_dsl_mode_syncs_tokens() -> None:
    body = _function_body("updateAdvancedDslFormula") + _function_body("formulaEditorHtml")
    assert "unifiedFormulaText" in body
    assert "parseDslExpressionToTokens" in body
    assert "advancedExpressionOnly" in body


def test_formula_scope_inferred_from_tokens() -> None:
    body = _function_body("inferFormulaScopeFromTokens")
    assert "collectAggregateTokens" in body
    assert "token.indices" in body
    assert "scope.add" in body


def test_legacy_expression_opened_as_tokens() -> None:
    body = _function_body("openFormulaEditor") + _function_body("normalizeFormulaTokens")
    assert "sourceRow.tokens" in body
    assert "fallbackExpression" in body
    assert "parseDslExpressionToTokens" in body


def test_formula_scope_for_power_balance_is_time_only() -> None:
    body = _function_body("inferFormulaScopeFromExpression")
    assert "referenced" in body
    assert "aggregated" in body
    assert "!aggregated.has(code)" in body


def test_sum_aggregated_index_not_outer_scope() -> None:
    body = _function_body("inferFormulaScopeFromExpression") + _function_body("validateFormulaText")
    assert "for\\s+([A-Za-z_][A-Za-z0-9_]*)\\s+in" in body
    assert "aggregated.add(setCode)" in body
    assert "聚合索引" in body


def test_formula_scope_persist_after_apply() -> None:
    body = _function_body("applyFormulaEditor") + _function_body("writeComponentFormulaFields")
    assert "foreach" in body
    assert "scope_indices" in body
    assert "expansion_scope" in body


def test_constraint_table_displays_forall_scope() -> None:
    body = _function_body("getConstraintDisplayFormula") + _function_body("formulaWithForallScope")
    assert "∀" in body
    assert "formulaScopePrefix" in body


def test_expansion_preview_uses_constraint_foreach() -> None:
    body = _function_body("expandGenericConstraintLabels")
    assert "formulaScopeListFromRow" in body
    assert "genericContexts(spec, foreach)" in body


def test_function_tokens_insert_without_template_wizard() -> None:
    body = _function_body("insertFormulaFunctionToken") + _function_body("formulaFunctionPanelHtml")
    assert "openFormulaFunctionWizard" not in body
    assert "formulaWizardSet" not in FRONTEND_SOURCES
    assert "appendFormulaToken" in body


def test_function_help_has_syntax_and_example() -> None:
    body = _function_body("formulaFunctionHelpHtml")
    assert "用途" in body
    assert "语法" in body
    assert "示例" in body
    assert "注意事项" in body


def test_quick_template_panel_removed() -> None:
    body = _function_body("semanticSpecDrivenFormulaEditor")
    assert "genericQuickTemplateBlock" not in body
    assert "快捷模板 / 公式向导" not in FRONTEND_SOURCES
    assert "applyGenericQuickTemplate" not in FRONTEND_SOURCES


def test_formula_list_table_has_min_width() -> None:
    assert ".formula-list-table" in FRONTEND_CSS
    assert "min-width: 1100px" in FRONTEND_CSS
    assert "formula-list-scroll" in _function_body("formulaConstraintBlock")
    assert "formula-list-scroll" in _function_body("formulaObjectiveBlock")


def test_formula_cell_not_max_width_zero() -> None:
    assert not re.search(r"(?:td\.)?formula-cell\s*\{[^}]*max-width\s*:\s*0\b", FRONTEND_CSS, re.S)
    assert "max-width: none" in FRONTEND_CSS


def test_constraint_formula_column_not_collapsed() -> None:
    body = _function_body("formulaConstraintBlock")
    assert '<col class="formula-col">' in body
    assert 'class="formula-display-col"' in body
    assert "min-width: 420px" in FRONTEND_CSS


def test_objective_formula_column_not_collapsed() -> None:
    body = _function_body("formulaObjectiveBlock")
    assert '<col class="formula-col">' in body
    assert 'class="formula-display-col"' in body
    assert 'title="${escapeHtml(getObjectiveDisplayFormula(t))}"' in body


def test_constraint_formula_list_uses_readable_columns() -> None:
    body = _function_body("formulaConstraintBlock")
    for text in ["约束名称", "约束编码", "作用范围 / foreach", "公式展示", "编译状态", "来源", "操作"]:
        assert text in body
    assert "formulaStatusPill(status)" in body
    assert "formulaSourceLabel" in body
    assert "原始 DSL" in body


def test_objective_formula_list_uses_readable_columns() -> None:
    body = _function_body("formulaObjectiveBlock")
    for text in ["启用", "目标项名称", "目标项编码", "公式", "权重", "排序", "操作"]:
        assert text in body
    assert "getObjectiveDisplayFormula(t)" in body
    assert "table-scroll formula-list-scroll" in body


def test_old_constraint_structured_form_removed_from_main_flow() -> None:
    body = _function_body("formulaConstraintBlock")
    assert "addIndexedConstraintFromForm" not in FRONTEND_SOURCES
    for old_id in [
        "indexedConstraintRule",
        "indexedConstraintForeach",
        "indexedConstraintAggregate",
        "indexedConstraintVar",
        "indexedConstraintSense",
        "indexedConstraintRhsType",
        "indexedConstraintRhs",
    ]:
        assert old_id not in body


def test_old_objective_structured_form_removed_from_main_flow() -> None:
    body = _function_body("formulaObjectiveBlock")
    assert "addIndexedObjectiveTermFromForm" not in FRONTEND_SOURCES
    for old_id in [
        "indexedObjectiveType",
        "indexedObjectiveVar",
        "indexedObjectiveParam",
        "indexedObjectiveCoef",
        "indexedObjectiveForeach",
        "indexedObjectiveSign",
        "indexedObjectiveWeight",
    ]:
        assert old_id not in body


def test_static_bundle_version_updated_after_formula_layout_fix() -> None:
    assert "20260605-final" in PROTOTYPE
    assert "20260603-builder-formula-scope" not in PROTOTYPE


def test_uploaded_package_contains_latest_formula_editor_code() -> None:
    package = ROOT / "copt-500.zip"
    if not package.exists():
        return
    with zipfile.ZipFile(package) as archive:
        prototype = archive.read("prototype.html").decode("utf-8")
        modeling = archive.read("static/js/platform-pages-modeling.js").decode("utf-8")
        formula = archive.read("static/js/platform-formula-editor.js").decode("utf-8")
        css = archive.read("static/css/platform.css").decode("utf-8")
    assert "20260605-final" in prototype
    assert "formula-list-scroll" in modeling
    assert "formulaPersistedReferences" in formula
    assert "min-width: 1100px" in css


def test_generic_builder_constraint_config_is_formula_list_not_old_form() -> None:
    body = _function_body("formulaConstraintBlock")
    assert "约束名称" in body
    assert "作用范围 / foreach" in body
    assert "公式展示" in body
    assert "indexedConstraintAggregate" not in body
    assert "indexedConstraintVar" not in body


def test_generic_builder_objective_config_is_formula_list_not_old_form() -> None:
    body = _function_body("formulaObjectiveBlock")
    assert "目标项名称" in body
    assert "目标项编码" in body
    assert "添加目标项" in body
    assert "indexedObjectiveForeach" not in body
    assert "indexedObjectiveVar" not in body


def test_expansion_preview_uses_chinese_names() -> None:
    body = _function_body("genericExpansionPreview") + _function_body("expandGenericVariableLabels") + _function_body("expandGenericConstraintLabels")
    assert "semanticDisplayName" in body
    assert "semanticMemberLabel" in body
    assert "semanticSetInfoHtml" in FRONTEND_SOURCES


def test_select_binary_variable_defaults_domain_binary() -> None:
    body = _function_body("syncIndexedVariableDefaults") + _function_body("semanticVariableByCode")
    assert "normalizeVariableDomain(variable.domain" in body
    assert "setInputValue('indexedVarDomain', domain)" in body


def test_variable_bounds_support_constant_and_parameter_for_lb_ub() -> None:
    body = _function_body("formulaVariableExpansionBlock") + _function_body("normalizeVariableBounds")
    assert "indexedVarLbType" in body
    assert "indexedVarUbType" in body
    assert "parameter" in body
    assert "constant" in body


def test_binary_variable_defaults_bounds_0_1() -> None:
    body = _function_body("normalizeVariableBounds")
    assert "normalizeVariableDomain(item.domain) === 'Binary'" in body
    assert "item.lb_value = 0" in body
    assert "item.ub_value = 1" in body


def test_formula_preview_and_table_use_same_expression_source() -> None:
    body = _function_body("formulaObjectiveBlock") + _function_body("objectivePreviewText")
    assert "getObjectiveDisplayFormula(term)" in body
    assert "getObjectiveDisplayFormula(t)" in body
    assert 'title="${escapeHtml(getObjectiveDisplayFormula(t))}"' in body


def test_function_tokens_cannot_be_chained_without_operand() -> None:
    body = _function_body("validateFormulaTokenStructure")
    assert "缺少操作对象" in body
    assert "连续拼接函数 token" in body


def test_target_objective_has_no_outer_foreach_by_default() -> None:
    body = _function_body("applyFormulaEditor") + _function_body("formulaScopeFromApply")
    assert "delete parts.objective.terms[editor.apply.index].foreach" in body
    assert "apply.type === 'genericObjective'" in body
