import { Popover, Progress, Space, Tag, Tooltip } from 'antd';
import { ApartmentOutlined, BlockOutlined, DatabaseOutlined, DeploymentUnitOutlined, ExperimentOutlined, WarningOutlined } from '@ant-design/icons';
import type { ModelDraft } from '../stores/modelCreationStore';
import type { DraftValidation } from '../utils/validateModelDraft';
import type { StepBlocker } from '../utils/workflowGuard';
import { getComponentBindingRows, isBindingComplete } from '../utils/bindingValidation';
import { inferModelProblemType } from '../utils/inferModelProblemType';

function bindingProgress(draft: ModelDraft) {
  const bindings = draft.components.flatMap(component => getComponentBindingRows(component).map(row => row.binding));
  const total = bindings.length;
  const bound = bindings.filter(isBindingComplete).length;
  return { bound, total };
}

function buildModeLabel(draft: ModelDraft) {
  if (draft.basic_info.builder_mode === 'component_based') return '组件化 Builder';
  if (draft.basic_info.builder_mode === 'template_based') return '模板 Builder';
  if (draft.basic_info.builder_mode === 'domain_builder') return '领域 Builder';
  return '通用线性 Builder';
}

const sectionLabels: Record<string, string> = {
  basic_info: '基础信息',
  semantic_structure: '模型语义',
  component_dependencies: '组件依赖',
  parameter_bindings: '参数绑定',
  formula: '数学公式',
  runtime_parameters: '运行参数',
  problem_type: '问题类型',
  solver_compatibility: '求解器兼容性',
};

export function ModelBuildSummaryBar({
  draft,
  validation,
  blocker,
  visibleSectionKeys,
}: {
  draft: ModelDraft;
  validation: DraftValidation;
  blocker?: StepBlocker | null;
  visibleSectionKeys?: string[];
}) {
  const bindings = bindingProgress(draft);
  const visibleSections = Object.entries(validation.sections).filter(([sectionKey]) => !visibleSectionKeys || visibleSectionKeys.includes(sectionKey));
  const totalChecks = visibleSections.length;
  const passedChecks = visibleSections.filter(([, section]) => section.valid).length;
  const validationIssues = visibleSections.flatMap(([sectionKey, section]) => (section.errors || []).map(error => ({
    section: sectionLabels[sectionKey] || sectionKey,
    error,
  })));
  const invalidCount = validationIssues.length;
  const bindingPercent = bindings.total ? Math.round((bindings.bound / bindings.total) * 100) : 100;
  const repairTag = (
    <Tag icon={invalidCount ? <WarningOutlined /> : undefined} color={invalidCount ? 'orange' : 'green'}>
      {invalidCount ? `待修复 ${invalidCount} 项` : '校验通过'}
    </Tag>
  );

  return (
    <section className="model-build-summary" aria-label="当前建模状态摘要">
      <Space className="model-build-summary-tags" size={8} wrap>
        <Tag icon={<DatabaseOutlined />} color="blue">{draft.basic_info.scenario || '未选择场景'}</Tag>
        <Tag icon={<BlockOutlined />} color="geekblue">{buildModeLabel(draft)}</Tag>
        <Tag icon={<ExperimentOutlined />} color="purple">{inferModelProblemType(draft)}</Tag>
        <Tag icon={<DeploymentUnitOutlined />} color={draft.components.length ? 'cyan' : 'default'}>{draft.components.length} 个组件</Tag>
        <Tooltip title="组件参数已绑定数量 / 组件参数总数">
          <Tag icon={<ApartmentOutlined />} color={bindingPercent === 100 ? 'green' : 'orange'}>参数绑定 {bindings.bound}/{bindings.total}</Tag>
        </Tooltip>
        {invalidCount ? (
          <Popover
            title="待修复项明细"
            content={(
              <div className="model-build-issue-list">
                {validationIssues.map((issue, index) => (
                  <div key={`${issue.section}-${issue.error}-${index}`}>
                    <strong>{issue.section}：</strong>{issue.error}
                  </div>
                ))}
              </div>
            )}
          >
            {repairTag}
          </Popover>
        ) : repairTag}
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
