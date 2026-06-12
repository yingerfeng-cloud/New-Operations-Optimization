// Page map, render loop and initialization.
    function render() {
      try {
        document.getElementById('nav').innerHTML = navHtml();
        const backendPill = document.getElementById('backendStatusPill');
        if (backendPill) {
          backendPill.textContent = state.backendOnline ? '在线' : '未连接';
          backendPill.className = `pill ${state.backendOnline ? 'green' : 'amber'}`;
        }
        const pageFn = pages[state.page] || pageDashboard;
        document.getElementById('content').innerHTML = pageFn();
        if (document.getElementById('semanticSetEditor') && typeof updateSemanticSetTypeVisibility === 'function') {
          updateSemanticSetTypeVisibility();
        }
      } catch (e) {
        console.error('Render failed', e);
        document.getElementById('content').innerHTML = shell('页面加载失败', '单个组件渲染异常，页面已进入降级模式。') +
          panel('错误信息', `<pre>${escapeHtml(e.message || e)}</pre><button class="btn primary" onclick="go('dashboard')">返回首页</button>`);
      }
    }

    function go(page) {
      state.page = page;
      render();
      if (state.backendOnline && page === 'tasks') refreshTasks();
      if (state.backendOnline && page === 'assets') refreshModels();
      if (state.backendOnline && page === 'components') refreshComponentRegistry();
      if (state.backendOnline && page === 'skills') refreshSkills();
    }

    const pages = {
      dashboard: pageDashboard,
      domains: pageDomains,
      builder: pageBuilder,
      assets: pageAssets,
      components: pageComponents,
      solver: pageSolver,
      tasks: pageTasks,
      results: pageResults,
      skills: () => pageSkillAssets(),
      compare: pageCompare,
      integration: pageIntegration,
      ops: pageOps
    };

    pages.skills = pageSkillAssets;
    pages.integration = pageIntegrationEnhanced;

    function exposeGlobalFunctions(names) {
      names.forEach(name => {
        try {
          const fn = eval(name);
          if (typeof fn === 'function') window[name] = fn;
        } catch (e) {}
      });
    }

    exposeGlobalFunctions([
      'addAdditionalConstraintFromForm', 'addBasicConstraintFromForm', 'addBasicConstraintTerm', 'addBasicObjectiveTermFromForm', 'addBasicVariableFromForm',
      'addCompareScenario', 'addComponentEditorArrayRow', 'addComponentToDraft',
      'addIndexedVariableFromForm', 'addLastResultToCompare', 'addSemanticConstraintFromForm', 'addSemanticObjectFromForm', 'addSemanticObjectiveFromForm',
      'addSemanticParameterFromForm', 'addSemanticSetFromForm', 'addSemanticVariableFromForm', 'appendConstraintTemplate', 'appendCustomConstraintJson',
      'appendObjectiveTerm', 'appendVariableTemplate', 'applyComparePerturbation', 'applyFormulaEditor', 'applyFormulaTemplate', 'beginCreateComponent',
      'beginEditComponent', 'callModelFromAsset', 'cancelComponentEditor', 'cancelFormulaEditor', 'cancelTask', 'checkBackend', 'checkModelInterfaceServiceStatus',
      'closeModal', 'copyComponentVersion', 'copyEncodedText', 'copyModelVersion', 'copyTaskParametersRetry', 'copyText', 'createBlankModel',
      'deleteCompareScenario', 'deleteManagedComponent', 'deleteModelVersion', 'disableAssetSkill', 'disableOptionalRules', 'duplicateCompareScenario',
      'editSemanticItem', 'enableCoreRules', 'enterDemoMode', 'enterModeling', 'exitDemoMode', 'exportLastResultReport', 'exportPowerDemoReport',
      'exportTaskReport', 'generateModel', 'generateModelPackage', 'generateRuntimeTimeSets', 'go', 'importCompareJson', 'insertFormulaToken',
      'insertFormulaTokenFromObject', 'insertFormulaOperatorToken', 'insertFormulaFunctionToken', 'removeFormulaToken', 'moveFormulaToken',
      'formulaTokenDragStart', 'formulaTokenDrop', 'handleFormulaTokenEditorKeydown', 'openFormulaTokenProperties', 'openAggregateChildTokenProperties',
      'openNestedAggregateBodyTokenProperties', 'openWrapperChildTokenProperties', 'removeAggregateBodyToken', 'removeWrapperBodyToken',
      'setFormulaInsertionPoint', 'clearFormulaInsertionPoint', 'clearFormulaEditorTokens', 'toggleFormulaAdvancedDsl', 'updateAdvancedDslFormula',
      'applyFormulaFunctionWizard', 'loadFormulaExample',
      'installPowerTemplateDemoDock', 'loadComponentTemplateExample', 'loadMinimalEconomicDispatchExample', 'loadModel', 'loadModelVersion',
      'loadPowerTemplates', 'loadSelectedModelStructure', 'manageScene', 'moveComponentDown', 'moveComponentUp', 'moveObjectiveTerm',
      'offlineManagedComponent', 'openComponentDetail', 'closeComponentDetail', 'setComponentDetailTab',
      'setComponentSearch', 'setComponentPage', 'setComponentPageSize',
      'openComponentEditorJsonDebug', 'openComponentObjectiveFormulaEditor', 'openGenericConstraintFormulaEditor',
      'openGenericObjectiveFormulaEditor', 'openInfoModal', 'openInvocationDetail', 'openModal', 'openModelInterfaceRecords', 'openStructuredFormulaBuilder',
      'openTaskError', 'openTaskLog', 'openTaskRawParameters', 'openTaskSolveResult', 'refreshComponentRegistry', 'refreshComponentSpecFromUi',
      'refreshInvocations', 'refreshModels', 'refreshSkills', 'refreshTasks', 'removeAdditionalConstraint', 'removeBasicConstraint',
      'removeBasicConstraintTerm', 'removeBasicObjectiveTerm', 'removeBasicVariable', 'removeComponentEditorArrayRow', 'removeComponentFromDraft',
      'removeIndexedConstraint', 'removeIndexedObjectiveTerm', 'removeIndexedVariable', 'removeSemanticItem', 'restoreRecommendedComponentsForScenario',
      'runAllCompareScenarios', 'runModelInterface', 'runPowerClosedLoopDemo', 'saveComponentEditor', 'saveModal', 'saveModelToAssets',
      'selectAssetCategory', 'selectBasicConstraint', 'selectComponentDetail', 'selectDomain', 'selectGenericRule', 'selectManagedComponent',
      'selectModel', 'selectRuntimeTemplate', 'selectScene', 'setApiBase', 'setBuilderModeOption', 'setBuilderStep', 'setComponentEditorTab',
      'setFilter', 'setGenericBuilderMode', 'setInvocationPage', 'setInvocationPageSize', 'setMode', 'setModelInterfaceApiBase',
      'setProblemTypeOverride', 'setSceneManageTab', 'setSearch', 'setSolverBackend', 'setTaskPage', 'setTaskPageSize', 'showFormulaExamples',
      'updateSemanticSetFormDraftFromDom',
      'submitRuntimeTemplateTask', 'submitTask', 'syncComponentListFromSpec', 'syncConstraintCodeFromRule', 'syncObjectiveCodeFromSemantic', 'syncGenericSpecFromSemantic', 'testApi',
      'toast', 'toggleAdditionalConstraintMode', 'toggleAdvancedMode', 'toggleCompare', 'toggleComponentEditorEnabled', 'toggleComponentEnabled',
      'toggleComponentSpecExpanded', 'toggleGenericRule', 'toggleObjectiveTerm', 'toggleScene', 'updateBasicObjectiveConstant', 'updateCompareScenario',
      'updateComponentEditorArray', 'updateComponentEditorField', 'updateComponentEditorMulti', 'updateFormulaDraft', 'updateFormulaObjectiveSense',
      'updateHydroWeight', 'updateMathTemplateField', 'updateRuleConfig', 'updateSemanticJson', 'updateSolver', 'validateComponentDependencies',
      'validateComponentEditor', 'validateComponentRuntimeParameters', 'validateComponentSpec', 'validateCurrentFormula', 'validateGenericSpec',
      'validateManagedComponentFormula', 'validateModel', 'validateSingleComponentDependencies', 'viewAsset', 'viewModelAssetDetail',
      'syncIndexedVariableDefaults',
      'render', 'pageBuilder', 'openFormulaEditor', 'viewResult'
    ]);

    async function init() {
      render();
      await checkBackend();
    }

    init();
