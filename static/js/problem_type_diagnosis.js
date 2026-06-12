// Problem type diagnosis helpers extracted from prototype.html to keep model-builder iteration scoped.
// These functions intentionally use the existing global prototype state and helpers at call time.

function normalizeProblemType(type = 'LP') {
      const value = String(type || 'LP').trim().toUpperCase();
      return value === 'MIP' ? 'MILP' : value || 'LP';
    }

    function solverSupportedProblemTypes(solver = 'HiGHS') {
      const key = String(solver || 'HiGHS').toLowerCase();
      const table = { highs: ['LP', 'MILP', 'QP'], appsi_highs: ['LP', 'MILP', 'QP'], ipopt: ['NLP'], bonmin: ['MINLP'] };
      return table[key] || table.highs;
    }

    function expressionClassFromText(text = '', variableNames = new Set()) {
      const value = String(text || '').toLowerCase();
      if (/delta\s*\(/.test(value)) return 'linear';
      if (/(sin|cos|exp|log|sqrt)\s*\(/.test(value) || /\*\*\s*[3-9]|\^\s*[3-9]/.test(value)) return 'nonlinear';
      if (/\*\*\s*2|\^\s*2/.test(value)) return 'quadratic';
      const productPattern = /([a-z_]\w*)\s*\[[^\]]+\]\s*\*\s*([a-z_]\w*)\s*\[[^\]]+\]/g;
      let match;
      while ((match = productPattern.exec(value)) !== null) {
        if (variableNames.has(match[1]) && variableNames.has(match[2])) return 'quadratic';
      }
      return 'linear';
    }

    function maxExpressionClass(classes = []) {
      const rank = { linear: 1, quadratic: 2, nonlinear: 3 };
      return (classes || []).reduce((best, item) => (rank[item] || 1) > (rank[best] || 1) ? item : best, 'linear');
    }

    function diagnoseProblemTypeFromDraft(draft = getCurrentModelDraft(), solver = state.solverBackend || 'HiGHS') {
      const semanticVars = draft.semantic?.variables || [];
      const variableNames = new Set(semanticVars.map(v => String(v.code || v.name || v.key || v.math_var || '')).filter(Boolean));
      const resolvedComponents = (draft.components || []).filter(c => c.enabled !== false).map(c => {
        const type = c.type || c.component_id || c.code;
        const definition = c.definition || componentRegistryMeta(type) || {};
        return { ...c, type, component_id: type, definition };
      });
      const componentVars = resolvedComponents.flatMap(c => c.definition?.variables || []);
      const variableTypes = [...semanticVars, ...componentVars].map(v => String(v.domain || v.type || v.variable_type || 'continuous').toLowerCase());
      const integerDetails = [];
      resolvedComponents.forEach(c => {
        (c.definition?.variable_types || []).forEach(t => variableTypes.push(String(t).toLowerCase()));
        (c.definition?.variables || []).forEach(v => {
          const name = String(v.code || v.name || v.key || '');
          if (name) variableNames.add(name);
          const rawType = String(v.domain || v.type || v.variable_type || 'continuous').toLowerCase();
          if (['binary', 'bool', 'boolean', 'integer', 'integers', 'int', 'nonnegativeintegers'].includes(rawType.replace(/_/g, ''))) {
            integerDetails.push({ component_id: c.type, component_name: c.definition?.name || c.definition?.display_name || c.type, variable_name: v.code || v.name || v.key || '', variable_type: rawType });
          }
        });
      });
      const hasInteger = variableTypes.some(t => ['binary', 'bool', 'boolean', 'integer', 'integers', 'int', 'nonnegativeintegers'].includes(t.replace(/_/g, '')));
      const constraints = draft.generated_constraints || buildConstraintsFromDraft(draft);
      const objectiveTerms = draft.objective?.terms || [];
      const classes = [
        ...constraints.filter(c => c.enabled !== false).map(c => c.expression_class || expressionClassFromText(c.expression || c.formula || '', variableNames)),
        ...objectiveTerms.filter(t => t.enabled !== false).map(t => t.expression_class || expressionClassFromText(t.expression || '', variableNames)),
        ...resolvedComponents.map(c => c.definition?.expression_class || 'linear')
      ];
      const expressionClass = maxExpressionClass(classes);
      const inferred = expressionClass === 'nonlinear' ? (hasInteger ? 'MINLP' : 'NLP') : expressionClass === 'quadratic' ? (hasInteger ? 'MIQP' : 'QP') : (hasInteger ? 'MILP' : 'LP');
      const manualOverride = draft.advanced?.manual_problem_type_override || draft.basic_info?.problem_type || '';
      const requested = normalizeProblemType(manualOverride || inferred);
      const supportedTypes = solverSupportedProblemTypes(solver);
      const solverSupported = supportedTypes.includes(requested);
      const validOverride = inferred === requested || (inferred === 'LP' && requested === 'MILP');
      const reasons = [
        ...(integerDetails.length ? integerDetails.map(item => `组件 ${item.component_name} 引入 ${item.variable_type} 变量 ${item.variable_name}`) : [hasInteger ? '检测到 binary/integer 变量' : '变量均为连续变量']),
        expressionClass === 'linear' ? '约束和目标函数为线性表达式' : expressionClass === 'quadratic' ? '存在二次表达式' : '存在非线性表达式',
        `因此推荐 ${inferred}`
      ];
      const warnings = [];
      if (inferred === 'LP' && requested === 'MILP') warnings.push('模型实际为 LP，手动指定 MILP 可以发布，但建议使用 LP。');
      else if (inferred !== requested) warnings.push(`手动指定 ${requested} 与系统诊断 ${inferred} 不一致，发布前会强校验。`);
      if (!solverSupported) warnings.push(`求解器 ${solver} 不支持 ${requested}。`);
      return { inferred_problem_type: inferred, recommended_problem_type: inferred, requested_problem_type: requested, effective_problem_type: requested, expression_class: expressionClass, has_integer_variables: hasInteger, variable_types: [...new Set(variableTypes.length ? variableTypes : ['continuous'])], integer_variable_details: integerDetails, solver, solver_supported: solverSupported, solver_supported_problem_types: supportedTypes, reasons, warnings, publish_valid: validOverride && solverSupported };
    }

    function applyProblemTypeDiagnosis(draft, componentSpec = null) {
      const diagnosis = diagnoseProblemTypeFromDraft(draft, draft.basic_info?.solver || state.solverBackend || 'HiGHS');
      draft.inferred_problem_type = diagnosis.inferred_problem_type;
      draft.problem_type_diagnosis = diagnosis;
      if (componentSpec) {
        componentSpec.model_problem_type = diagnosis.effective_problem_type;
        componentSpec.inferred_problem_type = diagnosis.inferred_problem_type;
        componentSpec.problem_type_diagnosis = diagnosis;
        componentSpec.required_solver_capabilities = [diagnosis.effective_problem_type];
      }
      return diagnosis;
    }

    function assertProblemTypePublishable(modelPackage) {
      const diagnosis = modelPackage.model_draft?.problem_type_diagnosis || modelPackage.component_spec?.problem_type_diagnosis;
      if (!diagnosis) return;
      if (!diagnosis.publish_valid) {
        const reason = (diagnosis.warnings || [])[0] || `系统诊断为 ${diagnosis.inferred_problem_type}，当前指定为 ${diagnosis.requested_problem_type}`;
        throw new Error(`模型类型发布校验失败：${reason}`);
      }
    }

function problemTypeDiagnosisCard(draft = getCurrentModelDraft()) {
      const diagnosis = draft.problem_type_diagnosis || diagnoseProblemTypeFromDraft(draft);
      const status = !diagnosis.publish_valid ? '<span class="pill red">需处理</span>' : (diagnosis.warnings || []).length ? '<span class="pill amber">可发布，有提示</span>' : '<span class="pill green">可发布</span>';
      const supported = diagnosis.solver_supported ? '<span class="pill green">支持</span>' : '<span class="pill red">不支持</span>';
      const warningRows = (diagnosis.warnings || []).map(item => `<li>${escapeHtml(item)}</li>`).join('') || '<li>暂无风险提示。</li>';
      return `<div class="grid cols-2">
        <div>
          <table class="compact-table"><tbody>
            <tr><th>系统推荐类型</th><td><strong>${escapeHtml(diagnosis.recommended_problem_type || diagnosis.inferred_problem_type || 'LP')}</strong></td></tr>
            <tr><th>高级指定类型</th><td>${escapeHtml(diagnosis.requested_problem_type || '-')}</td></tr>
            <tr><th>表达式类别</th><td>${escapeHtml(diagnosis.expression_class || 'linear')}</td></tr>
            <tr><th>整数变量</th><td>${diagnosis.has_integer_variables ? '存在' : '无'}</td></tr>
            <tr><th>求解器支持</th><td>${supported} ${escapeHtml((diagnosis.solver_supported_problem_types || []).join(', ') || '-')}</td></tr>
            <tr><th>发布校验</th><td>${status}</td></tr>
          </tbody></table>
        </div>
        <div style="font-size:13px">
          <p style="font-weight:700;margin:0 0 4px;font-size:13px">推荐原因</p><ul style="margin:0 0 10px;padding-left:16px;line-height:1.7">${(diagnosis.reasons || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
          <p style="font-weight:700;margin:0 0 4px;font-size:13px">风险提示</p><ul style="margin:0 0 10px;padding-left:16px;line-height:1.7">${warningRows}</ul>
          <div class="field mt"><label>高级覆盖问题类型</label><select onchange="setProblemTypeOverride(this.value)">
            <option value="" ${!(draft.advanced?.manual_problem_type_override || draft.basic_info?.problem_type) ? 'selected' : ''}>跟随系统推荐</option>
            ${['LP','MILP','QP','MIQP','NLP','MINLP'].map(type => `<option value="${type}" ${diagnosis.requested_problem_type === type ? 'selected' : ''}>${type}</option>`).join('')}
          </select><small>MIP 会自动归一为 MILP；发布前以后端最终诊断为准。</small></div>
        </div>
      </div>`;
    }

    function setProblemTypeOverride(type) {
      const draft = getCurrentModelDraft();
      draft.advanced = { ...(draft.advanced || {}) };
      if (!type) {
        delete draft.advanced.manual_problem_type_override;
      } else {
        draft.advanced.manual_problem_type_override = normalizeProblemType(type);
      }
      state.modelDraft = draft;
      refreshComponentSpecFromUi();
      toast(type ? `已手动指定问题类型：${normalizeProblemType(type)}` : '已清除手动问题类型，跟随系统推荐');
      render();
    }

