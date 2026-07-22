import { Button, Descriptions, Drawer, Empty, Progress, Tag } from 'antd';
import type { ModelDraft, ModelWorkspaceContext } from '../stores/modelCreationStore';
import type { DraftValidation } from '../utils/validateModelDraft';
import type { ModelCreationStepMeta } from './ModelCreationProgress';
import { inferModelProblemType } from '../utils/inferModelProblemType';
import { modelValidationIssues, type ModelValidationIssue } from '../utils/workflowGuard';

function builderLabel(value: string) { if (value === 'component_based') return '组件化 Builder'; if (value === 'template_based') return '模板 Builder'; if (value === 'domain_builder') return '领域 Builder'; return '通用线性 Builder'; }

export function ModelInspectionDrawer({ open, draft, workspace, validation, steps, tested, solverAvailable = true, onClose, onNavigate }: {
  open: boolean; draft: ModelDraft; workspace: ModelWorkspaceContext; validation: DraftValidation; steps: ModelCreationStepMeta[]; tested: boolean; solverAvailable?: boolean;
  onClose: () => void; onNavigate: (issue: ModelValidationIssue) => void;
}) {
  const issues = modelValidationIssues(validation, steps); const sectionEntries = Object.entries(validation.sections); const passed = sectionEntries.filter(([, section]) => section.valid).length;
  const functionCount = draft.components.filter(component => component.function_asset_id || component.function_id).length;
  const publishReady = !workspace.dirty && tested && validation.valid && solverAvailable;
  return <Drawer className="model-inspection-drawer" title="模型检查" open={open} onClose={onClose} size={480}>
    <section><h3>模型摘要</h3><Descriptions size="small" bordered column={2} items={[{ key: 'scene', label: '业务场景', children: draft.basic_info.scenario || '—' }, { key: 'mode', label: '建模模式', children: builderLabel(draft.basic_info.builder_mode) }, { key: 'type', label: '问题类型', children: inferModelProblemType(draft) }, { key: 'time', label: '时间维度', children: draft.time_dimension.policy || 'not_applicable' }, { key: 'solver', label: '求解器', children: draft.basic_info.solver }, { key: 'components', label: '组件', children: draft.components.length }, { key: 'functions', label: '函数资产', children: functionCount }]} /></section>
    <section><h3>校验状态</h3><Progress percent={Math.round(passed / Math.max(sectionEntries.length, 1) * 100)} status={validation.valid ? 'success' : 'exception'} />
      <div className="inspection-check-grid">{sectionEntries.map(([key, section]) => <div key={key}><span>{key}</span><Tag color={section.valid ? 'success' : 'error'}>{section.valid ? '通过' : `${section.errors.length} 项`}</Tag></div>)}</div>
    </section>
    <section><h3>阻断问题</h3>{issues.length ? <div className="model-inspection-issues">{issues.map(issue => <article key={issue.code}><div><Tag>{issue.stepTitle}</Tag><strong>{issue.sectionLabel}</strong><Tag color={issue.precision === 'exact' ? 'blue' : 'default'}>{issue.precision === 'exact' ? '精确定位' : '章节定位'}</Tag>{issue.fieldCode && <code>{issue.fieldCode}</code>}</div><p>{issue.message}</p><small>{issue.fixHint}</small><Button type="link" onClick={() => onNavigate(issue)}>前往处理</Button></article>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有阻断问题" />}</section>
    <section><h3>发布条件</h3><div className="publish-condition-list"><span>{workspace.dirty ? '○' : '✓'} 草稿已保存</span><span>{tested ? '✓' : '○'} 当前版本已测试</span><span>{validation.valid ? '✓' : '○'} 校验通过</span><span>{solverAvailable ? '✓' : '○'} 求解器可用</span><strong>{publishReady ? '满足发布条件' : '暂不满足发布条件'}</strong></div></section>
  </Drawer>;
}
