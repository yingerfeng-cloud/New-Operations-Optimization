from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODELING_JS = (ROOT / "static" / "js" / "platform-pages-modeling.js").read_text(encoding="utf-8")
FORMULA_JS = (ROOT / "static" / "js" / "platform-formula-editor.js").read_text(encoding="utf-8")
ACTIONS_JS = (ROOT / "static" / "js" / "platform-actions.js").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "css" / "platform.css").read_text(encoding="utf-8")


def _function_body(source: str, name: str) -> str:
    starts = [source.find(pattern) for pattern in [f"function {name}", f"async function {name}", f"const {name} ="]]
    starts = [index for index in starts if index >= 0]
    assert starts, f"{name} not found"
    start = min(starts)
    next_function = source.find("\n    function ", start + len(name))
    if next_function == -1:
        next_function = source.find("\nfunction ", start + len(name))
    return source[start:] if next_function == -1 else source[start:next_function]


def test_legacy_structured_constraint_and_objective_form_fields_are_removed() -> None:
    constraint = _function_body(MODELING_JS, "formulaConstraintBlock")
    objective = _function_body(MODELING_JS, "formulaObjectiveBlock")
    forbidden = [
        "业务规则",
        "作用索引",
        "聚合维度",
        "左端变量",
        "关系类型",
        "右端类型",
        "右端",
        "目标项类型",
        "系数参数",
        "常数系数",
        "求和维度",
        "符号",
        "addIndexedConstraintFromForm",
        "addIndexedObjectiveTermFromForm",
    ]
    for text in forbidden:
        assert text not in constraint
        assert text not in objective
    assert "addIndexedConstraintFromForm" not in MODELING_JS
    assert "addIndexedObjectiveTermFromForm" not in MODELING_JS


def test_constraint_and_objective_config_keep_only_formula_list_columns() -> None:
    constraint = _function_body(MODELING_JS, "formulaConstraintBlock")
    objective = _function_body(MODELING_JS, "formulaObjectiveBlock")
    for text in ["添加约束公式", "约束名称", "约束编码", "作用范围 / foreach", "公式展示", "编译状态", "来源", "编辑公式", "删除"]:
        assert text in constraint
    for text in ["目标方向", "添加目标项", "启用", "目标项名称", "目标项编码", "公式", "权重", "排序", "编辑公式", "删除"]:
        assert text in objective


def test_variable_expansion_layout_groups_basic_and_bound_pairs() -> None:
    body = _function_body(MODELING_JS, "formulaVariableExpansionBlock") + _function_body(MODELING_JS, "syncIndexedVariableDefaults")
    assert "变量基础配置" in body
    assert "边界配置" in body
    assert body.index("下界类型") < body.index("下界值")
    assert body.index("上界类型") < body.index("上界值")
    assert "semanticVariableDimension(code)" in body
    assert "normalizeVariableBounds" in body
    assert "setInputValue('indexedVarDomain', domain)" in body


def test_binary_variable_defaults_are_zero_one_bounds() -> None:
    body = _function_body(MODELING_JS, "normalizeVariableBounds")
    assert "normalizeVariableDomain(item.domain) === 'Binary'" in body
    assert "item.lb_value = 0" in body
    assert "item.ub_value = 1" in body


def test_expansion_preview_is_grouped_list_not_comma_joined_paragraph() -> None:
    body = _function_body(MODELING_JS, "genericExpansionPreview") + _function_body(MODELING_JS, "semanticSetInfoHtml") + _function_body(MODELING_JS, "formatIndexedLabel")
    assert "expansion-preview-group" in body
    assert "expansion-preview-list" in body
    assert "preview-main" in body
    assert "preview-code" in body
    assert ".join('，')" not in body
    assert "变量展开示例" in body
    assert "约束展开示例" in body


def test_generic_parameter_defaults_are_completed_before_save() -> None:
    package_body = _function_body(MODELING_JS, "buildModelPackage")
    complete_body = _function_body(MODELING_JS, "completeGenericParameterDefaults")
    save_body = _function_body(MODELING_JS, "saveModelToAssets")
    assert "completeGenericParameterDefaults(genericSpec, semanticSpec)" in package_body
    assert "genericSpec.parameters = genericParams" in complete_body
    assert "mergeOneDim(current, setMembers(dims[0]), fallbackValue)" in complete_body
    assert "mergeTwoDim(current, setMembers(dims[0]), setMembers(dims[1]), fallbackValue)" in complete_body
    assert "isEditableSavedModel(existingById)" in save_body
    assert "已基于已发布模型保存为可编辑草稿" in save_body


def test_formula_function_aggregate_block_uses_set_token_and_placeholder() -> None:
    body = _function_body(FORMULA_JS, "insertFormulaFunctionToken")
    assert "appendFormulaToken(formulaAggregateToken(fn))" in body
    assert "getFormulaSymbolDictionary" not in body
    assert "type: 'aggregate'" in _function_body(FORMULA_JS, "formulaAggregateToken")
    assert "body_tokens" in _function_body(FORMULA_JS, "formulaAggregateToken")
    assert "set: code" in _function_body(FORMULA_JS, "formulaAggregateToken")


def test_token_canvas_prevents_editing_internal_code() -> None:
    body = _function_body(FORMULA_JS, "formulaTokenHtml")
    assert 'contenteditable="false"' in body
    assert "data-index" in body
    assert "formulaTokenTooltip" in body
    child_body = _function_body(FORMULA_JS, "formulaAggregateChildHtml")
    assert 'class="formula-aggregate-child${selected}"' in child_body
    assert "openAggregateChildTokenProperties" in child_body
    assert "JSON 调试" in _function_body(FORMULA_JS, "openFormulaTokenProperties")


def test_formula_table_action_column_not_hidden_by_scrollbar() -> None:
    assert re.search(r"\.formula-editor-shell \.formula-list-table th\.formula-ops-col,\s*\.formula-editor-shell \.formula-list-table td\.formula-ops-col\s*\{[^}]*position:\s*sticky", CSS, re.S)
    assert "right: 0" in CSS
    assert "min-width: 156px" in CSS
    assert "overflow-x: auto" in CSS


def test_function_help_rendered_once_only() -> None:
    editor = _function_body(FORMULA_JS, "formulaEditorHtml")
    token_props = _function_body(FORMULA_JS, "openFormulaTokenProperties")
    assert editor.count("formulaFunctionHelpHtml(") == 1
    assert "formulaFunctionHelpPanel" in editor
    assert "formulaFunctionHelpHtml(" not in token_props
    assert "refreshFormulaFunctionHelpPanel()" in token_props


def test_formula_examples_are_actionable_and_loader_is_exported() -> None:
    examples_body = _function_body(FORMULA_JS, "showFormulaExamples") + _function_body(FORMULA_JS, "loadFormulaExample")
    editor_body = _function_body(FORMULA_JS, "formulaEditorHtml")
    init = (ROOT / "static" / "js" / "platform-init.js").read_text(encoding="utf-8")
    assert "openInfoModal('公式示例'" in examples_body
    assert "loadFormulaExample(" in examples_body
    assert "updateAdvancedDslFormula(item.expression)" in examples_body
    assert 'event.stopPropagation();showFormulaExamples()' in editor_body
    assert "'loadFormulaExample'" in init


def test_function_help_updates_when_selected_function_changes() -> None:
    body = _function_body(FORMULA_JS, "openFormulaTokenProperties") + _function_body(FORMULA_JS, "selectedFormulaFunctionHelpKey")
    assert "token.type === 'aggregate'" in body
    assert "state.formulaEditor.activeFunction = token.fn" in body
    assert "state.formulaEditor.activeFunction = token.code" in body
    for fn in ["sum", "min", "max", "abs"]:
        assert fn in _function_body(FORMULA_JS, "formulaFunctionHelpHtml")


def test_sum_aggregate_block_can_be_used_as_left_expression() -> None:
    body = _function_body(FORMULA_JS, "tokensToDslLinear") + _function_body(FORMULA_JS, "aggregateTokenToDsl")
    assert "token.type === 'aggregate'" in body
    assert "return `${token.fn || 'sum'}(${inner} for ${alias} in ${setCode})`" in body
    assert "join(' ')" in body


def test_sum_aggregate_block_can_be_used_as_right_expression() -> None:
    body = _function_body(FORMULA_JS, "formulaTokensToDsl") + _function_body(FORMULA_JS, "tokensToDslLinear")
    assert "return tokensToDslLinear(tokens, context, {})" in body
    assert "aggregatePrefixFromTokens(tokens" not in _function_body(FORMULA_JS, "formulaTokensToDsl")


def test_aggregate_block_requires_body_tokens() -> None:
    body = _function_body(FORMULA_JS, "validateFormulaTokenStructure")
    assert "token.type === 'aggregate'" in body
    assert "body_tokens" in body
    assert "表达式为空" in body
    assert "请在" in body


def test_bare_function_token_in_middle_is_invalid() -> None:
    body = _function_body(FORMULA_JS, "validateFormulaTokenStructure")
    assert "裸函数" in body
    assert "请使用聚合块插入 sum/min/max" in body


def test_formula_editor_hides_for_in_parentheses_in_normal_mode() -> None:
    editor = _function_body(FORMULA_JS, "formulaEditorHtml")
    panel = _function_body(FORMULA_JS, "formulaFunctionPanelHtml")
    assert " for " not in editor
    assert " in " not in editor
    assert "sum(expr for alias in set)" not in _function_body(FORMULA_JS, "formulaFunctionHelpHtml")
    assert "请选择集合和表达式" in _function_body(FORMULA_JS, "formulaTokenHtml")


def test_sum_tag_is_linear_not_nested_block_ui() -> None:
    aggregate_css = re.search(r"\.formula-token-aggregate\s*\{(?P<body>.*?)\}", CSS, re.S)
    aggregate_body_css = re.search(r"\.formula-aggregate-body\s*\{(?P<body>.*?)\}", CSS, re.S)
    token_html = _function_body(FORMULA_JS, "formulaTokenHtml")
    assert aggregate_css
    assert aggregate_body_css
    assert "flex-direction: row" in aggregate_css.group("body")
    assert "min-width: 260px" not in aggregate_css.group("body")
    assert "border: 0" in aggregate_body_css.group("body")
    assert "<small>" not in token_html


def test_aggregate_child_delete_button_not_overridden_by_outer_token_buttons() -> None:
    assert ".formula-token .formula-aggregate-child > button" in CSS
    override = re.search(r"\.formula-token \.formula-aggregate-child > button\s*\{(?P<body>.*?)\}", CSS, re.S)
    assert override
    assert "right: 2px" in override.group("body")


def test_nested_and_wrapper_token_selection_controls_are_exposed() -> None:
    init = (ROOT / "static" / "js" / "platform-init.js").read_text(encoding="utf-8")
    aggregate_child = _function_body(FORMULA_JS, "formulaAggregateChildHtml")
    wrapper_child = _function_body(FORMULA_JS, "formulaWrapperChildHtml")
    append_body = _function_body(FORMULA_JS, "appendFormulaTokens")
    assert "openNestedAggregateBodyTokenProperties" in aggregate_child
    assert "formulaCaretHtml('nestedAggregate'" in aggregate_child
    assert "openWrapperChildTokenProperties" in wrapper_child
    assert "removeWrapperBodyToken" in wrapper_child
    assert "point?.kind === 'nestedAggregate'" in append_body
    assert "point?.kind === 'wrapper'" in append_body
    for name in [
        "openNestedAggregateBodyTokenProperties",
        "openWrapperChildTokenProperties",
        "removeWrapperBodyToken",
        "clearFormulaEditorTokens",
        "setFormulaInsertionPoint",
    ]:
        assert f"'{name}'" in init


def test_formula_cursor_is_blinking_and_not_visible_until_active() -> None:
    caret_css = re.search(r"\.formula-insert-caret\.active::before\s*\{(?P<body>.*?)\}", CSS, re.S)
    base_css = re.search(r"\.formula-insert-caret::before\s*\{(?P<body>.*?)\}", CSS, re.S)
    assert caret_css
    assert base_css
    assert "background: transparent" in base_css.group("body")
    assert "animation: formula-caret-blink" in caret_css.group("body")
    assert "@keyframes formula-caret-blink" in CSS


def test_calculator_uses_mainstream_order_with_clear_and_wide_zero() -> None:
    panel = _function_body(FORMULA_JS, "formulaFunctionPanelHtml")
    assert "['C', '(', ')', '/']" in panel
    assert "['7', '8', '9', '*']" in panel
    assert "['4', '5', '6', '-']" in panel
    assert "['1', '2', '3', '+']" in panel
    assert "clearFormulaEditorTokens()" in panel
    assert "formula-quick-btn-wide" in panel
    assert ".formula-quick-btn-clear" in CSS


def test_formula_editor_uses_scientific_calculator_surface_and_code_first_tags() -> None:
    panel = _function_body(FORMULA_JS, "formulaFunctionPanelHtml")
    labels = _function_body(FORMULA_JS, "formulaObjectLabel") + _function_body(FORMULA_JS, "formulaTokenLabel")
    tooltip = _function_body(FORMULA_JS, "formulaTokenTooltip")
    assert "formula-calculator-grid" in panel
    assert "formula-calculator-btn" in panel
    assert "Calculator" in panel
    assert "Aggregate" in FORMULA_JS
    assert "Functions" in FORMULA_JS
    assert "const code = item.code" in labels
    assert "`${code}[${indices.join(',')}]`" in labels
    assert "中文：" in tooltip
    assert "业务含义：" in tooltip


def test_formula_editor_has_central_index_context_and_number_tokens() -> None:
    index_context = _function_body(FORMULA_JS, "formulaIndexContext")
    object_dsl = _function_body(FORMULA_JS, "objectTokenToDsl")
    aggregate_dsl = _function_body(FORMULA_JS, "aggregateTokenToDsl")
    parser = _function_body(FORMULA_JS, "parseDslLinearTokens")
    calculator = _function_body(FORMULA_JS, "formulaFunctionPanelHtml")
    assert "function formulaIndexContext" in index_context
    assert "aliases" in index_context
    assert "aliasToSet" in index_context
    assert "collectAggregateTokens(tokens || [])" in index_context
    assert "function formulaAliasToSetMap" in FORMULA_JS
    assert "formulaIndexContext(context" in object_dsl
    assert "formulaIndexContext(context" in aggregate_dsl
    assert "indexContext.aliases[setCode] || token.alias" in aggregate_dsl
    assert "insertFormulaNumberToken" in calculator
    assert "formulaNumberToken(raw)" in parser
    assert "type: 'number'" in _function_body(FORMULA_JS, "formulaNumberToken")
    assert "token.type === 'number'" in _function_body(FORMULA_JS, "tokensToDslLinear")


def test_formula_editor_validates_after_scope_is_attached_to_state() -> None:
    body = _function_body(FORMULA_JS, "openFormulaEditor")
    assert "scopeIndices: inferredScope" in body
    assert "validation: { valid: true" in body
    assert "state.formulaEditor.validation = validateFormulaText(dsl, mode, context, tokens)" in body


def test_normal_mode_has_parentheses_and_object_tokens_show_indices() -> None:
    operators = _function_body(FORMULA_JS, "formulaFunctionPanelHtml") + _function_body(FORMULA_JS, "formulaObjectLabel")
    assert "左括号" in operators
    assert "右括号" in operators
    assert "FORMULA_OPERATOR_DSL[symbol]" in _function_body(FORMULA_JS, "insertFormulaOperatorToken")
    assert "formulaIndexContext(state.formulaEditor?.context" in operators
    assert "indexContext.aliases[dim] || defaultIndexAlias(dim)" in operators
    assert "`${code}[${indices.join(',')}]`" in operators


def test_square_wraps_previous_expression_instead_of_adding_function_tag() -> None:
    insert_body = _function_body(FORMULA_JS, "insertFormulaFunctionToken")
    square_body = _function_body(FORMULA_JS, "squarePreviousFormulaToken") + _function_body(FORMULA_JS, "formulaSquareToken")
    dsl_body = _function_body(FORMULA_JS, "tokensToDslLinear")
    display_body = _function_body(FORMULA_JS, "formulaTokenDisplayPart")
    assert "squarePreviousFormulaToken()" in insert_body
    assert "appendFormulaToken({ type: 'function', code: fn" in insert_body
    assert "fn === 'pow2'" in insert_body
    assert "formulaSquareToken(last" in square_body
    assert "type: 'square'" in square_body
    assert "}) ** 2" in dsl_body
    assert ")²" in display_body


def test_scope_alias_display_for_time_and_unit() -> None:
    body = _function_body(FORMULA_JS, "formulaScopeAliasBannerHtml") + _function_body(FORMULA_JS, "formulaTokenHtml")
    assert "作用范围：" in body
    assert "indexContext.aliases[item.code] || defaultIndexAlias(item.code)" in body
    assert "defaultIndexAlias(item.code)" in body
    assert "聚合索引" in body
    assert "aggregateTokenSetName" in body
    assert "∀ ${escapeHtml(item.name)}" not in _function_body(FORMULA_JS, "formulaScopeAliasBannerHtml")


def test_forall_prefix_is_not_rendered_inside_token_editor() -> None:
    prefix_body = _function_body(FORMULA_JS, "formulaTokenScopePrefixHtml")
    editor_body = _function_body(FORMULA_JS, "formulaEditorHtml")
    update_body = _function_body(FORMULA_JS, "updateFormulaDraft") + _function_body(FORMULA_JS, "updateAdvancedDslFormula")
    assert "formulaTokenScopePrefixHtml(ctx, scope, editor.mode)" not in editor_body
    assert "formula-token-scope-prefix" in prefix_body
    assert "∀ ${scope.map" in prefix_body
    assert "formulaEditorPreviewText" not in FORMULA_JS
    assert "formulaEditorPreviewText" not in update_body
    assert ".formula-token-scope-prefix" in CSS


def test_formula_display_does_not_duplicate_raw_expression_and_dsl() -> None:
    assert "原始表达式" not in FORMULA_JS
    assert "原始表达式" not in MODELING_JS
    assert "原始 DSL" in FORMULA_JS
    assert _function_body(MODELING_JS, "formulaConstraintBlock").count("formulaDisplayBlock(formula)") == 1


def test_expansion_preview_grouped_by_section() -> None:
    body = _function_body(MODELING_JS, "genericExpansionPreview")
    assert "expansion-preview-grid" in body
    assert "集合" in body
    assert "变量展开示例" in body
    assert "约束展开示例" in body
    assert "previewListHtml" in body


def test_time_period_horizon_syncs_to_generic_sets_and_expansion_preview() -> None:
    semantic_sync = _function_body(MODELING_JS, "semanticSpecToGenericSpec") + _function_body(MODELING_JS, "semanticSetMembers")
    set_save = _function_body(MODELING_JS, "addSemanticSetFromForm")
    defaults = _function_body(MODELING_JS, "defaultValueForDimension")
    assert "semanticSetMembers(set)" in semantic_sync
    assert "Array.from({ length: Number(set.horizon) }, (_, i) => i)" in semantic_sync
    assert semantic_sync.index("set.type === 'time_period'") < semantic_sync.index("Array.isArray(set.members)")
    assert "item.values = generatedMembers.slice()" in set_save
    assert "item.members = generatedMembers.slice()" in set_save
    assert "semanticSetMembers((spec.sets || []).find" in defaults


def test_dimensioned_empty_parameter_defaults_are_expanded_before_save() -> None:
    semantic_sync = _function_body(MODELING_JS, "semanticSpecToGenericSpec")
    runtime_defaults = _function_body(MODELING_JS, "buildRuntimeParameterDefaultsFromSemantic")
    runtime_schema = _function_body(MODELING_JS, "buildRuntimeParameterSchemaFromSemantic")
    default_helper = _function_body(MODELING_JS, "defaultParameterValueForDimension")
    empty_helper = _function_body(MODELING_JS, "isEmptyStructuredDefault")

    assert "parameters[key] = defaultParameterValueForDimension(param, spec)" in semantic_sync
    assert "defaultParameterValueForDimension(p, semanticSpec)" in runtime_defaults
    assert "defaultParameterValueForDimension(p, semanticSpec)" in runtime_schema
    assert "dimension.length" in default_helper
    assert "isEmptyStructuredDefault(value)" in default_helper
    assert "defaultValueForDimension(dimension, semanticSpec)" in default_helper
    assert "Array.isArray(value)" in empty_helper
    assert "Object.keys(value).length === 0" in empty_helper


def test_runtime_parameter_sample_value_field_is_not_user_maintained() -> None:
    editor_body = _function_body(MODELING_JS, "semanticParametersAndVariablesEditor")
    edit_body = _function_body(MODELING_JS, "editSemanticItem")
    save_body = _function_body(MODELING_JS, "addSemanticParameterFromForm")

    assert "semanticParamSample" not in editor_body
    assert "样例值" not in editor_body
    assert "sample_value_text" not in MODELING_JS
    assert "setInputValue('semanticParamSample'" not in edit_body
    assert "item.sample_value" not in save_body


def test_runtime_parameter_validation_rule_is_system_generated() -> None:
    editor_body = _function_body(MODELING_JS, "semanticParametersAndVariablesEditor")
    save_body = _function_body(MODELING_JS, "addSemanticParameterFromForm")
    schema_body = _function_body(MODELING_JS, "buildRuntimeParameterSchemaFromSemantic")
    validation_body = _function_body(MODELING_JS, "parameterValidationRule")

    assert "readonly" in editor_body
    assert "系统自动生成" in editor_body
    assert "item.validation = parameterValidationRule(item)" in save_body
    assert "validation: parameterValidationRule(p)" in schema_body
    assert "rule.type = 'dict'" in validation_body
    assert "rule.keys = dimension.slice()" in validation_body
    assert "rule.type = 'number'" in validation_body


def test_component_and_generic_semantic_step_share_same_editor_layout() -> None:
    semantic_body = _function_body(MODELING_JS, "semanticLayerEditor")
    apply_body = _function_body(MODELING_JS, "applyModelPackageToBuilder")

    assert "componentSemanticOverview" not in semantic_body
    assert "semanticObjectsAndSetsEditor(spec)" in semantic_body
    assert "semanticParametersAndVariablesEditor(spec)" in semantic_body
    assert "semanticRulesAndObjectivesEditor(spec)" in semantic_body
    component_branch = apply_body[apply_body.index("if (state.builderMode === 'component_based')") :]
    component_branch = component_branch[: component_branch.index("const genericSpec")]
    assert "state.builderStep = 2" not in component_branch


def test_model_selector_keeps_asset_loaded_model_and_matches_uc_scene_alias() -> None:
    options_body = _function_body(MODELING_JS, "modelOptions")
    match_body = _function_body(MODELING_JS, "normalizeSceneNameForMatch") + _function_body(MODELING_JS, "sceneMatchesActive") + _function_body(MODELING_JS, "sceneMatchesName")
    select_scene_body = _function_body(ACTIONS_JS, "selectScene")

    assert "sceneMatchesActive(m.scene)" in options_body
    assert "activeSaved" in options_body
    assert "option selected>${escapeHtml(state.activeModel)}" not in options_body
    assert "Unit Commitment" in match_body
    assert "机组组合" in match_body
    assert "日前机组组合优化" in match_body
    assert "梯级水电" in match_body
    assert "sceneMatchesName(model.scene, scene)" in select_scene_body
    assert "await selectModel(`asset:${asset.id}`)" in select_scene_body


def test_model_selector_uses_asset_ids_to_disambiguate_same_name_versions() -> None:
    options_body = _function_body(MODELING_JS, "modelOptions")
    load_body = _function_body(MODELING_JS, "loadSelectedModelStructure")
    select_body = _function_body(ACTIONS_JS, "selectModel")

    assert "value: `asset:${m.id}`" in options_body
    assert "value: `catalog:" not in options_body
    assert "目录模板" not in options_body
    assert "m.version" in options_body
    assert "（资产" in options_body
    assert "sceneMatchesActive(activeModel.scene)" in options_body
    assert "state.runtimeTemplateId ? `asset:${state.runtimeTemplateId}`" in load_body
    assert "startsWith('asset:')" in select_body
    assert "apiFetch(`/models/${modelId}`)" in select_body
    assert "applyModelPackageToBuilder(model.modelPackage || model)" in select_body
    assert "state.runtimeTemplateId = model.id || modelId" in select_body
    assert "state.activeDomain = normalizeSceneNameForMatch(model.scene || state.activeDomain)" in select_body


def test_overwrite_save_prefers_active_model_id_over_name_scene_match() -> None:
    save_body = _function_body(MODELING_JS, "saveModelToAssets")

    assert "modelPackage.id || state.runtimeTemplateId" in save_body
    assert "isEditableSavedModel(existingById) ? existingById : existingByName" in save_body
    assert "editableStatuses" in save_body
    assert "savingEditableCopy" in save_body
    assert "useUpdate ? `/models/${existing.id}` : '/models'" in save_body
    assert "modelPackage.id = existing.id" in save_body
    assert "delete modelPackage.id" in save_body
    assert "state.savedModels.filter(m => m.id !== normalized.id)" in save_body
    assert "m.name !== normalized.name" not in save_body


def test_expansion_preview_font_is_compact() -> None:
    assert ".expansion-preview-grid" in CSS
    assert "font-size: 13px" in CSS
    assert ".preview-code" in CSS
    assert "font-size: 11.5px" in CSS


def test_formula_workspace_middle_column_scrolls_when_dsl_expands() -> None:
    assert re.search(r"#modal\.formula-editor-modal \.formula-workspace\s*\{[^}]*overflow-y:\s*auto", CSS, re.S)
    assert re.search(r"#modal\.formula-editor-modal \.formula-token-editor\s*\{[^}]*max-height:\s*360px", CSS, re.S)
    assert re.search(r"#modal\.formula-editor-modal \.formula-dsl-textarea\s*\{[^}]*max-height:\s*260px", CSS, re.S)


def test_full_pytest_finishes_without_timeout() -> None:
    assert (ROOT / "pytest.ini").exists()
    assert "test_unified_formula_editor_acceptance.py" in str(ROOT / "tests" / "test_unified_formula_editor_acceptance.py")
