import { Alert, Button, Card, Descriptions, Space, Tag, Typography, message } from 'antd';
import { useState } from 'react';
import type { ModelAsset } from '../../../types/model';
import type { ModelDraft } from '../stores/modelCreationStore';
import type { DraftValidation } from '../utils/validateModelDraft';
import { JsonViewer } from '../../../components/JsonViewer';

const sectionLabels: Record<string, string> = {
  semantic: '语义校验',
  formula: '公式校验',
  component_dependencies: '组件依赖校验',
  parameter_bindings: '参数绑定校验',
  problem_type: '问题类型诊断',
  solver_compatibility: '求解器兼容性',
};

function statusOf(result: unknown) {
  const value = result as Record<string, unknown> | undefined;
  return String(value?.status || value?.state || '-');
}

export function Step5ReviewPublish({
  draft,
  validation,
  onPublish,
  onTest,
  pending,
}: {
  draft: ModelDraft;
  validation: DraftValidation;
  onPublish: () => Promise<ModelAsset | unknown> | void;
  onTest: () => Promise<ModelAsset | unknown> | void;
  pending?: boolean;
}) {
  const [testResult, setTestResult] = useState<unknown>();
  const [error, setError] = useState('');
  const dryRun = (testResult as ModelAsset | undefined)?.dry_run_result;
  const diagnosis = ((dryRun as Record<string, unknown> | undefined)?.problem_type_diagnosis || draft.advanced.component_spec?.problem_type_diagnosis || {}) as Record<string, unknown>;
  const functionAssetsUsed = (diagnosis.function_assets_used as unknown[] | undefined) || draft.components.filter(component => component.function_asset_id).map(component => ({ function_asset_id: component.function_asset_id, component: component.type || component.component_id, solve_strategy: component.solve_strategy }));
  const linearizationStrategy = (diagnosis.linearization_strategy as unknown[] | undefined) || [...new Set(draft.components.map(component => component.solve_strategy).filter(Boolean))];

  const runTest = async () => {
    setError('');
    try {
      const result = await onTest();
      setTestResult(result);
      message.success('测试运行完成');
    } catch (exc) {
      const text = String(exc);
      setError(text);
      message.error(text);
    }
  };
  const publish = async () => {
    setError('');
    try {
      await onPublish();
    } catch (exc) {
      const text = String(exc);
      setError(text);
      message.error(text);
    }
  };

  return (
    <>
      <Alert
        showIcon
        type={validation.valid ? 'success' : 'error'}
        title={validation.valid ? '发布前校验全部通过' : '存在阻断项，不能发布'}
        description="语义、公式、组件依赖、参数绑定、问题类型与求解器兼容性已统一检查。"
      />
      {error && <Alert className="section-gap" showIcon type="error" title="发布前检查未通过" description={`请根据检查清单修复模型配置后重试。原始错误已收起：${error}`} />}
      <div className="validation-list section-gap">
        {Object.entries(validation.sections).map(([name, result]) => (
          <div className="validation-row" key={name}>
            <div>
              <Typography.Text strong>{sectionLabels[name] || name}</Typography.Text>
              <Typography.Text type="secondary">{result.errors.join('; ') || '无问题'}</Typography.Text>
              {!result.valid && <Typography.Text type="secondary">修复建议：返回对应步骤补齐缺失配置，再重新校验。</Typography.Text>}
            </div>
            <Tag color={result.valid ? 'green' : 'red'}>{result.valid ? '通过' : '阻断'}</Tag>
          </div>
        ))}
      </div>
      <Card title="发布诊断" className="section-gap">
        <Descriptions size="small" column={4} items={[
          { key: 'inferred', label: '诊断问题类型', children: String(diagnosis.inferred_problem_type || draft.advanced.component_spec?.model_problem_type || '-') },
          { key: 'recommended', label: '推荐求解器', children: String(diagnosis.recommended_solver || 'HiGHS') },
          { key: 'functions', label: '函数资产数量', children: functionAssetsUsed.length },
          { key: 'linearization', label: '线性化策略', children: linearizationStrategy.length ? linearizationStrategy.map(item => <Tag key={String(item)}>{String(item)}</Tag>) : '-' },
        ]} />
      </Card>
      <Card title="dry-run / 发布载荷预览" className="section-gap">
        <Descriptions size="small" column={4} items={[
          { key: 'mode', label: '建模模式', children: draft.basic_info.builder_mode },
          { key: 'solver', label: '求解器', children: draft.basic_info.solver },
          { key: 'generic', label: '通用模型结构', children: draft.advanced.generic_spec ? <Tag color="green">已生成</Tag> : <Tag color="orange">未生成</Tag> },
          { key: 'params', label: '运行参数', children: Object.keys(draft.runtime_parameters).length },
        ]} />
        <JsonViewer value={draft} />
      </Card>
      {testResult && (
        <Card title="测试运行结果" className="section-gap">
          <Descriptions size="small" column={3} items={[
            { key: 'status', label: '模型状态', children: (testResult as ModelAsset).status || '-' },
            { key: 'structure', label: '结构校验', children: statusOf((dryRun as Record<string, unknown> | undefined)?.structure_check) },
            { key: 'solver', label: '求解器 dry-run', children: statusOf((dryRun as Record<string, unknown> | undefined)?.solver_check) },
          ]} />
          <JsonViewer value={testResult} />
        </Card>
      )}
      <Space className="section-gap" wrap>
        <Button data-testid="model-test-run-button" onClick={runTest} disabled={!validation.valid} loading={pending}>测试运行</Button>
        <Button type="primary" onClick={publish} disabled={!validation.valid} loading={pending}>发布模型</Button>
      </Space>
    </>
  );
}
