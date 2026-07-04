import { Button, Dropdown, Modal, Space, message } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createModel, publishModel, testModel, updateModel } from '../../api/models';
import { getTemplateDetail, getTemplates } from '../../api/templates';
import { PageHeader } from '../../components/PageHeader';
import { ActionFooter, PageShell, StepBody } from '../../components/LayoutPrimitives';
import { useModelCreationStore, type ModelDraft } from './stores/modelCreationStore';
import { getScenarioById } from './data/scenarioCatalog';
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

const stepMeta: ModelCreationStepMeta[] = [
  { title: '基础信息', description: '选择业务场景、模型编码、建模模式和求解器。', sectionKeys: ['basic_info'] },
  { title: '模型语义', description: '维护集合、参数、变量、业务规则和组件依赖关系。', sectionKeys: ['semantic_structure', 'component_dependencies', 'parameter_bindings'] },
  { title: '数学展开', description: '将业务语义展开为目标函数、约束条件和可编译公式。', sectionKeys: ['formula', 'problem_type'] },
  { title: '运行参数', description: '配置运行时输入、组件参数和函数资产绑定。', sectionKeys: ['runtime_parameters'] },
  { title: '校验发布', description: '完成 dry-run、兼容性检查、测试运行和模型发布。', sectionKeys: ['solver_compatibility'] },
];

export function ModelCreationPage() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const appliedQueryRef = useRef('');
  const {
    draft,
    step,
    selectedScenarioId,
    selectedModelId,
    setStep,
    setDraft,
    selectCatalogModel,
    setLoadedTemplate,
    setValidationResult,
    reset,
  } = useModelCreationStore();
  const templates = useQuery({ queryKey: ['templates'], queryFn: getTemplates });

  useEffect(() => {
    const queryKey = searchParams.toString();
    if (!queryKey || appliedQueryRef.current === queryKey) {
      return;
    }
    const scenarioId = searchParams.get('scenarioId');
    const modelId = searchParams.get('modelId') || undefined;
    if (scenarioId) {
      appliedQueryRef.current = queryKey;
      const { selectedScenarioId: currentScenarioId, selectedModelId: currentModelId } = useModelCreationStore.getState();
      if (scenarioId !== currentScenarioId || (modelId && modelId !== currentModelId)) {
        selectCatalogModel(scenarioId, modelId);
      }
    }
  }, [searchParams, selectCatalogModel]);

  const saveDraftModel = async (requireValid = false) => {
    const state = useModelCreationStore.getState();
    const model = await saveModelDraftAsset(state.draft, state.currentDraftModelId, { createModel, updateModel }, requireValid);
    state.setCurrentDraftModelId(model.id);
    return model;
  };
  const saveDraft = useMutation({ mutationFn: () => saveDraftModel(false), onSuccess: () => message.success('草稿已保存') });
  const publish = useMutation({
    mutationFn: async () => {
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
    onSuccess: () => message.success('模型测试运行完成'),
  });

  const loadTemplate = async (code: string) => {
    const template = await getTemplateDetail(code);
    setDraft(applyTemplateToDraft(draft, template, getScenarioById(selectedScenarioId)?.name || draft.basic_info.scenario));
    setLoadedTemplate(template);
    message.success('模板已初始化到 ModelDraft');
  };

  const normalized = normalizeModelDraft(draft);
  const validation = validateModelDraft(normalized);
  const firstBlocker = stepMeta.map((item, index) => firstStepError(validation, item, index)).find(Boolean);
  const enterStep = (targetStep: number) => {
    const guard = canEnterStep({ targetStep, currentStep: step, steps: stepMeta, validation });
    if (!guard.allowed) {
      message.warning(blockerMessage(guard.blocker));
      return;
    }
    setStep(targetStep);
  };
  const pages = [
    <Step1BasicInfo
      draft={draft}
      templates={templates.data || []}
      selectedScenarioId={selectedScenarioId}
      selectedModelId={selectedModelId}
      onChange={setDraft}
      onCatalogSelection={selectCatalogModel}
      onTemplate={loadTemplate}
    />,
    <Step2SemanticModel draft={draft} onChange={setDraft} />,
    <Step3MathExpansion draft={draft} onChange={setDraft} />,
    <Step4RuntimeParams draft={draft} onChange={setDraft} />,
    <Step5ReviewPublish draft={normalized} validation={validation} onPublish={() => publish.mutateAsync()} onTest={() => testRun.mutateAsync()} pending={publish.isPending || testRun.isPending} onFixStep={setStep} />,
  ];

  const validateCurrentDraft = () => {
    setValidationResult(validation);
    const firstError = Object.values(validation.sections).flatMap(section => section.errors)[0];
    if (validation.valid) message.success('模型校验通过');
    else message.error(firstError || '模型校验未通过');
  };

  const confirmReset = () => {
    Modal.confirm({
      title: '确认清空当前草稿？',
      content: '清空后会恢复为空白建模草稿，当前页面未保存的配置将被移除。',
      okText: '清空草稿',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: reset,
    });
  };

  return (
    <PageShell className="model-creation-page">
      <PageHeader
        title="模型创建"
        description="基于业务场景选择、模型语义、统一公式、运行参数和发布校验的五步建模流程。"
        extra={(
          <Space wrap>
            <Button loading={saveDraft.isPending} onClick={() => saveDraft.mutate()}>保存草稿</Button>
            <Button onClick={validateCurrentDraft}>校验模型</Button>
            <Button type="primary" disabled={!validation.valid} loading={publish.isPending} onClick={() => publish.mutate()}>发布模型</Button>
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

      <ModelBuildSummaryBar draft={draft} validation={validation} blocker={firstBlocker} />
      <ModelCreationProgress currentStep={step} steps={stepMeta} validation={validation} onChange={enterStep} />
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
