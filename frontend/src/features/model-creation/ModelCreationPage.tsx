import { Button, Dropdown, Modal, Space, message } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createModel, getModel, publishModel, testModel, updateModel } from '../../api/models';
import { getSystemConfig } from '../../api/systemConfig';
import { getTemplateDetail, getTemplates } from '../../api/templates';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, PageLoading } from '../../components/PageStates';
import { ActionFooter, PageShell, StepBody } from '../../components/LayoutPrimitives';
import { createBlankDraft, useModelCreationStore } from './stores/modelCreationStore';
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
import { blockerMessage, canEnterStep, firstStepError } from './utils/workflowGuard';
import { assetToWorkspaceDraft, effectiveAssetMode, parseWorkspaceRequest, workspaceTitles } from './utils/workspaceMode';

const stepMeta: ModelCreationStepMeta[] = [
  { title: '基础信息', description: '选择业务场景、模型编码、建模模式和求解器。', sectionKeys: ['basic_info'] },
  { title: '模型语义', description: '维护集合、参数、变量、业务规则和组件依赖关系。', sectionKeys: ['semantic_structure', 'component_dependencies', 'parameter_bindings'] },
  { title: '数学展开', description: '将业务语义展开为目标函数、约束条件和可编译公式。', sectionKeys: ['formula', 'problem_type'] },
  { title: '运行参数', description: '配置运行时输入、组件参数和函数资产绑定。', sectionKeys: ['runtime_parameters'] },
  { title: '校验发布', description: '完成 dry-run、兼容性检查、测试运行和模型发布。', sectionKeys: ['solver_compatibility'] },
];

export function ModelCreationPage() {
  const [modal, modalContextHolder] = Modal.useModal();
  const nav = useNavigate();
  const { id: routeModelId } = useParams();
  const [searchParams] = useSearchParams();
  const initializedKeyRef = useRef('');
  const [visitedThrough, setVisitedThrough] = useState(0);
  const [showAllValidation, setShowAllValidation] = useState(false);
  const testedAssetRef = useRef<{ id: string; snapshot: string } | undefined>(undefined);
  const {
    draft,
    step,
    workspace,
    setStep,
    setDraft,
    initializeWorkspace,
    setWorkspace,
    setCurrentDraftModelId,
    setLoadedTemplate,
    setValidationResult,
    reset,
  } = useModelCreationStore();
  const templates = useQuery({ queryKey: ['templates'], queryFn: getTemplates });
  const systemConfig = useQuery({ queryKey: ['system-config'], queryFn: getSystemConfig, retry: false });
  const scenarioDictionary = systemConfig.data?.dictionaries?.business_scenarios;
  const configuredScenarios = useMemo(() => scenariosFromDictionary(scenarioDictionary), [scenarioDictionary]);
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
    setVisitedThrough(0);
    setShowAllValidation(false);
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
    if (resolvedMode === 'new') {
      const blank = createBlankDraft();
      initializedKeyRef.current = requestKey;
      initializeWorkspace({ mode: 'new', sessionId: requestKey }, blank);
      return () => { active = false; };
    }
    if (resolvedMode === 'template' && templateDetail.data) {
      const templateScenario = configuredScenarios.find(item => item.id === templateDetail.data.scenario || item.name === templateDetail.data.scenario)
        || scenarioCatalog.find(item => item.id === templateDetail.data.scenario || item.name === templateDetail.data.scenario);
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
    if (request.sourceModelId && sourceModel.data) {
      const next = assetToWorkspaceDraft(sourceModel.data, resolvedMode);
      const scenario = configuredScenarios.find(item => item.id === next.basic_info.scenario || item.name === next.basic_info.scenario)
        || scenarioCatalog.find(item => item.id === next.basic_info.scenario || item.name === next.basic_info.scenario);
      next.basic_info.scenario_id = scenario?.id;
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
  }, [configuredScenarios, initializeWorkspace, request.legacySource, request.sourceModelId, request.templateCode, requestKey, resolvedMode, setLoadedTemplate, setWorkspace, sourceModel.data, templateDetail.data]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!useModelCreationStore.getState().workspace.dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const saveDraftModel = async (requireValid = false) => {
    const state = useModelCreationStore.getState();
    const model = await saveModelDraftAsset(state.draft, state.currentDraftModelId, { createModel, updateModel }, requireValid);
    state.setCurrentDraftModelId(model.id);
    return model;
  };
  const saveDraft = useMutation({ mutationFn: () => saveDraftModel(false), onSuccess: () => message.success('草稿已保存') });
  const publish = useMutation({
    mutationFn: async () => {
      const state = useModelCreationStore.getState();
      const snapshot = JSON.stringify(normalizeModelDraft(state.draft));
      if (state.currentDraftModelId && testedAssetRef.current?.id === state.currentDraftModelId) {
        if (testedAssetRef.current.snapshot === snapshot) return publishModel(state.currentDraftModelId);
        const copied = await saveModelDraftAsset(state.draft, undefined, { createModel, updateModel }, true);
        state.setCurrentDraftModelId(copied.id);
        return publishModel(copied.id);
      }
      const model = await saveDraftModel(true);
      return publishModel(model.id);
    },
    onSuccess: model => {
      message.success('模型流程执行成功');
      reset();
      nav(`/models/${model.id}`);
    },
  });
  const testRun = useMutation({
    mutationFn: async () => {
      const model = await saveDraftModel(true);
      return testModel(model.id, normalizeModelDraft(draft).runtime_parameters);
    },
    onSuccess: model => {
      testedAssetRef.current = { id: model.id, snapshot: JSON.stringify(normalizeModelDraft(useModelCreationStore.getState().draft)) };
      message.success('模型测试运行完成');
    },
  });

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
    const scenario = configuredScenarios.find(item => item.id === scenarioId) || scenarioCatalog.find(item => item.id === scenarioId);
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
      nav('/models/create?mode=new');
      return;
    }
    nav(`/models/create?mode=template&template=${encodeURIComponent(code)}`);
  };

  const missingSource = (resolvedMode === 'edit' || resolvedMode === 'clone' || resolvedMode === 'version') && !request.sourceModelId;
  const missingTemplate = resolvedMode === 'template' && !request.templateCode;
  const loadError = sourceModel.error || templateDetail.error;
  if (missingSource || missingTemplate || loadError) {
    return (
      <PageShell className="model-creation-page">
        <ErrorState
          title={sourceModel.error ? '目标模型加载失败' : templateDetail.error ? '模型模板加载失败' : '工作台地址不完整'}
          description={missingSource ? '当前模式缺少来源模型 ID。' : missingTemplate ? '模板创建模式缺少模板编码。' : '目标数据未能加载，旧草稿不会继续显示。'}
          retry={loadError ? () => void (sourceModel.error ? sourceModel.refetch() : templateDetail.refetch()) : undefined}
          actions={[{ label: '返回模型资产', onClick: () => nav('/models') }]}
        />
      </PageShell>
    );
  }

  const waitingForData = request.legacySource
    || (!!request.sourceModelId && sourceModel.isPending)
    || (resolvedMode === 'template' && templateDetail.isPending)
    || initializedKeyRef.current !== requestKey
    || !workspace.initialized;
  if (waitingForData) {
    return <PageLoading label={resolvedMode === 'template' ? '正在加载完整模型模板…' : request.sourceModelId ? '正在加载目标模型资产…' : '正在初始化空白工作台…'} />;
  }

  const normalized = normalizeModelDraft(draft);
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
  const pages = [
    <Step1BasicInfo
      draft={draft}
      workspace={workspace}
      sourceAsset={sourceModel.data}
      templates={templates.data || []}
      scenarios={configuredScenarios}
      onChange={setDraft}
      onScenario={handleScenarioSelection}
      onTemplate={handleTemplateSelection}
    />,
    <Step2SemanticModel draft={draft} onChange={setDraft} />,
    <Step3MathExpansion draft={draft} onChange={setDraft} />,
    <Step4RuntimeParams draft={draft} onChange={setDraft} />,
    <Step5ReviewPublish draft={normalized} validation={validation} onPublish={() => publish.mutateAsync()} onTest={() => testRun.mutateAsync()} pending={publish.isPending || testRun.isPending} onFixStep={setStep} />,
  ];

  const validateCurrentDraft = () => {
    setShowAllValidation(true);
    setVisitedThrough(stepMeta.length - 1);
    setValidationResult(validation);
    const firstError = Object.values(validation.sections).flatMap(section => section.errors)[0];
    if (validation.valid) message.success('模型校验通过');
    else message.error(firstError || '模型校验未通过');
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

      <ModelBuildSummaryBar draft={draft} validation={validation} blocker={firstBlocker} visibleSectionKeys={visibleSectionKeys} />
      <ModelCreationProgress currentStep={step} visitedThrough={visibleStepLimit} steps={stepMeta} validation={validation} onChange={enterStep} />
      <StepBody
        title={stepMeta[step].title}
        description={stepMeta[step].description}
      >
        {pages[step]}
      </StepBody>

      <ActionFooter left={<Space wrap><Button disabled={step === 0} onClick={() => setStep(step - 1)}>上一步</Button><Button type="primary" disabled={step === 4} onClick={() => enterStep(step + 1)}>下一步</Button></Space>}>
        <Button onClick={validateCurrentDraft}>校验模型</Button>
        <Button loading={saveDraft.isPending} onClick={() => saveDraft.mutate()}>保存草稿</Button>
        <Button type={step === 4 || validation.valid ? 'primary' : 'default'} disabled={!validation.valid} loading={publish.isPending} onClick={() => publish.mutate()}>发布模型</Button>
      </ActionFooter>
    </PageShell>
  );
}
