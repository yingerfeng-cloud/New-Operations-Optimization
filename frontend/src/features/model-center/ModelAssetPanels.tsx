import { Alert, Card, Descriptions, Empty, Space, Table, Tag } from 'antd';
import type { ReactNode } from 'react';
import { JsonViewer } from '../../components/JsonViewer';
import { StatusTag } from '../../components/StatusTag';
import { FormulaDisplay } from '../formula-editor/FormulaDisplay';
import type { ModelAsset } from '../../types/model';

type Detail = Record<string, unknown>;
type Row = Record<string, unknown> & { __row_key?: string };

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): Row[] {
  return Array.isArray(value) ? value as Row[] : [];
}

function text(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function nested(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return objectValue(source[key]);
}

function semanticFrom(model: ModelAsset, detail: Detail) {
  const draft = objectValue(detail.model_draft || model.model_draft);
  const draftSemantic = objectValue(draft.semantic);
  return Object.keys(draftSemantic).length ? draftSemantic : objectValue(detail.semantic_spec || model.semantic_spec);
}

function componentSpecFrom(model: ModelAsset, detail: Detail) {
  return objectValue(detail.component_spec || model.component_spec || nested(objectValue(model.semantic_spec), 'component_spec'));
}

function genericSpecFrom(model: ModelAsset, detail: Detail) {
  return objectValue(detail.generic_spec || model.generic_spec || nested(objectValue(model.semantic_spec), 'generic_spec'));
}

function withKeys(rows: Row[], prefix: string) {
  return rows.map((row, index) => ({ ...row, __row_key: String(row.id || row.code || row.key || row.name || row.component_id || `${prefix}-${index}`) }));
}

function SmallTable({ rows, columns, empty }: { rows: Row[]; columns: Array<{ title: string; dataIndex?: string; render?: (value: unknown, row: Row) => ReactNode }>; empty: string }) {
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="__row_key"
      dataSource={withKeys(rows, empty)}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} /> }}
      columns={columns.map(column => ({
        ...column,
        render: column.render || ((value: unknown) => text(value)),
      }))}
    />
  );
}

function statusTag(status: unknown) {
  const value = String(status || '-');
  const color = value === 'passed' || value === 'success' ? 'green' : value === 'failed' || value === 'error' ? 'red' : 'orange';
  return <Tag color={color}>{value}</Tag>;
}

export function ModelBasicPanel({ model, detail = {} }: { model: ModelAsset; detail?: Detail }) {
  const basic = { ...model, ...objectValue(detail.basic_info) };
  const skill = objectValue(detail.skill_info);
  return (
    <Space orientation="vertical" size={14} style={{ width: '100%' }}>
      <Descriptions bordered size="small" column={2}>
        <Descriptions.Item label="模型ID">{text(basic.id)}</Descriptions.Item>
        <Descriptions.Item label="模型名称">{text(basic.name)}</Descriptions.Item>
        <Descriptions.Item label="场景">{text(basic.scene)}</Descriptions.Item>
        <Descriptions.Item label="版本">{text(basic.version)}</Descriptions.Item>
        <Descriptions.Item label="状态"><StatusTag status={String(basic.status || model.status)} /></Descriptions.Item>
        <Descriptions.Item label="求解器">{text(basic.solver || 'HiGHS')}</Descriptions.Item>
        <Descriptions.Item label="建模模式">{text(basic.build_mode)}</Descriptions.Item>
        <Descriptions.Item label="问题类型">{text(basic.model_problem_type || basic.problem_type)}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{text(basic.updated_at || model.updated_at)}</Descriptions.Item>
        <Descriptions.Item label="发布时间">{text(basic.published_at || model.published_at)}</Descriptions.Item>
      </Descriptions>
      <Card size="small" title="模型服务接口">
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="接口编码">{text(skill.skill_name || `run_${String(model.template_id || model.id).toLowerCase().replaceAll('-', '_')}`)}</Descriptions.Item>
          <Descriptions.Item label="模型版本">{text(skill.model_version || model.version)}</Descriptions.Item>
          <Descriptions.Item label="Endpoint" span={2}>/api/skills/{text(skill.skill_name || `run_${String(model.template_id || model.id).toLowerCase().replaceAll('-', '_')}`)}/run</Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
}

export function ModelSemanticPanel({ model, detail = {} }: { model: ModelAsset; detail?: Detail }) {
  const semantic = semanticFrom(model, detail);
  const schemaColumns = [
    { title: '编码', dataIndex: 'code', render: (value: unknown, row: Row) => text(value || row.key || row.name) },
    { title: '名称', dataIndex: 'name', render: (value: unknown, row: Row) => text(value || row.label) },
    { title: '维度', dataIndex: 'dimension', render: (value: unknown, row: Row) => text(value || row.indices) },
    { title: '单位', dataIndex: 'unit' },
    { title: '来源/类型', dataIndex: 'source_type', render: (value: unknown, row: Row) => text(value || row.sourceType || row.var_type || row.type) },
  ];
  return (
    <Space orientation="vertical" size={14} style={{ width: '100%' }}>
      <Card size="small" title="集合">
        <SmallTable rows={arrayValue(semantic.sets)} columns={schemaColumns} empty="暂无集合定义" />
      </Card>
      <Card size="small" title="参数">
        <SmallTable rows={arrayValue(semantic.parameters)} columns={schemaColumns} empty="暂无参数定义" />
      </Card>
      <Card size="small" title="变量">
        <SmallTable rows={arrayValue(semantic.variables)} columns={schemaColumns} empty="暂无变量定义" />
      </Card>
    </Space>
  );
}

export function ModelGenericPanel({ model, detail = {} }: { model: ModelAsset; detail?: Detail }) {
  const spec = genericSpecFrom(model, detail);
  const setRows = Object.entries(objectValue(spec.sets)).map(([name, value]) => ({ name, value: Array.isArray(value) ? value.join(', ') : value }));
  const objective = objectValue(spec.objective);
  const termRows = arrayValue(objective.terms);
  return (
    <Space orientation="vertical" size={14} style={{ width: '100%' }}>
      <Card size="small" title="generic_spec 集合">
        <SmallTable rows={setRows} columns={[{ title: '集合', dataIndex: 'name' }, { title: '取值', dataIndex: 'value' }]} empty="暂无 generic_spec.sets" />
      </Card>
      <Card size="small" title="generic_spec 变量">
        <SmallTable rows={arrayValue(spec.variables)} columns={[
          { title: '变量', dataIndex: 'name' },
          { title: '索引', dataIndex: 'indices' },
          { title: '下界', dataIndex: 'lb' },
          { title: '上界', dataIndex: 'ub' },
          { title: '类型', dataIndex: 'domain' },
        ]} empty="暂无 generic_spec.variables" />
      </Card>
      <Card size="small" title="generic_spec 约束">
        <SmallTable rows={arrayValue(spec.constraints)} columns={[
          { title: '约束', dataIndex: 'name', render: (value, row) => text(value || row.constraint_id) },
          { title: '公式', render: (_value, row) => <FormulaDisplay row={row} /> },
          { title: '编译状态', dataIndex: 'compile_status' },
        ]} empty="暂无 generic_spec.constraints" />
      </Card>
      <Card size="small" title={`目标函数 ${text(objective.sense || spec.sense)}`}>
        <SmallTable rows={termRows} columns={[
          { title: '目标项', dataIndex: 'name', render: (value, row) => text(value || row.term_id || row.var) },
          { title: '公式', render: (_value, row) => <FormulaDisplay row={row} /> },
          { title: '系数参数', dataIndex: 'coef_param' },
          { title: '参与求解', dataIndex: 'solve_participation' },
        ]} empty="暂无 objective.terms" />
      </Card>
    </Space>
  );
}

export function ModelComponentPanel({ model, detail = {} }: { model: ModelAsset; detail?: Detail }) {
  const spec = componentSpecFrom(model, detail);
  const draft = objectValue(detail.model_draft || model.model_draft);
  const components = arrayValue(spec.components).length ? arrayValue(spec.components) : arrayValue(draft.components);
  const bindings = arrayValue(detail.parameter_bindings || model.parameter_bindings || objectValue(detail.parameter_schema || model.parameter_schema).parameter_bindings);
  return (
    <Space orientation="vertical" size={14} style={{ width: '100%' }}>
      <Card size="small" title="组件清单">
        <SmallTable rows={components} columns={[
          { title: '组件', dataIndex: 'component_id', render: (value, row) => text(value || row.type || row.name) },
          { title: '版本', dataIndex: 'version' },
          { title: '启用', dataIndex: 'enabled', render: value => value === false ? '否' : '是' },
          { title: '状态', dataIndex: 'status' },
        ]} empty="暂无组件装配" />
      </Card>
      <Card size="small" title="参数绑定">
        <SmallTable rows={bindings} columns={[
          { title: '组件参数', dataIndex: 'component_parameter', render: (value, row) => text(value || row.parameter || row.parameter_code) },
          { title: '模型参数', dataIndex: 'model_parameter' },
          { title: '来源', dataIndex: 'source_system', render: (value, row) => text(value || row.source || row.runtime_key) },
          { title: '状态', dataIndex: 'status' },
        ]} empty="暂无参数绑定" />
      </Card>
    </Space>
  );
}

export function ModelRuntimePanel({ model, detail = {} }: { model: ModelAsset; detail?: Detail }) {
  const schema = objectValue(detail.parameter_schema || model.parameter_schema);
  const parameters = objectValue(detail.parameters || model.parameters);
  const schemaRows = arrayValue(schema.parameters || schema.inputs || schema.required || schema.input_schema);
  const valueRows = Object.entries(parameters).map(([key, value]) => ({ key, value }));
  return (
    <Space orientation="vertical" size={14} style={{ width: '100%' }}>
      <Card size="small" title="运行参数 Schema">
        <SmallTable rows={schemaRows} columns={[
          { title: '参数', dataIndex: 'code', render: (value, row) => text(value || row.key || row.name) },
          { title: '名称', dataIndex: 'name', render: (value, row) => text(value || row.label) },
          { title: '维度', dataIndex: 'dimension', render: (value, row) => text(value || row.indices) },
          { title: '必填', dataIndex: 'required', render: value => value === false ? '否' : '是' },
          { title: '默认值', dataIndex: 'default_value', render: (value, row) => text(value ?? row.default) },
        ]} empty="暂无参数 Schema" />
      </Card>
      <Card size="small" title="默认运行参数">
        <SmallTable rows={valueRows} columns={[{ title: '参数', dataIndex: 'key' }, { title: '值', dataIndex: 'value' }]} empty="暂无默认运行参数" />
      </Card>
      <Card size="small" title="输入/输出契约">
        <Descriptions size="small" column={1}>
          <Descriptions.Item label="input_contract"><JsonViewer value={detail.input_contract || model.input_contract || {}} /></Descriptions.Item>
          <Descriptions.Item label="output_contract"><JsonViewer value={detail.output_contract || model.output_contract || {}} /></Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
}

export function ModelGovernancePanel({ model, detail = {} }: { model: ModelAsset; detail?: Detail }) {
  const publishInfo = objectValue(detail.publish_info);
  const dryRun = objectValue(publishInfo.dry_run_result || detail.test_result || model.dry_run_result);
  const structure = objectValue(dryRun.structure_check);
  const solver = objectValue(dryRun.solver_check);
  const warnings = arrayValue(model.validation_warnings || solver.warnings);
  const version = objectValue(detail.version_info);
  return (
    <Space orientation="vertical" size={14} style={{ width: '100%' }}>
      <Card size="small" title="发布 dry-run">
        {Object.keys(dryRun).length ? (
          <SmallTable rows={[
            { check: '结构 dry-run', status: structure.status, message: arrayValue(structure.errors).map(item => text(item.error || item.message || item.actual)).join('；') || 'ConcreteModel 构建检查通过' },
            { check: '求解 dry-run', status: solver.status, message: arrayValue(solver.warnings).map(item => text(item.error || item.message || item.actual)).join('；') || '未提供测试用例时默认跳过' },
          ]} columns={[
            { title: '检查项', dataIndex: 'check' },
            { title: '状态', dataIndex: 'status', render: statusTag },
            { title: '说明', dataIndex: 'message' },
          ]} empty="暂无 dry-run 结果" />
        ) : <Alert showIcon type="info" title="暂无 dry-run 结果" description="发布或测试运行后会展示结构检查和求解检查结果。" />}
      </Card>
      <Card size="small" title="版本治理">
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="published_at">{text(publishInfo.published_at || model.published_at)}</Descriptions.Item>
          <Descriptions.Item label="tested_at">{text(publishInfo.tested_at || model.tested_at)}</Descriptions.Item>
          <Descriptions.Item label="dry-run">{text(publishInfo.dry_run_status)}</Descriptions.Item>
          <Descriptions.Item label="参数 Schema">{text(version.parameter_schema_version)}</Descriptions.Item>
          <Descriptions.Item label="目标函数版本">{text(version.objective_version)}</Descriptions.Item>
          <Descriptions.Item label="组件版本">{text(arrayValue(version.component_versions).map(item => `${text(item.component_id)}:${text(item.version)}`).join(', '))}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card size="small" title="校验警告">
        <SmallTable rows={warnings} columns={[
          { title: '字段', dataIndex: 'field', render: (value, row) => text(value || row.section || row.rule) },
          { title: '说明', dataIndex: 'message', render: (value, row) => text(value || row.error || row.actual) },
          { title: '建议', dataIndex: 'suggestion' },
        ]} empty="暂无校验警告" />
      </Card>
    </Space>
  );
}

export function ModelHistoryPanel({ detail = {} }: { detail?: Detail }) {
  return (
    <Space orientation="vertical" size={14} style={{ width: '100%' }}>
      <Card size="small" title="最近调用记录">
        <SmallTable rows={arrayValue(detail.recent_invocations)} columns={[
          { title: '时间', dataIndex: 'created_at' },
          { title: '来源', dataIndex: 'caller', render: (value, row) => text(value || row.source || 'api') },
          { title: '状态', dataIndex: 'status' },
          { title: '目标值', dataIndex: 'objective_value', render: (value, row) => text(value ?? objectValue(objectValue(row.result).metrics).objective_value) },
        ]} empty="暂无调用记录" />
      </Card>
      <Card size="small" title="最近任务日志">
        <SmallTable rows={arrayValue(detail.recent_tasks)} columns={[
          { title: '任务', dataIndex: 'task_id' },
          { title: '状态', dataIndex: 'status' },
          { title: '耗时', dataIndex: 'duration_seconds' },
          { title: '错误', dataIndex: 'error' },
        ]} empty="暂无任务日志" />
      </Card>
    </Space>
  );
}
