import { Button, Space, Tag, message } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createModel, publishModel, testModel, updateModel } from '../../api/models';
import { getTemplateDetail, getTemplates } from '../../api/templates';
import { PageHeader } from '../../components/PageHeader';
import { ActionFooter, ModelCreationLayout, PageShell, StepBody, StepNavigator } from '../../components/LayoutPrimitives';
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

const stepMeta = [
  { title: '基础信息', description: '场景、编码、建模模式' },
  { title: '模型语义', description: '集合、参数、变量、组件清单' },
  { title: '数学展开', description: '统一公式与 Builder 编译' },
  { title: '运行参数', description: '运行时输入和参数预览' },
  { title: '校验发布', description: 'dry-run、发布和测试运行' },
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
    <Step5ReviewPublish draft={normalized} validation={validation} onPublish={() => publish.mutateAsync()} onTest={() => testRun.mutateAsync()} pending={publish.isPending || testRun.isPending} />,
  ];

  const validateCurrentDraft = () => {
    setValidationResult(validation);
    const firstError = Object.values(validation.sections).flatMap(section => section.errors)[0];
    if (validation.valid) message.success('模型校验通过');
    else message.error(firstError || '模型校验未通过');
  };

  return (
    <PageShell className="model-creation-page">
      <PageHeader
        title="模型创建"
        description="基于业务场景选择、模型语义、统一公式、运行参数和发布校验的五步建模流程。"
        tags={<Tag color="blue">{draft.basic_info.builder_mode === 'component_based' ? '组件化 Builder' : '通用线性 Builder'}</Tag>}
        status={<Tag color={validation.valid ? 'green' : 'orange'}>{validation.valid ? '可发布' : '待校验'}</Tag>}
        extra={<Button danger onClick={reset}>清空草稿</Button>}
      />

      <ModelCreationLayout>
        <StepNavigator
          current={step}
          onChange={setStep}
          items={stepMeta.map((item, index) => ({
            title: item.title,
            description: index === step ? `${item.description} · ${validation.sections[Object.keys(validation.sections)[index] || 'semantic']?.valid === false ? '待修复' : '已检查'}` : item.description,
          }))}
        />
        <StepBody title={stepMeta[step].title} description={stepMeta[step].description}>
          {pages[step]}
        </StepBody>
      </ModelCreationLayout>

      <ActionFooter left={<Space wrap><Button disabled={step === 0} onClick={() => setStep(step - 1)}>上一步</Button><Button type="primary" disabled={step === 4} onClick={() => setStep(step + 1)}>下一步</Button></Space>}>
        <Button onClick={validateCurrentDraft}>校验模型</Button>
        <Button disabled title="当前模型包由发布流程自动生成">生成模型包</Button>
        <Button loading={saveDraft.isPending} onClick={() => saveDraft.mutate()}>保存草稿</Button>
        <Button type={step === 4 || validation.valid ? 'primary' : 'default'} disabled={!validation.valid} loading={publish.isPending} onClick={() => publish.mutate()}>发布模型</Button>
      </ActionFooter>
    </PageShell>
  );
}
