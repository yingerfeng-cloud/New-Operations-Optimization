import { Alert, Button, Card, Collapse, Descriptions, Space, Table, Tag, Typography, message } from 'antd';
import { useState } from 'react';
import type { ModelAsset } from '../../../types/model';
import type { ModelDraft } from '../stores/modelCreationStore';
import type { DraftValidation } from '../utils/validateModelDraft';
import { JsonViewer } from '../../../components/JsonViewer';
import { analyzeDraftNonlinear } from '../utils/nonlinearDiagnostics';

const sectionLabels: Record<string, string> = {
  basic_info: '基础信息校验',
  semantic_structure: '语义结构校验',
  formula: '公式校验',
  component_dependencies: '组件依赖校验',
  parameter_bindings: '参数绑定校验',
  runtime_parameters: '运行参数完整性校验',
  problem_type: '问题类型诊断',
  solver_compatibility: '求解器兼容性',
};

const sectionFixStep: Record<string, number> = {
  basic_info: 0,
  semantic_structure: 1,
  formula: 2,
  component_dependencies: 1,
  parameter_bindings: 1,
  runtime_parameters: 3,
  problem_type: 2,
  solver_compatibility: 4,
};

function statusOf(result: unknown) {
  const value = result as Record<string, unknown> | undefined;
  return String(value?.status || value?.state || '-');
}

function pwl2dRiskRows(draft: ModelDraft) {
  return draft.components
    .filter(component => String(component.type || component.component_id) === 'function_mapping_2d_component')
    .map((component, index) => {
      const metadata = (component.metadata || {}) as Record<string, unknown>;
      const triangleCount = Number(metadata.triangle_count || 0);
      const indices = Array.isArray(component.indices) ? component.indices as Array<Record<string, unknown>> : [];
      const firstSet = String(indices[0]?.set || 'time');
      const setValues = draft.runtime_parameters[firstSet];
      const horizon = Array.isArray(setValues) ? setValues.length : Number(draft.runtime_parameters.horizon || 1);
      const expandedSize = Math.max(1, horizon || 1) * Math.max(0, triangleCount || 0);
      return {
        key: `${String(component.function_asset_id || index)}_${index}`,
        function_asset_id: String(component.function_asset_id || '-'),
        triangle_count: triangleCount || '-',
        expanded_size: expandedSize || '-',
        solve_strategy: String(component.solve_strategy || '-'),
        risk: expandedSize > 4000 ? '超过阈值' : component.solve_strategy === 'triangulated_milp_exact' ? 'MILP 二进制变量风险' : '非精确/展示策略',
      };
    });
}

export function Step5ReviewPublish({
  draft,
  validation,
  onPublish,
  onTest,
  pending,
  onFixStep,
}: {
  draft: ModelDraft;
  validation: DraftValidation;
  onPublish: () => Promise<ModelAsset | unknown> | void;
  onTest: () => Promise<ModelAsset | unknown> | void;
  pending?: boolean;
  onFixStep?: (step: number) => void;
}) {
  const [testResult, setTestResult] = useState<unknown>();
  const [error, setError] = useState('');
  const dryRun = (testResult as ModelAsset | undefined)?.dry_run_result;
  const diagnosis = ((dryRun as Record<string, unknown> | undefined)?.problem_type_diagnosis || draft.advanced.component_spec?.problem_type_diagnosis || {}) as Record<string, unknown>;
  const functionAssetsUsed = (diagnosis.function_assets_used as unknown[] | undefined) || draft.components.filter(component => component.function_asset_id).map(component => ({ function_asset_id: component.function_asset_id, component: component.type || component.component_id, solve_strategy: component.solve_strategy }));
  const linearizationStrategy = (diagnosis.linearization_strategy as unknown[] | undefined) || [...new Set(draft.components.map(component => component.solve_strategy).filter(Boolean))];
  const pwl2dRows = pwl2dRiskRows(draft);
  const nonlinearReport = analyzeDraftNonlinear(draft);
  const pwl2dMilpCount = pwl2dRows.filter(row => row.solve_strategy === 'triangulated_milp_exact').length;
  const hasBlockingPwl2dScale = pwl2dRows.some(row => Number(row.expanded_size) > 4000);
  const hasBlockingNonlinear = nonlinearReport.has_blocking_nonlinearity;
  const blockingReasons = Object.values(validation.sections).flatMap(section => section.errors || []);

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
        className="compact-step-note"
        showIcon
        type={validation.valid ? 'success' : 'error'}
        title={validation.valid ? '发布前校验全部通过' : '存在阻断项，不能发布'}
        description="语义、公式、组件依赖、参数绑定、问题类型与求解器兼容性已统一检查。"
      />
      {error && <Alert className="section-gap" showIcon type="error" title="发布前检查未通过" description={`请根据检查清单修复模型配置后重试。原始错误：${error}`} />}
      <div className="validation-list section-gap">
        {Object.entries(validation.sections).map(([name, result]) => (
          <div className="validation-row" key={name}>
            <div>
              <Typography.Text strong>{sectionLabels[name] || name}</Typography.Text>
              <Typography.Text type="secondary">{result.errors.join('; ') || '无问题'}</Typography.Text>
              {!result.valid && <Typography.Text type="secondary">修复建议：返回对应步骤补齐缺失配置，再重新校验。</Typography.Text>}
            </div>
            <Space>
              <Tag color={result.valid ? 'green' : 'red'}>{result.valid ? '通过' : '阻断'}</Tag>
              {!result.valid && onFixStep && <Button size="small" onClick={() => onFixStep(sectionFixStep[name] ?? 0)}>去修复</Button>}
            </Space>
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
      {pwl2dRows.length > 0 && (
        <Card title="二维 PWL 风险诊断" className="section-gap">
          <Alert
            showIcon
            type={hasBlockingPwl2dScale ? 'error' : 'warning'}
            title={hasBlockingPwl2dScale ? '二维分段线性函数规模过大' : '二维分段线性函数会提升 MILP 复杂度'}
            description="triangulated_milp_exact 会为每个索引点和三角形引入二进制选择变量。默认展开规模阈值为 4000。"
          />
          <Descriptions className="section-gap" size="small" column={3} items={[
            { key: 'count', label: '二维函数组件数量', children: pwl2dRows.length },
            { key: 'milp', label: '精确 MILP 组件数量', children: pwl2dMilpCount },
            { key: 'threshold', label: '默认展开阈值', children: '4000' },
          ]} />
          <Table
            size="small"
            pagination={false}
            rowKey="key"
            dataSource={pwl2dRows}
            columns={[
              { title: 'function_asset_id', dataIndex: 'function_asset_id' },
              { title: 'triangle_count', dataIndex: 'triangle_count' },
              { title: '展开规模估算', dataIndex: 'expanded_size' },
              { title: '求解策略', dataIndex: 'solve_strategy' },
              { title: '风险', dataIndex: 'risk' },
            ]}
          />
        </Card>
      )}
      <Card title="非线性诊断" className="section-gap">
        <Descriptions size="small" column={4} items={[
          { key: 'count', label: '非线性关系数量', children: nonlinearReport.count },
          { key: 'converted', label: '已转换', children: nonlinearReport.relationships.filter(item => item.converted).length },
          { key: 'blocking', label: '阻断项', children: nonlinearReport.blocking_items.length },
          { key: 'solver', label: '当前求解器', children: draft.basic_info.solver || 'HiGHS' },
        ]} />
        {hasBlockingNonlinear && <Alert className="section-gap" type="error" showIcon title="存在未转换非线性，已阻断发布" description={nonlinearReport.blocking_items[0]?.message} />}
        {nonlinearReport.count > 0 ? (
          <Table
            className="section-gap"
            size="small"
            pagination={false}
            rowKey={row => `${row.source}-${row.nonlinear_type}-${row.expression}`}
            dataSource={nonlinearReport.relationships}
            columns={[
              { title: '类型', dataIndex: 'nonlinear_type' },
              { title: '变量', render: (_, row) => row.involved_variables.join(', ') || '-' },
              { title: '是否已转换', render: (_, row) => row.converted ? <Tag color="green">已转换</Tag> : <Tag color={row.blocking ? 'red' : 'orange'}>未转换</Tag> },
              { title: '求解器支持', render: (_, row) => row.supported_by_current_solver ? <Tag color="green">支持</Tag> : <Tag color="red">不支持</Tag> },
              { title: '推荐策略', render: (_, row) => row.recommended_strategy.map(item => <Tag key={item}>{item}</Tag>) },
              { title: '提示', dataIndex: 'message' },
            ]}
          />
        ) : <Typography.Text type="secondary">未发现非线性关系</Typography.Text>}
      </Card>
      <Collapse
        className="section-gap"
        items={[{
          key: 'publish-debug',
          label: '高级调试',
          children: (
            <Card title="dry-run / 发布载荷预览">
              <Descriptions size="small" column={4} items={[
                { key: 'mode', label: '建模模式', children: draft.basic_info.builder_mode },
                { key: 'solver', label: '求解器', children: draft.basic_info.solver },
                { key: 'generic', label: '通用模型结构', children: draft.advanced.generic_spec ? <Tag color="green">已生成</Tag> : <Tag color="orange">未生成</Tag> },
                { key: 'params', label: '运行参数', children: Object.keys(draft.runtime_parameters).length },
              ]} />
              <JsonViewer value={draft} />
            </Card>
          ),
        }]}
      />
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
        <Button data-testid="model-test-run-button" onClick={runTest} disabled={!validation.valid || hasBlockingPwl2dScale} loading={pending}>测试运行</Button>
        <Button type="primary" onClick={publish} disabled={!validation.valid || hasBlockingPwl2dScale} loading={pending}>发布模型</Button>
        {(!validation.valid || hasBlockingPwl2dScale) && (
          <Typography.Text type="secondary">
            不可发布原因：{hasBlockingPwl2dScale ? '二维 PWL 展开规模超过阈值' : blockingReasons[0] || '存在未通过校验项'}
          </Typography.Text>
        )}
      </Space>
    </>
  );
}
