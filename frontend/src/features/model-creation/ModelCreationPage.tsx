import { Button, Dropdown, Modal, Space, message } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createModel, createModelVersion, getModel, publishModel, testModel, updateModel } from '../../api/models';
import { getSystemConfig } from '../../api/systemConfig';
import { getTemplateDetail, getTemplates } from '../../api/templates';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, PageLoading } from '../../components/PageStates';
import { ActionFooter, PageShell, StepBody } from '../../components/LayoutPrimitives';
import { createBlankDraft, useModelCreationStore, type ModelDraft } from './stores/modelCreationStore';
import { scenarioCatalog, scenariosFromDictionary } from './data/scenarioCatalog';
import { applyTemplateToDraft } from './utils/applyTemplateToDraft';
import { normalizeModelDraft } from './utils/normalizeModelDraft';
import { saveModelDraftAsset } from './utils/saveModelDraftAsset';
import { validateModelDraft } from './utils/validateModelDraft';
import { Step1BasicInfo } from './steps/Step1BasicInfo';
import { Step2SemanticModel } from './steps/Step2SemanticModel';
import { Step3MathExpansion } from './steps/Step3MathExpansion';
import { Step4RuntimeParams } from './steps/Step4RuntimeParams';
import { Step5ReviewPublish } from './steps/Step5ReviewPublish';
import { ModelBuildSummaryBar } from './components/ModelBuildSummaryBar';
import { ModelCreationProgress, type ModelCreationStepMeta } from './components/ModelCreationProgress';
import { ModelInspectionDrawer } from './components/ModelInspectionDrawer';
import { FocusEditor } from './components/FocusEditor';
import { StepSectionNav, type StepSectionItem } from './components/StepSectionNav';
import { blockerMessage, canEnterStep, firstStepError, type ModelValidationIssue } from './utils/workflowGuard';
import { assetToWorkspaceDraft, effectiveAssetMode, parseWorkspaceRequest, workspaceTitles } from './utils/workspaceMode';
import { useFocusEditorContext } from './hooks/useFocusEditorContext';
import { executeModelNavigationCommand, type ModelNavigationCommand } from './navigation/modelNavigationCommand';

const stepMeta: ModelCreationStepMeta[] = [
  { title: '基础信息', description: '选择业务场景、模型编码、建模模式和求解器。', sectionKeys: ['basic_info'] },
  { title: '模型语义', description: '维护集合、参数、变量、业务规则和组件依赖关系。', sectionKeys: ['semantic_structure', 'component_dependencies', 'parameter_bindings'] },
  { title: '数学展开', description: '将业务语义展开为目标函数、约束条件和可编译公式。', sectionKeys: ['formula', 'problem_type'] },
  { title: '运行参数', description: '配置运行时输入、组件参数和函数资产绑定。', sectionKeys: ['runtime_parameters'] },
  { title: '校验发布', description: '完成 dry-run、兼容性检查、测试运行和模型发布。', sectionKeys: ['solver_compatibility'] },
];

const stepSections: StepSectionItem[][] = [
  [{ key: 'creation', label: '创建方式' }, { key: 'scenario', label: '业务场景', aliases: ['模型定位'] }, { key: 'model', label: '模型信息' }, { key: 'mode', label: '建模模式', aliases: ['创建方式'] }, { key: 'objective', label: '目标策略' }],
  [{ key: 'overview', label: '语义概览' }, { key: 'dependencies', label: '组件依赖' }, { key: 'time', label: '时间维度' }, { key: 'sets', label: '集合' }, { key: 'parameters', label: '参数' }, { key: 'variables', label: '变量' }, { key: 'rules', label: '业务规则' }],
  [{ key: 'objective', label: '目标函数' }, { key: 'constraints', label: '约束条件' }, { key: 'mapping', label: '函数映射' }, { key: 'expansion', label: '组件展开' }, { key: 'compile', label: '编译预览', aliases: ['展开预览'] }, { key: 'debug', label: '高级调试' }],
  [{ key: 'time', label: '时间维度摘要' }, { key: 'basic', label: '基础参数', aliases: ['基础参数绑定'] }, { key: 'series', label: '时间序列' }, { key: 'functions', label: '函数资产', aliases: ['函数/曲线资产绑定'] }, { key: 'bindings', label: '参数绑定' }, { key: 'preview', label: '结构预览', aliases: ['运行参数结构预览'] }],
  [{ key: 'validation', label: '模型校验', aliases: ['发布前校验'] }, { key: 'test', label: '测试运行' }, { key: 'compatibility', label: '兼容性', aliases: ['模型求解路径'] }, { key: 'publish-info', label: '发布信息', aliases: ['发布诊断'] }, { key: 'publish', label: '发布操作' }],
];

interface ModelTestRequestContext {
  sequence: number;
  draft: ReturnType<typeof normalizeModelDraft>;
  testedSnapshot: string;
}

interface ModelTestSuccessContext {
  sequence: number;
  modelId: string;
  testedSnapshot: string;
  model: Awaited<ReturnType<typeof testModel>>;
}

export function ModelCreationPage() {
  const [modal, modalContextHolder] = Modal.useModal();
  const nav = useNavigate();
  const { id: routeModelId } = useParams();
  const [searchParams] = useSearchParams();
  const initializedKeyRef = useRef('');
  const [visitedThrough, setVisitedThrough] = useState(0);
  const [showAllValidation, setShowAllValidation] = useState(false);
  const [testedAsset, setTestedAsset] = useState<{ id: string; snapshot: string }>();
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [mainScrollContainer, setMainScrollContainer] = useState<HTMLElement | null>(null);
  const [activeSection, setActiveSection] = useState<string>();
  const [lastSavedAt, setLastSavedAt] = useState<string>();
  const testRequestSequenceRef = useRef(0);
  const issueNavigationTimerRef = useRef<number | undefined>(undefined);
  const focusStartDraftRef = useRef<ModelDraft | undefined>(undefined);
  const focusStartSnapshotRef = useRef<string | undefined>(undefined);
  const {
    draft,
    step,
    workspace,
    currentDraftModelId,
    setStep,
    setDraft,
    initializeWorkspace,
    setWorkspace,
    setCurrentDraftModelId,
    setLoadedTemplate,
    setValidationResult,
    reset,
  } = useModelCreationStore();
  const focusContext = useFocusEditorContext({ scrollContainer: mainScrollContainer, stepIndex: step, sectionKey: activeSection, onRestoreStep: setStep });
  const templates = useQuery({ queryKey: ['templates'], queryFn: getTemplates });
  const systemConfig = useQuery({ queryKey: ['system-config'], queryFn: getSystemConfig, retry: false });
  const scenarioDictionary = systemConfig.data?.dictionaries?.business_scenarios;
  const configuredScenarios = useMemo(() => scenariosFromDictionary(scenarioDictionary), [scenarioDictionary]);
  const availableScenarios = useMemo(
    () => systemConfig.isError ? scenarioCatalog : scenarioDictionary === undefined ? [] : configuredScenarios,
    [configuredScenarios, scenarioDictionary, systemConfig.isError],
  );
  const request = useMemo(() => parseWorkspaceRequest(searchParams, routeModelId), [routeModelId, searchParams]);
  const sourceModel = useQuery({
    queryKey: ['model-workspace-source', request.sourceModelId],
    queryFn: ({ signal }) => getModel(request.sourceModelId!, signal),
    enabled: !!request.sourceModelId,
    retry: false,
  });
  const templateDetail = useQuery({
    queryKey: ['model-workspace-template', request.templateCode],
    queryFn: ({ signal }) => getTemplateDetail(request.templateCode!, signal),
    enabled: request.mode === 'template' && !!request.templateCode,
    retry: false,
  });
  const resolvedMode = sourceModel.data ? effectiveAssetMode(request.mode, sourceModel.data) : request.mode;
  const requestKey = `${resolvedMode}:${request.sourceModelId || ''}:${request.templateCode || ''}`;

  useEffect(() => {
    setMainScrollContainer(document.querySelector<HTMLElement>('.main-content'));
  }, []);

  useEffect(() => {
    setVisitedThrough(0);
    setShowAllValidation(false);
    setTestedAsset(undefined);
    testRequestSequenceRef.current += 1;
  }, [requestKey]);

  useEffect(() => {
    setVisitedThrough(current => Math.max(current, step));
  }, [step]);

  useEffect(() => {
    if (!request.legacySource || !sourceModel.data || !request.sourceModelId) return;
    const mode = effectiveAssetMode('edit', sourceModel.data);
    nav(mode === 'edit' ? `/models/${encodeURIComponent(request.sourceModelId)}/edit` : `/models/create?mode=version&source=${encodeURIComponent(request.sourceModelId)}`, { replace: true });
  }, [nav, request.legacySource, request.sourceModelId, sourceModel.data]);

  useEffect(() => {
    let active = true;
    initializedKeyRef.current = '';
    setWorkspace({ mode: resolvedMode, sourceModelId: request.sourceModelId, templateCode: request.templateCode, initialized: false, dirty: false });

    if (request.legacySource) return () => { active = false; };
    if (systemConfig.isPending) return () => { active = false; };
    if (resolvedMode === 'new') {
      const blank = createBlankDraft();
      initializedKeyRef.current = requestKey;
      initializeWorkspace({ mode: 'new', sessionId: requestKey }, blank);
      return () => { active = false; };
    }
    if (resolvedMode === 'template' && templateDetail.data) {
      const templateScenario = availableScenarios.find(item => item.id === templateDetail.data.scenario || item.name === templateDetail.data.scenario);
      const blank = createBlankDraft();
      const next = applyTemplateToDraft(blank, templateDetail.data, templateScenario?.name || templateDetail.data.scenario || '');
      next.basic_info.scenario_id = templateScenario?.id;
      if (active) {
        initializedKeyRef.current = requestKey;
        initializeWorkspace({ mode: 'template', templateCode: request.templateCode, sessionId: requestKey }, next);
        setLoadedTemplate(templateDetail.data);
      }
      return () => { active = false; };
    }
    if (resolvedMode === 'template' && !request.templateCode) {
      const blank = createBlankDraft();
      initializedKeyRef.current = requestKey;
      initializeWorkspace({ mode: 'template', sessionId: requestKey }, blank);
      return () => { active = false; };
    }
    if (request.sourceModelId && sourceModel.data) {
      const next = assetToWorkspaceDraft(sourceModel.data, resolvedMode);
      const scenario = availableScenarios.find(item => item.id === next.basic_info.scenario || item.name === next.basic_info.scenario);
      const disabledScenario = scenarioDictionary?.find(item => item.enabled === false && (item.code === next.basic_info.scenario || item.label === next.basic_info.scenario));
      next.basic_info.scenario_id = scenario?.id || disabledScenario?.code || next.basic_info.scenario || undefined;
      const currentAssetId = resolvedMode === 'edit' ? sourceModel.data.id : undefined;
      if (active) {
        initializedKeyRef.current = requestKey;
        initializeWorkspace({
          mode: resolvedMode,
          sourceModelId: sourceModel.data.id,
          modelFamilyId: String(sourceModel.data.model_family_id || '') || undefined,
          currentAssetId,
          sessionId: requestKey,
        }, next, 1);
      }
    }
    return () => { active = false; };
  }, [availableScenarios, initializeWorkspace, request.legacySource, request.sourceModelId, request.templateCode, requestKey, resolvedMode, scenarioDictionary, setLoadedTemplate, setWorkspace, sourceModel.data, systemConfig.isPending, templateDetail.data]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!useModelCreationStore.getState().workspace.dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => () => {
    if (issueNavigationTimerRef.current !== undefined) window.clearTimeout(issueNavigationTimerRef.current);
  }, []);

  const saveDraftModel = async (requireValid = false, draftOverride?: ReturnType<typeof normalizeModelDraft>) => {
    const state = useModelCreationStore.getState();
    const createAsset = state.workspace.mode === 'version' && state.workspace.sourceModelId
      ? (payload: Parameters<typeof createModel>[0]) => createModelVersion(state.workspace.sourceModelId!, payload)
      : createModel;
    const model = await saveModelDraftAsset(draftOverride || state.draft, state.currentDraftModelId, { createModel: createAsset, updateModel }, requireValid);
    state.setCurrentDraftModelId(model.id);
    state.setWorkspace({ dirty: false, currentAssetId: model.id });
    return model;
  };
  const saveDraft = useMutation({ mutationFn: () => saveDraftModel(false), onSuccess: () => { setLastSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })); message.success('草稿已保存'); } });
  const publish = useMutation({
    mutationFn: async () => {
      const state = useModelCreationStore.getState();
      const snapshot = JSON.stringify(normalizeModelDraft(state.draft));
      if (!state.currentDraftModelId || testedAsset?.id !== state.currentDraftModelId) throw new Error('当前模型资产尚未通过测试，请先保存并测试。');
      if (testedAsset.snapshot !== snapshot) throw new Error('模型在上次测试通过后发生了修改，请重新保存并测试后再发布。');
      return publishModel(state.currentDraftModelId);
    },
    onSuccess: model => {
      message.success('模型流程执行成功');
      reset();
      nav(`/models/${model.id}`);
    },
  });
  const testRun = useMutation<ModelTestSuccessContext, Error, ModelTestRequestContext>({
    mutationFn: async requestContext => {
      const model = await saveDraftModel(true, requestContext.draft);
      const testedModel = await testModel(model.id, requestContext.draft.runtime_parameters);
      return {
        sequence: requestContext.sequence,
        modelId: model.id,
        testedSnapshot: requestContext.testedSnapshot,
        model: testedModel,
      };
    },
  });

  const runModelTest = async () => {
    const capturedDraft = normalizeModelDraft(useModelCreationStore.getState().draft);
    const requestContext: ModelTestRequestContext = {
      sequence: ++testRequestSequenceRef.current,
      draft: capturedDraft,
      testedSnapshot: JSON.stringify(capturedDraft),
    };
    try {
      const result = await testRun.mutateAsync(requestContext);
      if (result.sequence !== testRequestSequenceRef.current) return undefined;
      setTestedAsset({ id: result.modelId, snapshot: result.testedSnapshot });
      return result.model;
    } catch (error) {
      if (requestContext.sequence !== testRequestSequenceRef.current) return undefined;
      throw error;
    }
  };

  const confirmSourceSwitch = () => new Promise<boolean>(resolve => {
    if (!useModelCreationStore.getState().workspace.dirty) {
      resolve(true);
      return;
    }
    modal.confirm({
      title: '确认切换模型来源？',
      content: '切换后将清空当前模型语义、组件、公式和运行参数，是否继续？',
      okText: '继续切换',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });

  const handleScenarioSelection = async (scenarioId: string) => {
    if (!(await confirmSourceSwitch())) return;
    const scenario = availableScenarios.find(item => item.id === scenarioId);
    const current = useModelCreationStore.getState().draft;
    const next = createBlankDraft({ generateCode: false });
    next.basic_info = {
      ...next.basic_info,
      name: current.basic_info.name,
      model_code: current.basic_info.model_code,
      solver: current.basic_info.solver,
      scenario: scenario?.name || '',
      scenario_id: scenarioId,
    };
    initializeWorkspace({ mode: 'new', sessionId: `new:${Date.now()}` }, next);
    setWorkspace({ dirty: true });
  };

  const handleTemplateSelection = async (code: string) => {
    if (!(await confirmSourceSwitch())) return;
    if (!code) {
      nav('/models/create?mode=template');
      return;
    }
    nav(`/models/create?mode=template&template=${encodeURIComponent(code)}`);
  };

  const handleCreationMode = async (mode: 'new' | 'template') => {
    if ((mode === 'new' && workspace.mode === 'new') || (mode === 'template' && workspace.mode === 'template')) return;
    if (!(await confirmSourceSwitch())) return;
    nav(mode === 'template' ? '/models/create?mode=template' : '/models/create?mode=new');
  };

  const missingSource = (resolvedMode === 'edit' || resolvedMode === 'clone' || resolvedMode === 'version') && !request.sourceModelId;
  const loadError = sourceModel.error || templateDetail.error;
  if (missingSource || loadError) {
    return (
      <PageShell className="model-creation-page">
        <ErrorState
          title={sourceModel.error ? '目标模型加载失败' : templateDetail.error ? '模型模板加载失败' : '工作台地址不完整'}
          description={missingSource ? '当前模式缺少来源模型 ID。' : '目标数据未能加载，旧草稿不会继续显示。'}
          retry={loadError ? () => void (sourceModel.error ? sourceModel.refetch() : templateDetail.refetch()) : undefined}
          actions={[{ label: '返回模型资产', onClick: () => nav('/models') }]}
        />
      </PageShell>
    );
  }

  const waitingForData = request.legacySource
    || systemConfig.isPending
    || (!!request.sourceModelId && sourceModel.isPending)
    || (resolvedMode === 'template' && !!request.templateCode && templateDetail.isPending)
    || initializedKeyRef.current !== requestKey
    || !workspace.initialized;
  if (waitingForData) {
    return <PageLoading label={resolvedMode === 'template' ? '正在加载完整模型模板…' : request.sourceModelId ? '正在加载目标模型资产…' : '正在初始化空白工作台…'} />;
  }

  const normalized = normalizeModelDraft(draft);
  const currentSnapshot = JSON.stringify(normalized);
  const focusDirty = Boolean(focusStartSnapshotRef.current && focusStartSnapshotRef.current !== currentSnapshot);
  const testIsCurrent = Boolean(currentDraftModelId && testedAsset?.id === currentDraftModelId && testedAsset.snapshot === currentSnapshot);
  const validation = validateModelDraft(normalized);
  const visibleStepLimit = showAllValidation ? stepMeta.length - 1 : Math.max(step, visitedThrough);
  const visibleSteps = stepMeta.slice(0, visibleStepLimit + 1);
  const visibleSectionKeys = visibleSteps.flatMap(item => item.sectionKeys);
  const firstBlocker = visibleSteps.map((item, index) => firstStepError(validation, item, index)).find(Boolean);
  const enterStep = (targetStep: number) => {
    const guard = canEnterStep({ targetStep, currentStep: step, steps: stepMeta, validation });
    if (!guard.allowed) {
      message.warning(blockerMessage(guard.blocker));
      return;
    }
    setVisitedThrough(current => Math.max(current, targetStep));
    setStep(targetStep);
  };
  const navigateIssue = (issue: ModelValidationIssue) => {
    setInspectionOpen(false);
    setVisitedThrough(current => Math.max(current, issue.stepIndex));
    setStep(issue.stepIndex);
    if (issueNavigationTimerRef.current !== undefined) window.clearTimeout(issueNavigationTimerRef.current);
    issueNavigationTimerRef.current = window.setTimeout(() => {
      issueNavigationTimerRef.current = undefined;
      const command: ModelNavigationCommand = { ...issue.location, requestId: `${issue.code}-${Date.now()}` };
      void executeModelNavigationCommand(command, document.getElementById('model-step-content')).then(result => {
        if (result === 'section') message.warning('已定位到对应章节，未找到可精确聚焦的字段。');
        if (result === 'missing') message.warning('目标当前不可见，请在对应步骤中检查该阻断项。');
      });
    }, 120);
  };
  const pages = [
    <Step1BasicInfo
      draft={draft}
      workspace={workspace}
      sourceAsset={sourceModel.data}
      templates={templates.data || []}
      scenarios={availableScenarios}
      onChange={setDraft}
      onScenario={handleScenarioSelection}
      onTemplate={handleTemplateSelection}
      onModeChange={handleCreationMode}
      disabledScenarios={(scenarioDictionary || []).filter(item => item.enabled === false)}
    />,
    <Step2SemanticModel draft={draft} onChange={setDraft} />,
    <Step3MathExpansion draft={draft} onChange={setDraft} />,
    <Step4RuntimeParams draft={draft} onChange={setDraft} />,
    <Step5ReviewPublish
      draft={normalized}
      validation={validation}
      onTest={runModelTest}
      pending={false}
      testRevisionState={!testedAsset ? 'untested' : testIsCurrent ? 'current' : 'outdated'}
      onFixStep={setStep}
    />,
  ];

  const validateCurrentDraft = () => {
    setShowAllValidation(true);
    setVisitedThrough(stepMeta.length - 1);
    setValidationResult(validation);
    const firstError = Object.values(validation.sections).flatMap(section => section.errors)[0];
    if (validation.valid) message.success('模型校验通过');
    else message.error(firstError || '模型校验未通过');
  };

  const openFocusEditor = () => {
    focusContext.capture();
    focusStartDraftRef.current = structuredClone(draft);
    focusStartSnapshotRef.current = currentSnapshot;
    setFocusOpen(true);
  };

  const closeFocusEditor = (discard = false) => {
    if (discard && focusStartDraftRef.current) setDraft(structuredClone(focusStartDraftRef.current));
    setFocusOpen(false);
    focusContext.restore();
    focusStartDraftRef.current = undefined;
    focusStartSnapshotRef.current = undefined;
  };

  const confirmReset = () => {
    modal.confirm({
      title: '确认清空当前草稿？',
      content: '清空后会恢复为空白建模草稿，当前页面未保存的配置将被移除。',
      okText: '清空草稿',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        reset();
        nav('/models/create?mode=new');
      },
    });
  };

  return (
    <PageShell className="model-creation-page">
      {modalContextHolder}
      <PageHeader
        title={workspaceTitles[resolvedMode]}
        description={resolvedMode === 'version' ? '基于已发布模型创建独立的新版本，旧发布版本不会被直接修改。' : '当前工作台仅使用本模式指定的数据源，模式之间不会自动恢复其他草稿。'}
        extra={(
          <Space wrap>
            <Dropdown
              menu={{
                items: [{ key: 'reset', label: '清空草稿', danger: true }],
                onClick: ({ key }) => {
                  if (key === 'reset') confirmReset();
                },
              }}
            >
              <Button icon={<MoreOutlined />}>更多</Button>
            </Dropdown>
          </Space>
        )}
      />

      <ModelBuildSummaryBar draft={draft} validation={validation} blocker={firstBlocker} visibleSectionKeys={visibleSectionKeys} dirty={workspace.dirty} currentStepTitle={stepMeta[step].title} onInspection={() => setInspectionOpen(true)} />
      <ModelCreationProgress currentStep={step} visitedThrough={visibleStepLimit} steps={stepMeta} validation={validation} onChange={enterStep} />
      <StepBody
        title={stepMeta[step].title}
        description={stepMeta[step].description}
      >
        <StepSectionNav items={stepSections[step]} containerId="model-step-content" scrollContainer={mainScrollContainer} resetKey={step} onActiveChange={setActiveSection} onFocus={step >= 1 && step <= 3 ? openFocusEditor : undefined} />
        <div id="model-step-content">{focusOpen ? <div className="focus-editor-placeholder">当前步骤已在聚焦编辑模式中打开。</div> : pages[step]}</div>
      </StepBody>

      <ActionFooter left={<div className="model-footer-left"><Space wrap><Button disabled={step === 0} onClick={() => setStep(step - 1)}>上一步</Button><Button type="primary" disabled={step === 4} onClick={() => enterStep(step + 1)}>下一步</Button></Space><span className="model-footer-status">{workspace.dirty ? '未保存' : lastSavedAt ? `已保存于 ${lastSavedAt}` : '已保存'} · {validation.valid ? '无阻断项' : `${Object.values(validation.sections).flatMap(section => section.errors).length} 项阻断`} · {testIsCurrent ? '最近测试通过' : '当前版本待测试'}</span></div>}>
        <Button onClick={validateCurrentDraft}>校验模型</Button>
        <Button loading={saveDraft.isPending} onClick={() => saveDraft.mutate()}>保存草稿</Button>
        <Button type={step === 4 || validation.valid ? 'primary' : 'default'} disabled={!validation.valid || !testIsCurrent || testRun.isPending} loading={publish.isPending} title={!testIsCurrent ? '请先保存并测试当前修订' : undefined} onClick={() => publish.mutate()}>发布模型</Button>
      </ActionFooter>
      {inspectionOpen && <ModelInspectionDrawer open draft={draft} workspace={workspace} validation={validation} steps={stepMeta} tested={testIsCurrent} onClose={() => setInspectionOpen(false)} onNavigate={navigateIssue} />}
      {focusOpen && <FocusEditor open modelName={draft.basic_info.name} objectName={stepMeta[step].title} dirty={focusDirty} onClose={() => closeFocusEditor()} onDiscard={() => closeFocusEditor(true)} onSave={async () => { await saveDraft.mutateAsync(); }} onValidate={validateCurrentDraft}>{pages[step]}</FocusEditor>}
    </PageShell>
  );
}
