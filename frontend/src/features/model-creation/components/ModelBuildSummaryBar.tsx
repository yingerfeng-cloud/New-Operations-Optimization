import { Progress, Space, Tag, Tooltip } from 'antd';
import { ApartmentOutlined, BlockOutlined, DatabaseOutlined, DeploymentUnitOutlined, ExperimentOutlined, WarningOutlined } from '@ant-design/icons';
import type { ModelDraft } from '../stores/modelCreationStore';
import type { DraftValidation } from '../utils/validateModelDraft';
import type { StepBlocker } from '../utils/workflowGuard';
import { getComponentBindingRows, isBindingComplete } from '../utils/bindingValidation';

function bindingProgress(draft: ModelDraft) {
  const bindings = draft.components.flatMap(component => getComponentBindingRows(component).map(row => row.binding));
  const total = bindings.length;
  const bound = bindings.filter(isBindingComplete).length;
  return { bound, total };
}

function problemType(draft: ModelDraft) {
  if (draft.basic_info.builder_mode === 'component_based') return 'MILP';
  const variableTypes = draft.semantic.variables.map(variable => variable.variableType || variable.domain);
  return variableTypes.some(type => type === 'binary' || type === 'integer' || type === 'Binary' || type === 'Integers') ? 'MILP' : 'LP';
}

export function ModelBuildSummaryBar({
  draft,
  validation,
  blocker,
}: {
  draft: ModelDraft;
  validation: DraftValidation;
  blocker?: StepBlocker | null;
}) {
  const bindings = bindingProgress(draft);
  const totalChecks = Object.keys(validation.sections).length;
  const passedChecks = Object.values(validation.sections).filter(section => section.valid).length;
  const invalidCount = Object.values(validation.sections).flatMap(section => section.errors || []).length;
  const bindingPercent = bindings.total ? Math.round((bindings.bound / bindings.total) * 100) : 100;

  return (
    <section className="model-build-summary" aria-label="当前建模状态摘要">
      <Space className="model-build-summary-tags" size={8} wrap>
        <Tag icon={<DatabaseOutlined />} color="blue">{draft.basic_info.scenario || '未选择场景'}</Tag>
        <Tag icon={<BlockOutlined />} color="geekblue">{draft.basic_info.builder_mode === 'component_based' ? '组件化 Builder' : '通用线性 Builder'}</Tag>
        <Tag icon={<ExperimentOutlined />} color="purple">{problemType(draft)}</Tag>
        <Tag icon={<DeploymentUnitOutlined />} color={draft.components.length ? 'cyan' : 'default'}>{draft.components.length} 个组件</Tag>
        <Tooltip title="组件参数已绑定数量 / 组件参数总数">
          <Tag icon={<ApartmentOutlined />} color={bindingPercent === 100 ? 'green' : 'orange'}>参数绑定 {bindings.bound}/{bindings.total}</Tag>
        </Tooltip>
        <Tag icon={invalidCount ? <WarningOutlined /> : undefined} color={invalidCount ? 'orange' : 'green'}>{invalidCount ? `待修复 ${invalidCount} 项` : '校验通过'}</Tag>
      </Space>
      {blocker && (
        <Tooltip title={blocker.error}>
          <div className="model-summary-blocker" role="status">
            <WarningOutlined />
            <span>阻断项：第 {blocker.stepIndex + 1} 步 {blocker.stepTitle} - {blocker.error}</span>
          </div>
        </Tooltip>
      )}
      <div className="model-build-summary-progress">
        <span>校验完整度</span>
        <Progress size="small" percent={Math.round((passedChecks / Math.max(totalChecks, 1)) * 100)} status={invalidCount ? 'active' : 'success'} />
      </div>
    </section>
  );
}
