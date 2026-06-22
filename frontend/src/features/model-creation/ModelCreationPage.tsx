import { Button, Card, Space, Steps, message } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createModel, publishModel, testModel } from '../../api/models';
import { getTemplateDetail, getTemplates } from '../../api/templates';
import { PageHeader } from '../../components/PageHeader';
import { useModelCreationStore, type ModelDraft } from './stores/modelCreationStore';
import { normalizeModelDraft } from './utils/normalizeModelDraft';
import { validateModelDraft } from './utils/validateModelDraft';
import { Step1BasicInfo } from './steps/Step1BasicInfo';
import { Step2SemanticModel } from './steps/Step2SemanticModel';
import { Step3MathExpansion } from './steps/Step3MathExpansion';
import { Step4RuntimeParams } from './steps/Step4RuntimeParams';
import { Step5ReviewPublish } from './steps/Step5ReviewPublish';

export function ModelCreationPage() {
  const nav = useNavigate();
  const { draft, step, setStep, setDraft, reset } = useModelCreationStore();
  const templates = useQuery({ queryKey: ['templates'], queryFn: getTemplates });
  const create = useMutation({
    mutationFn: async (mode: 'publish' | 'test') => {
      const normalized = normalizeModelDraft(draft);
      if (!validateModelDraft(normalized).valid) throw new Error('发布前校验未通过');
      const model = await createModel({ name: normalized.basic_info.name, scene: normalized.basic_info.scenario, template_id: normalized.basic_info.model_code, build_mode: normalized.basic_info.builder_mode, solver: normalized.basic_info.solver, model_draft: normalized as unknown as Record<string, unknown>, semantic_spec: normalized.semantic, generic_spec: normalized.advanced.generic_spec || {}, component_spec: normalized.advanced.component_spec || { components: normalized.components }, parameters: normalized.runtime_parameters, model_problem_type: 'LP' });
      return mode === 'publish' ? publishModel(model.id) : testModel(model.id, normalized.runtime_parameters);
    },
    onSuccess: model => { message.success('模型流程执行成功'); reset(); nav(`/models/${model.id}`); },
  });
  const loadTemplate = async (code: string) => {
    const template = await getTemplateDetail(code);
    const source = (template.model_draft || {}) as Partial<ModelDraft>;
    setDraft(normalizeModelDraft({ ...draft, ...source, basic_info: { ...draft.basic_info, name: template.name, model_code: template.code, scenario: template.scenario, builder_mode: (template.build_mode as ModelDraft['basic_info']['builder_mode']) || draft.basic_info.builder_mode, template_code: code }, semantic: { ...draft.semantic, ...(source.semantic || {}) } }));
    message.success('模板已初始化到 ModelDraft');
  };
  const normalized = normalizeModelDraft(draft);
  const validation = validateModelDraft(normalized);
  const pages = [<Step1BasicInfo draft={draft} templates={templates.data || []} onChange={setDraft} onTemplate={loadTemplate}/>, <Step2SemanticModel draft={draft} onChange={setDraft}/>, <Step3MathExpansion draft={draft} onChange={setDraft}/>, <Step4RuntimeParams draft={draft} onChange={setDraft}/>, <Step5ReviewPublish draft={normalized} validation={validation} onPublish={() => create.mutate('publish')} onTest={() => create.mutate('test')} pending={create.isPending}/>];
  return <><PageHeader title="模型创建" description="选择模板 → 编辑语义 → 维护公式/组件 → 参数校验 → 发布测试" extra={<Button danger onClick={reset}>清空草稿</Button>}/><Card><Steps current={step} items={['基础信息', '模型语义', '数学展开', '运行参数', '校验发布'].map(title => ({ title }))}/><div style={{ marginTop: 28, minHeight: 420 }}>{pages[step]}</div><Space style={{ marginTop: 24 }}><Button disabled={step === 0} onClick={() => setStep(step - 1)}>上一步</Button><Button type="primary" disabled={step === 4} onClick={() => setStep(step + 1)}>下一步</Button></Space></Card></>;
}
