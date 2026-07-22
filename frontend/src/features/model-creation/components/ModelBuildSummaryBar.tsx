import { Button, Progress, Tag, Tooltip } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import type { ModelDraft } from '../stores/modelCreationStore';
import type { DraftValidation } from '../utils/validateModelDraft';
import type { StepBlocker } from '../utils/workflowGuard';
import { getComponentBindingRows, isBindingComplete } from '../utils/bindingValidation';
import { inferModelProblemType } from '../utils/inferModelProblemType';

function bindingProgress(draft: ModelDraft) { const bindings = draft.components.flatMap(component => getComponentBindingRows(component).map(row => row.binding)); return { bound: bindings.filter(isBindingComplete).length, total: bindings.length }; }
function buildModeLabel(draft: ModelDraft) { if (draft.basic_info.builder_mode === 'component_based') return '组件化 Builder'; if (draft.basic_info.builder_mode === 'template_based') return '模板 Builder'; if (draft.basic_info.builder_mode === 'domain_builder') return '领域 Builder'; return '通用线性 Builder'; }

export function ModelBuildSummaryBar({ draft, validation, blocker, visibleSectionKeys, dirty = true, currentStepTitle = '基础信息', onInspection }: {
  draft: ModelDraft; validation: DraftValidation; blocker?: StepBlocker | null; visibleSectionKeys?: string[]; dirty?: boolean; currentStepTitle?: string; onInspection?: () => void;
}) {
  const bindings = bindingProgress(draft); const visibleSections = Object.entries(validation.sections).filter(([key]) => !visibleSectionKeys || visibleSectionKeys.includes(key));
  const invalidCount = visibleSections.flatMap(([, section]) => section.errors || []).length; const passed = visibleSections.filter(([, section]) => section.valid).length;
  return <section className="model-build-summary" aria-label="当前建模状态摘要">
    <div className="model-build-primary-status"><span className={dirty ? 'status-unsaved' : 'status-saved'}>{dirty ? '未保存' : '已保存'}</span><strong>{invalidCount ? `${currentStepTitle}存在 ${invalidCount} 项问题` : `${currentStepTitle}校验通过`}</strong><span>参数绑定 {bindings.bound}/{bindings.total}</span>{onInspection && <Button onClick={onInspection}>模型检查</Button>}</div>
    {blocker && <Tooltip title={blocker.error}><div className="model-summary-blocker" role="status"><WarningOutlined /><span>阻断项：第 {blocker.stepIndex + 1} 步 {blocker.stepTitle} - {blocker.error}</span></div></Tooltip>}
    <div className="model-build-summary-progress"><span>校验完整度</span><Progress size="small" percent={Math.round(passed / Math.max(visibleSections.length, 1) * 100)} showInfo={false} status={invalidCount ? 'exception' : 'success'} /></div>
    <details className="model-build-technical"><summary>技术摘要</summary><div><Tag>{draft.basic_info.scenario || '未选择场景'}</Tag><Tag>{buildModeLabel(draft)}</Tag><Tag>{inferModelProblemType(draft)}</Tag><Tag>{draft.components.length} 个组件</Tag></div></details>
  </section>;
}
