import { Alert, Button, Dropdown, Modal, Space, Typography, message } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DraftLeaveDialog, DraftLeaveGuard } from './components/DraftLeaveGuard';
import { createModel, createModelVersion, getModel, publishModel, testModel, updateModel, returnModelToDraft } from '../../api/models';
import { readModelTest, getModelTestTask } from '../../api/modelTestTracking';
import { terminalTask } from '../../api/taskTracking';
import { editWorkspaceKey, forgetWorkspaceRecovery, readWorkspaceRecovery } from './utils/workspaceRecovery';
import type { ModelAsset } from '../../types/model';
import { getSystemConfig } from '../../api/systemConfig';
import { getTemplateDetail, getTemplates } from '../../api/templates';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, PageLoading } from '../../components/PageStates';
import { ActionFooter, PageShell, StepBody } from '../../components/LayoutPrimitives';
import { createBlankDraft, useModelCreationStore, type ModelDraft } from './stores/modelCreationStore';
import { scenariosFromDictionary } from './data/scenarioCatalog';
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
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const [sourceLeaveOpen, setSourceLeaveOpen] = useState(false);
  const sourceLeaveResolver = useRef<((leave: boolean) => void) | undefined>(undefined);
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
  const [backupAvailable, setBackupAvailable] = useState(true);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testRecoveryError, setTestRecoveryError] = useState('');
  const [, setTrackingRevision] = useState(0);
  const savedAssetRef = useRef<ModelAsset | undefined>(undefined);
  const saveInFlightRef = useRef<{ generation?: string; snapshot: string; promise: Promise<ModelAsset> } | undefined>(undefined);
  const testInFlightRef = useRef<Promise<ModelAsset | undefined> | undefined>(undefined);
  const autoSaveRef = useRef<() => Promise<unknown>>(() => Promise.resolve());
  const restoredSectionRef = useRef('');
  const testRequestSequenceRef = useRef(0);
  const issueNavigationTimerRef = useRef<number | undefined>(undefined);
  const focusStartDraftRef = useRef<ModelDraft | undefined>(undefined);
  const focusStartSnapshotRef = useRef<string | undefined>(undefined);
  const {
    draft,
    step,
    workspace,
    currentDraftModelId,
    testSnapshot,
    lastSavedSnapshot,
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
  const handleSectionChange = useCallback((key: string) => {
    setActiveSection(key);
    if (useModelCreationStore.getState().section !== key) useModelCreationStore.setState({ section: key });
  }, []);
  const templates = useQuery({ queryKey: ['templates'], queryFn: getTemplates });
  const systemConfig = useQuery({ queryKey: ['system-config'], queryFn: getSystemConfig, retry: false });
  const scenarioDictionary = systemConfig.data?.dictionaries?.business_scenarios;
  const configuredScenarios = useMemo(() => scenariosFromDictionary(scenarioDictionary), [scenarioDictionary]);
  const availableScenarios = useMemo(
    () => scenarioDictionary === undefined ? [] : configuredScenarios,
    [configuredScenarios, scenarioDictionary],
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
  const requestKey = `${resolvedMode}:${request.sourceModelId || ''}:${request.templateCode || ''}:${request.scenarioId || ''}`;
  const testTaskId = currentDraftModelId ? readModelTest(currentDraftModelId)?.taskId || (sourceModel.data?.id === currentDraftModelId ? String(sourceModel.data.test_task_id || '') : '') : '';
  const modelTestTask = useQuery({ queryKey: ['model-workspace-test', testTaskId], queryFn: () => getModelTestTask(testTaskId!), enabled: !!testTaskId && workspace.initialized,
    refetchInterval: query => terminalTask(query.state.data?.status) ? false : 1200 });
  const activeTest = !!testTaskId && !terminalTask(modelTestTask.data?.status);

  useEffect(() => {
    const tracking = () => setTrackingRevision(value => value + 1);
    const backup = (event: Event) => setBackupAvailable(Boolean((event as CustomEvent).detail));
    window.addEventListener('optiforge:model-test', tracking);
    window.addEventListener('optiforge:workspace-backup', backup);
    return () => { window.removeEventListener('optiforge:model-test', tracking); window.removeEventListener('optiforge:workspace-backup', backup); };
  }, []);

  useEffect(() => {
    setMainScrollContainer(document.querySelector<HTMLElement>('.main-content'));
  }, []);

  useEffect(() => {
    if (useModelCreationStore.getState().workspace.sessionId === requestKey && useModelCreationStore.getState().currentDraftModelId) return;
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
    const existing = useModelCreationStore.getState().workspace;
    if (existing.initialized && existing.sessionId === requestKey) {
      initializedKeyRef.current = requestKey;
      setWorkspace({ initialized: true });
      return () => { active = false; };
    }
    initializedKeyRef.current = '';
    setWorkspace({ mode: resolvedMode, generation: crypto.randomUUID(), sourceModelId: request.sourceModelId, templateCode: request.templateCode, initialized: false, dirty: false });

    if (request.legacySource) return () => { active = false; };
    if (systemConfig.isPending) return () => { active = false; };
    const recovery = readWorkspaceRecovery(requestKey);
    if (recovery && (!request.sourceModelId || sourceModel.data)) {
      initializedKeyRef.current = requestKey;
      useModelCreationStore.getState().restoreWorkspace(recovery);
      if (sourceModel.data?.id === recovery.currentDraftModelId) savedAssetRef.current = sourceModel.data;
      return () => { active = false; };
    }
    if (resolvedMode === 'new') {
      const blank = createBlankDraft();
      const requestedScenario = availableScenarios.find(item => item.id === request.scenarioId);
      if (requestedScenario) blank.basic_info = { ...blank.basic_info, scenario_id: requestedScenario.id, scenario: requestedScenario.name };
      initializedKeyRef.current = requestKey;
      initializeWorkspace({ mode: 'new', sessionId: requestKey }, blank);
      return () => { active = false; };
    }
    if (resolvedMode === 'template' && templateDetail.data) {
      const templateScenario = availableScenarios.find(item => item.id === templateDetail.data.scenario_id || item.id === templateDetail.data.scenario || item.name === templateDetail.data.scenario);
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
      const sourceScenarioId = sourceModel.data.scenario_id || next.basic_info.scenario_id;
      const scenario = availableScenarios.find(item => item.id === sourceScenarioId || item.id === next.basic_info.scenario || item.name === next.basic_info.scenario);
      const disabledScenario = scenarioDictionary?.find(item => item.enabled === false && (item.code === sourceScenarioId || item.code === next.basic_info.scenario || item.label === next.basic_info.scenario));
      next.basic_info.scenario_id = scenario?.id || disabledScenario?.code || sourceScenarioId || next.basic_info.scenario || undefined;
      if (scenario) next.basic_info.scenario = scenario.name;
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
        if (currentAssetId) {
          savedAssetRef.current = sourceModel.data;
          useModelCreationStore.setState({ lastSavedSnapshot: JSON.stringify(normalizeModelDraft(next)), lastSavedContentHash: sourceModel.data.content_hash });
          if (sourceModel.data.test_task_id) useModelCreationStore.setState({ testSnapshot: { modelId: sourceModel.data.id, snapshot: JSON.stringify(normalizeModelDraft(next)), contentHash: sourceModel.data.content_hash } });
        }
      }
    }
    return () => { active = false; };
  }, [availableScenarios, initializeWorkspace, request.legacySource, request.scenarioId, request.sourceModelId, request.templateCode, requestKey, resolvedMode, scenarioDictionary, setLoadedTemplate, setWorkspace, sourceModel.data, systemConfig.isPending, templateDetail.data]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!useModelCreationStore.getState().workspace.dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => () => {
    testRequestSequenceRef.current += 1;
    if (issueNavigationTimerRef.current !== undefined) window.clearTimeout(issueNavigationTimerRef.current);
  }, []);

  const saveDraftModel = (requireValid = false, draftOverride?: ReturnType<typeof normalizeModelDraft>): Promise<ModelAsset> => {
    const initial = useModelCreationStore.getState();
    const generation = initial.workspace.generation;
    const submittedDraft = normalizeModelDraft(draftOverride || initial.draft);
    const snapshot = JSON.stringify(submittedDraft);
    if (requireValid && !validateModelDraft(submittedDraft).valid) return Promise.reject(new Error('发布前校验未通过'));
    const inFlight = saveInFlightRef.current;
    if (inFlight && inFlight.generation === generation && inFlight.snapshot === snapshot) return inFlight.promise;
    const save = async () => {
      const state = useModelCreationStore.getState();
      if (state.workspace.generation !== generation) throw new Error('工作区已切换，未提交旧草稿');
      if (state.currentDraftModelId && state.lastSavedSnapshot === snapshot && savedAssetRef.current?.id === state.currentDraftModelId) {
        // Controls can emit the same draft again after a test. A no-op save
        // still has to acknowledge that content, without clearing newer edits
        // when this request carries an older captured draft.
        state.setWorkspace({ dirty: JSON.stringify(normalizeModelDraft(state.draft)) !== snapshot });
        return savedAssetRef.current;
      }
      const createAsset = state.workspace.mode === 'version' && state.workspace.sourceModelId
        ? (payload: Parameters<typeof createModel>[0]) => createModelVersion(state.workspace.sourceModelId!, payload) : createModel;
      const update = async (id: string, payload: Parameters<typeof updateModel>[1]) => {
        if (savedAssetRef.current?.id === id && savedAssetRef.current.status === 'trial' && !savedAssetRef.current.published_at) await returnModelToDraft(id, state.lastSavedContentHash);
        return updateModel(id, { ...payload, expected_content_hash: state.lastSavedContentHash });
      };
      const model = await saveModelDraftAsset(submittedDraft, state.currentDraftModelId, { createModel: createAsset, updateModel: update }, requireValid);
      const current = useModelCreationStore.getState();
      if (current.workspace.generation === generation) {
        const oldSession = current.workspace.sessionId;
        const sessionId = editWorkspaceKey(model.id);
        savedAssetRef.current = model;
        current.setCurrentDraftModelId(model.id);
        useModelCreationStore.setState({ lastSavedSnapshot: snapshot, lastSavedContentHash: model.content_hash });
        current.setWorkspace({ dirty: JSON.stringify(normalizeModelDraft(current.draft)) !== snapshot, mode: 'edit', sourceModelId: model.id, currentAssetId: model.id, sessionId });
        if (oldSession !== sessionId) forgetWorkspaceRecovery(oldSession);
        if (oldSession !== sessionId) nav(`/models/${encodeURIComponent(model.id)}/edit`, { replace: true });
        setLastSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
        setSaveError('');
      }
      return model;
    };
    setSaving(true);
    const promise = (inFlight ? inFlight.promise.catch(() => undefined).then(save) : save()).catch(error => {
      setSaveError(error instanceof Error ? error.message : '草稿保存失败'); throw error;
    }).finally(() => { if (saveInFlightRef.current?.promise === promise) { saveInFlightRef.current = undefined; setSaving(false); } });
    saveInFlightRef.current = { generation, snapshot, promise };
    return promise;
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
      useModelCreationStore.setState({ testSnapshot: { modelId: model.id, snapshot: requestContext.testedSnapshot, contentHash: model.content_hash } });
      const settings = requestContext.draft.advanced.solver_config;
      const testedModel = settings ? await testModel(model.id, requestContext.draft.runtime_parameters, settings) : await testModel(model.id, requestContext.draft.runtime_parameters);
      return {
        sequence: requestContext.sequence,
        modelId: model.id,
        testedSnapshot: requestContext.testedSnapshot,
        model: testedModel,
      };
    },
  });

  const performModelTest = async () => {
    const capturedDraft = normalizeModelDraft(useModelCreationStore.getState().draft);
    const requestContext: ModelTestRequestContext = {
      sequence: ++testRequestSequenceRef.current,
      draft: capturedDraft,
      testedSnapshot: JSON.stringify(capturedDraft),
    };
    try {
      const result = await testRun.mutateAsync(requestContext);
      if (result.sequence !== testRequestSequenceRef.current) return undefined;
      savedAssetRef.current = result.model;
      useModelCreationStore.setState({ lastSavedContentHash: result.model.content_hash });
      setTestedAsset({ id: result.modelId, snapshot: result.testedSnapshot });
      return result.model;
    } catch (error) {
      if (requestContext.sequence !== testRequestSequenceRef.current) return undefined;
      throw error;
    }
  };

  const runModelTest = () => {
    if (testInFlightRef.current) return testInFlightRef.current;
    if (activeTest) return Promise.reject(new Error('已有测试任务运行中，请继续查看同一任务。'));
    const promise = performModelTest().finally(() => { if (testInFlightRef.current === promise) testInFlightRef.current = undefined; });
    testInFlightRef.current = promise;
    return promise;
  };

  autoSaveRef.current = () => saveDraftModel(false);
  useEffect(() => {
    if (saveError || !workspace.initialized || !workspace.dirty || !draft.basic_info.name.trim() || !draft.basic_info.scenario || !draft.basic_info.model_code) return;
    const timer = window.setTimeout(() => { void autoSaveRef.current().catch(() => undefined); }, 2500);
    return () => window.clearTimeout(timer);
  }, [draft, workspace.dirty, workspace.generation, workspace.initialized, saveError]);

  useEffect(() => {
    if (!sourceModel.data || sourceModel.data.id !== currentDraftModelId) return;
    savedAssetRef.current ||= sourceModel.data;
  }, [sourceModel.data, currentDraftModelId]);

  useEffect(() => {
    const task = modelTestTask.data;
    const context = task?.trace?.model_test as Record<string, unknown> | undefined;
    if (task?.status !== 'SUCCESS' || !testSnapshot || testSnapshot.modelId !== currentDraftModelId || context?.model_id !== currentDraftModelId) return;
    let active = true;
    void getModel(currentDraftModelId!).then(model => {
      if (!active) return;
      if (!model.content_hash || model.tested_model_id !== model.id || model.tested_content_hash !== model.content_hash || model.content_hash !== context.tested_content_hash
        || (model.dry_run_result?.solver_check as Record<string, unknown> | undefined)?.status !== 'passed') {
        setTestedAsset(undefined);
        setTestRecoveryError('当前内容与该任务的有效测试证据不一致，请测试当前修订。'); return;
      }
      savedAssetRef.current = model;
      useModelCreationStore.setState({ lastSavedContentHash: model.content_hash });
      setTestedAsset({ id: model.id, snapshot: testSnapshot.snapshot });
      setTestRecoveryError('');
    }).catch(() => { if (active) setTestRecoveryError('测试证据暂未读取成功，请恢复同一任务记录。'); });
    return () => { active = false; };
  }, [currentDraftModelId, modelTestTask.data, modelTestTask.dataUpdatedAt, testSnapshot]);

  useEffect(() => {
    if (!workspace.initialized || restoredSectionRef.current === workspace.generation) return;
    const section = useModelCreationStore.getState().section;
    restoredSectionRef.current = workspace.generation || '';
    if (section && /^[a-z0-9_-]+$/i.test(section)) {
      const timer = window.setTimeout(() => document.querySelector<HTMLElement>(`[data-section-key="${section}"]`)?.scrollIntoView?.({ block: 'start' }), 100);
      return () => window.clearTimeout(timer);
    }
  }, [workspace.initialized, workspace.generation, step]);

  const confirmSourceSwitch = () => new Promise<boolean>(resolve => {
    if (!useModelCreationStore.getState().workspace.dirty) {
      resolve(true);
      return;
    }
    sourceLeaveResolver.current = resolve;
    setSourceLeaveOpen(true);
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
    const mode = workspace.mode === 'template' && !workspace.templateCode ? 'template' : 'new';
    initializeWorkspace({ mode, sessionId: requestKey }, next);
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

  const ownsCurrentDraft = workspace.initialized && workspace.sessionId === requestKey && currentDraftModelId === request.sourceModelId;
  const waitingForData = request.legacySource
    || systemConfig.isPending
    || (!!request.sourceModelId && sourceModel.isPending && !ownsCurrentDraft)
    || (resolvedMode === 'template' && !!request.templateCode && templateDetail.isPending)
    || (initializedKeyRef.current !== requestKey && !ownsCurrentDraft)
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
      onChange={setDraft}
      pending={testRun.isPending || activeTest}
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
      {dataRouter && <DraftLeaveGuard onSave={() => saveDraftModel(false)} />}
      {sourceLeaveOpen && <DraftLeaveDialog open onSave={() => saveDraftModel(false)} onContinue={() => { setSourceLeaveOpen(false); sourceLeaveResolver.current?.(false); }} onLeave={() => { setSourceLeaveOpen(false); sourceLeaveResolver.current?.(true); }} onDiscard={() => { reset(); setSourceLeaveOpen(false); sourceLeaveResolver.current?.(true); }} />}
      <PageHeader
        title={workspaceTitles[resolvedMode]}
        description={resolvedMode === 'version' ? '创建同一模型族的新草稿并继承选定版本；原试运行、已发布或已下线版本不会被直接覆盖。' : '当前地址定位本草稿；自动保存更新同一资产，未成功提交的内容保留本机恢复副本。'}
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

      {!backupAvailable && <Alert type="warning" showIcon title="本机恢复存储不可用，请保持页面打开并手动保存草稿" />}
      {saveError && <Alert type="error" showIcon title="草稿尚未保存到服务端" description={saveError} action={<Button onClick={() => saveDraft.mutate()}>重试保存</Button>} />}
      {testTaskId && <div className="section-gap"><Typography.Paragraph>模型测试任务：{testTaskId} · {modelTestTask.data?.status || '读取中'} · {modelTestTask.data?.progress || 0}%</Typography.Paragraph>
        {(modelTestTask.error || testRecoveryError) && <Alert type="warning" showIcon title={testRecoveryError || '测试任务暂未更新，本机记录已保留'} action={<Button onClick={() => void modelTestTask.refetch()}>恢复测试记录</Button>} />}
        {modelTestTask.data?.error && <Alert type="error" title={modelTestTask.data.error} />}
      </div>}
      <ModelBuildSummaryBar draft={draft} validation={validation} blocker={firstBlocker} visibleSectionKeys={visibleSectionKeys} dirty={workspace.dirty} currentStepTitle={stepMeta[step].title} onInspection={() => setInspectionOpen(true)} />
      <ModelCreationProgress currentStep={step} visitedThrough={visibleStepLimit} steps={stepMeta} validation={validation} onChange={enterStep} />
      <StepBody
        title={stepMeta[step].title}
        description={stepMeta[step].description}
      >
        <StepSectionNav items={stepSections[step]} containerId="model-step-content" scrollContainer={mainScrollContainer} resetKey={step} onActiveChange={handleSectionChange} onFocus={step >= 1 && step <= 3 ? openFocusEditor : undefined} />
        <div id="model-step-content">{focusOpen ? <div className="focus-editor-placeholder">当前步骤已在聚焦编辑模式中打开。</div> : pages[step]}</div>
      </StepBody>

      <ActionFooter left={<div className="model-footer-left"><Space wrap><Button disabled={step === 0} onClick={() => setStep(step - 1)}>上一步</Button><Button type="primary" disabled={step === 4} onClick={() => enterStep(step + 1)}>下一步</Button></Space><span className="model-footer-status">{saving || saveDraft.isPending ? '保存中' : saveError ? '服务端保存失败' : workspace.dirty ? '待自动保存' : lastSavedAt ? `已保存于 ${lastSavedAt}` : '已保存'}{backupAvailable && (workspace.dirty || lastSavedSnapshot) ? ' · 本机恢复副本已保留' : ''} · {validation.valid ? '无阻断项' : `${Object.values(validation.sections).flatMap(section => section.errors).length} 项阻断`} · {testIsCurrent ? '最近测试通过' : '当前版本待测试'}</span></div>}>
        <Button onClick={validateCurrentDraft}>校验模型</Button>
        <Button loading={saveDraft.isPending} onClick={() => saveDraft.mutate()}>保存草稿</Button>
        <Button type={step === 4 || validation.valid ? 'primary' : 'default'} disabled={!validation.valid || !testIsCurrent || testRun.isPending || activeTest} loading={publish.isPending} title={!testIsCurrent ? '请先保存并测试当前修订' : undefined} onClick={() => publish.mutate()}>发布模型</Button>
      </ActionFooter>
      {inspectionOpen && <ModelInspectionDrawer open draft={draft} workspace={workspace} validation={validation} steps={stepMeta} tested={testIsCurrent} onClose={() => setInspectionOpen(false)} onNavigate={navigateIssue} />}
      {focusOpen && <FocusEditor open modelName={draft.basic_info.name} objectName={stepMeta[step].title} dirty={focusDirty} onClose={() => closeFocusEditor()} onDiscard={() => closeFocusEditor(true)} onSave={async () => { await saveDraft.mutateAsync(); }} onValidate={validateCurrentDraft}>{pages[step]}</FocusEditor>}
    </PageShell>
  );
}
