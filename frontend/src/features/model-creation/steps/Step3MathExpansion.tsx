import { Alert, Button, Card, Descriptions, Empty, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FormulaDef } from '../../../types/formula';
import type { ModelDraft } from '../stores/modelCreationStore';
import type { FunctionAsset } from '../../../types/functionAsset';
import { getFunctionAssets } from '../../../api/functionAssets';
import { FormulaBuilderModal } from '../../formula-editor/FormulaBuilderModal';
import { compileFormulaToGenericSpec } from '../utils/compileFormulaToGenericSpec';
import { JsonViewer } from '../../../components/JsonViewer';
import { FormulaDisplay } from '../../formula-editor/FormulaDisplay';

const newFormula = (kind: 'constraint' | 'objective'): FormulaDef => ({
  formula_id: crypto.randomUUID(),
  name: kind === 'constraint' ? '新约束' : '目标函数',
  kind,
  display_formula: '',
  dsl_formula: '',
  tokens: [],
  foreach: [],
  referenced_sets: [],
  referenced_parameters: [],
  referenced_variables: [],
  free_indices: [],
  compile_status: 'error',
});

function componentRows(component: Record<string, unknown>, key: string) {
  const value = component[key];
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function variableExpressionOptions(draft: ModelDraft) {
  return draft.semantic.variables.map(variable => {
    const code = variable.code;
    const indices = variable.indices || variable.dimension || [];
    const expression = indices.length ? `${code}[${indices.map((_, index) => (index === 0 ? 't' : `i${index}`)).join(',')}]` : code;
    return { value: expression, label: `${variable.name || code} (${expression})` };
  });
}

function setOptions(draft: ModelDraft) {
  return draft.semantic.sets.map(set => ({ value: set.code, label: set.name ? `${set.name} (${set.code})` : set.code }));
}

function baseVariableName(expression?: string) {
  return String(expression || '').trim().match(/^([A-Za-z_]\w*)/)?.[1] || '';
}

function hasSemanticVariable(draft: ModelDraft, expression?: string) {
  const variable = baseVariableName(expression);
  return Boolean(variable && draft.semantic.variables.some(item => item.code === variable));
}

function assetOptionLabel(asset: FunctionAsset) {
  const status = asset.validation_status || 'valid';
  const suffix = status === 'invalid' ? ` - 异常：${(asset.validation_errors || []).map(item => String(item.message || item.error || '')).filter(Boolean).join('; ') || '校验未通过'}` : '';
  return `${asset.name || asset.function_id} (${asset.function_id}, ${status})${suffix}`;
}

function invalidAssetReason(asset: FunctionAsset) {
  return (asset.validation_errors || []).map(item => String(item.message || item.error || '')).filter(Boolean).join('；') || '资产校验未通过，不能参与模型发布';
}

export function Step3MathExpansion({ draft, onChange }: { draft: ModelDraft; onChange: (d: ModelDraft) => void }) {
  const [editing, setEditing] = useState<FormulaDef>();
  const [selectedComponentKey, setSelectedComponentKey] = useState<string>();
  const [compileError, setCompileError] = useState('');
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingForm] = Form.useForm();
  const functionAssets = useQuery({ queryKey: ['function-assets'], queryFn: getFunctionAssets, enabled: mappingOpen });
  const selectedFunctionAssetId = Form.useWatch('function_asset_id', mappingForm);
  const selectedStrategy = Form.useWatch('solve_strategy', mappingForm);
  const selectedAsset = (functionAssets.data || []).find(asset => asset.function_id === selectedFunctionAssetId);
  const selectedConvexity = selectedAsset?.convexity || selectedAsset?.diagnostics?.convexity;
  const symbols = {
    sets: Object.fromEntries(draft.semantic.sets.map(x => [x.code, x.name || x.code])),
    parameters: Object.fromEntries(draft.semantic.parameters.map(x => [x.code, { label: x.name || x.code, indices: x.indices || x.dimension, unit: x.unit, description: x.description }])),
    variables: Object.fromEntries(draft.semantic.variables.map(x => [x.code, { label: x.name || x.code, indices: x.indices || x.dimension, unit: x.unit, description: x.description }])),
  };

  useEffect(() => {
    if (!mappingOpen || !functionAssets.data?.length || mappingForm.getFieldValue('function_asset_id')) return;
    const firstSelectable = functionAssets.data.find(asset => asset.validation_status !== 'invalid');
    if (firstSelectable) {
      mappingForm.setFieldValue('function_asset_id', firstSelectable.function_id);
    }
  }, [functionAssets.data, mappingForm, mappingOpen]);

  const compile = () => {
    try {
      const spec = compileFormulaToGenericSpec(draft.formulas, draft.semantic);
      setCompileError('');
      onChange({ ...draft, advanced: { ...draft.advanced, generic_spec: spec } });
      Modal.success({ title: 'generic_spec 编译成功', content: '所有公式已编译为后端线性结构。' });
    } catch (error) {
      const text = String(error);
      setCompileError(text);
      Modal.error({ title: '编译失败，已阻止发布', content: text });
    }
  };

  const applyFormula = (formula: FormulaDef) => {
    const exists = draft.formulas.some(x => x.formula_id === formula.formula_id);
    onChange({ ...draft, formulas: exists ? draft.formulas.map(x => x.formula_id === formula.formula_id ? formula : x) : [...draft.formulas, formula] });
    setEditing(undefined);
  };

  const deleteFormula = (formulaId: string) => {
    onChange({ ...draft, formulas: draft.formulas.filter(x => x.formula_id !== formulaId) });
    setEditing(undefined);
  };

  const openFunctionMapping = () => {
    const variables = variableExpressionOptions(draft);
    const sets = setOptions(draft);
    mappingForm.setFieldsValue({
      function_asset_id: undefined,
      x: variables[0]?.value,
      x_pick: variables[0]?.value,
      y: variables[1]?.value || variables[0]?.value,
      y_pick: variables[1]?.value || variables[0]?.value,
      index_set: sets.find(item => item.value === 'time')?.value || sets[0]?.value,
      index_alias: 't',
      solve_strategy: 'convex_combination_lp',
      constraint_id: `function_mapping_${Date.now()}`,
    });
    setMappingOpen(true);
  };

  const addFunctionMappingComponent = (values: Record<string, string>) => {
    if (!/^[A-Za-z_]\w*(\[[^\]]+\])?$/.test(values.x || '') || !/^[A-Za-z_]\w*(\[[^\]]+\])?$/.test(values.y || '')) {
      message.error('输入变量 x 和输出变量 y 必须是变量名或变量索引表达式，例如 volume[t]');
      return;
    }
    if (!hasSemanticVariable(draft, values.y)) {
      const yVar = baseVariableName(values.y);
      message.error(`输出变量 ${yVar || values.y} 未在语义模型变量中定义，请先在 Step2 新增该变量，或选择已有变量。`);
      return;
    }
    const selectedAsset = (functionAssets.data || []).find(asset => asset.function_id === values.function_asset_id);
    if (!selectedAsset || selectedAsset.validation_status === 'invalid') {
      message.error('请选择校验状态为 valid 或 warning 的函数/曲线资产');
      return;
    }
    const component = {
      component_id: 'function_mapping_component',
      type: 'function_mapping_component',
      name: '函数映射',
      display_name: '函数映射',
      enabled: true,
      function_asset_id: values.function_asset_id,
      x: values.x,
      y: values.y,
      indices: values.index_set ? [{ set: values.index_set, alias: values.index_alias || 't' }] : [],
      solve_strategy: values.solve_strategy,
      constraint_id: values.constraint_id,
      generated_constraints: [{
        constraint_id: values.constraint_id,
        type: 'piecewise',
        expression: `${values.y} == piecewise(${values.x}, ${values.function_asset_id})`,
        piecewise_method: values.solve_strategy,
        function_asset_id: values.function_asset_id,
      }],
      metadata: {
        function_asset_name: selectedAsset.name,
        validation_status: selectedAsset.validation_status || 'valid',
        convexity: selectedAsset.convexity || selectedAsset.diagnostics?.convexity,
        monotonicity: selectedAsset.monotonicity,
      },
    };
    const nextComponents = [...draft.components, component];
    onChange({ ...draft, components: nextComponents });
    setSelectedComponentKey(String(component.constraint_id || component.function_asset_id));
    setMappingOpen(false);
  };

  const componentStatus = (component: Record<string, unknown>) => {
    if (component.solve_strategy === 'display_only') return { color: 'default', text: '不参与求解' };
    if (component.solve_strategy === 'binary_segment_milp') return { color: 'orange', text: '有风险' };
    if (component.function_asset_id && (!component.x || !component.y)) return { color: 'red', text: '缺少配置' };
    return { color: 'green', text: '已配置' };
  };

  const componentType = (component: Record<string, unknown>) => {
    if (component.function_asset_id) return '函数映射';
    if (component.type === 'custom_constraint') return '自定义约束';
    if (component.type === 'objective') return '目标函数';
    return '通用组件';
  };

  const componentKey = (component: Record<string, unknown>, index: number) => String(component.constraint_id || component.function_asset_id || component.component_id || component.name || `component_${index}`);

  const renderComponentDetail = (component?: Record<string, unknown>) => {
    if (!component) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择左侧构件查看配置" />;
    const status = componentStatus(component);
    return (
      <Card title={String(component.display_name || component.name || component.component_id || '构件配置')} extra={<Tag color={status.color}>{status.text}</Tag>}>
        <Descriptions size="small" column={3} items={[
          { key: 'type', label: '构件类型', children: componentType(component) },
          { key: 'asset', label: '函数资产', children: String(component.function_asset_id || '-') },
          { key: 'strategy', label: '求解策略', children: String(component.solve_strategy || '-') },
          { key: 'x', label: '输入 x', children: String(component.x || '-') },
          { key: 'y', label: '输出 y', children: String(component.y || '-') },
          { key: 'indices', label: '索引集合', children: JSON.stringify(component.indices || []) },
          { key: 'dependencies', label: '依赖项', children: Array.isArray(component.dependencies) && component.dependencies.length ? component.dependencies.join(', ') : '-' },
        ]} />
        {component.solve_strategy === 'binary_segment_milp' && <Alert className="section-gap" type="warning" showIcon title="预留能力，当前不可发布为可求解模型。" />}
        {Boolean(component.metadata) && ['unknown', 'nonconvex'].includes(String((component.metadata as Record<string, unknown>).convexity || '')) && component.solve_strategy === 'convex_combination_lp' && (
          <Alert className="section-gap" type="warning" showIcon title="凸组合 LP 风险" description="当前曲线凸性未知或非凸，结果可能不严格落在原始折线上。" />
        )}
        <Table className="section-gap" size="small" pagination={false} rowKey={row => String(row.constraint_id || row.name || row.expression || row.formula)} dataSource={[...componentRows(component, 'generated_constraints'), ...componentRows(component, 'constraints')]} columns={[{ title: '约束', dataIndex: 'name' }, { title: '公式', render: (_, row) => <FormulaDisplay row={row} /> }]} />
        <Table className="section-gap" size="small" pagination={false} rowKey={row => String(row.term_id || row.weight_key || row.name || row.expression || row.formula)} dataSource={[...componentRows(component, 'generated_objective_terms'), ...componentRows(component, 'objective_terms')]} columns={[{ title: '目标项', dataIndex: 'name' }, { title: '公式', render: (_, row) => <FormulaDisplay row={row} /> }]} />
        <Table className="section-gap" size="small" pagination={false} rowKey={row => String(row.component_parameter || row.parameter || row.code || row.model_parameter)} dataSource={componentRows(component, 'parameter_bindings')} columns={[{ title: '组件参数', dataIndex: 'component_parameter' }, { title: '模型参数', dataIndex: 'model_parameter' }, { title: '状态', dataIndex: 'status' }]} />
      </Card>
    );
  };

  const renderComponentWorkbench = () => {
    const selected = draft.components.find((component, index) => componentKey(component, index) === selectedComponentKey) || draft.components[0];
    return (
      <div className="math-expansion-workbench section-gap">
        <Card className="component-list-panel" title="构件清单">
          {draft.components.length ? draft.components.map((component, index) => {
            const name = String(component.display_name || component.name || component.component_id || `组件 ${index + 1}`);
            const status = componentStatus(component);
            const key = componentKey(component, index);
            return (
              <button type="button" className={`component-list-item ${componentKey(selected || {}, 0) === key ? 'active' : ''}`} key={key} onClick={() => setSelectedComponentKey(key)}>
                <span>
                  <strong>{name}</strong>
                  <small>{componentType(component)}</small>
                </span>
                <Tag color={status.color}>{status.text}</Tag>
              </button>
            );
          }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未添加构件" />}
        </Card>
        <div className="component-config-panel">
          {renderComponentDetail(selected)}
        </div>
      </div>
    );
  };

  const renderLegacyComponentList = () => (
    <Space orientation="vertical" size={16} style={{ width: '100%' }} className="section-gap">
      {draft.components.length ? draft.components.map((component, index) => {
        const name = String(component.display_name || component.name || component.component_id || `组件 ${index + 1}`);
        const dependencies = [...new Set([...(Array.isArray(component.dependencies) ? component.dependencies : []), ...(Array.isArray(component.depends_on) ? component.depends_on : [])])];
        return (
          <Card key={`${name}-${index}`} title={name}>
            <Descriptions size="small" column={3} items={[
              { key: 'constraints', label: '生成约束', children: componentRows(component, 'generated_constraints').length || componentRows(component, 'constraints').length },
              { key: 'objectives', label: '目标项', children: componentRows(component, 'generated_objective_terms').length || componentRows(component, 'objective_terms').length },
              { key: 'bindings', label: '参数绑定', children: componentRows(component, 'parameter_bindings').length },
            ]} />
            {Boolean(component.function_asset_id) && (
              <Descriptions className="section-gap" size="small" column={3} items={[
                { key: 'asset', label: '函数资产', children: String(component.function_asset_id) },
                { key: 'x', label: '输入 x', children: String(component.x || '-') },
                { key: 'y', label: '输出 y', children: String(component.y || '-') },
                { key: 'strategy', label: '求解策略', children: String(component.solve_strategy || '-') },
              ]} />
            )}
            <Table className="section-gap" size="small" pagination={false} rowKey={row => String(row.constraint_id || row.name || row.expression || row.formula)} dataSource={[...componentRows(component, 'generated_constraints'), ...componentRows(component, 'constraints')]} columns={[{ title: '约束', dataIndex: 'name' }, { title: '公式', render: (_, row) => <FormulaDisplay row={row} /> }]} />
            <Table className="section-gap" size="small" pagination={false} rowKey={row => String(row.term_id || row.weight_key || row.name || row.expression || row.formula)} dataSource={[...componentRows(component, 'generated_objective_terms'), ...componentRows(component, 'objective_terms')]} columns={[{ title: '目标项', dataIndex: 'name' }, { title: '公式', render: (_, row) => <FormulaDisplay row={row} /> }]} />
            <Space wrap className="section-gap">{dependencies.length ? dependencies.map(item => <Tag key={String(item)}>{String(item)}</Tag>) : <Tag>无依赖</Tag>}</Space>
            <Table className="section-gap" size="small" pagination={false} rowKey={row => String(row.component_parameter || row.parameter || row.code || row.model_parameter)} dataSource={componentRows(component, 'parameter_bindings')} columns={[{ title: '组件参数', dataIndex: 'component_parameter' }, { title: '模型参数', dataIndex: 'model_parameter' }, { title: '状态', dataIndex: 'status' }]} />
          </Card>
        );
      }) : <Card><Alert type="warning" title="尚未选择组件" description="组件化 Builder 需要组件清单后才能展示生成约束、目标项、依赖和参数绑定。" /></Card>}
    </Space>
  );

  if (draft.basic_info.builder_mode !== 'generic_linear') return (
    <>
      <Alert type="info" title="组件化数学展开" description="约束和目标项由已选组件生成；自定义公式仍通过统一公式编辑器维护。" />
      <Space wrap className="section-gap">
        <Button onClick={() => setEditing(newFormula('constraint'))}>添加自定义公式</Button>
        <Button type="primary" onClick={openFunctionMapping}>添加函数映射</Button>
      </Space>
      {renderComponentWorkbench()}
      <Modal width={720} open={mappingOpen} destroyOnHidden onCancel={() => setMappingOpen(false)} title="添加函数映射" footer={null}>
        <Form form={mappingForm} layout="vertical" onFinish={addFunctionMappingComponent}>
          <Form.Item name="function_asset_id" label="函数/曲线资产" rules={[{ required: true, message: '请选择函数/曲线资产' }]}>
            <Select
              loading={functionAssets.isLoading}
              showSearch
              optionFilterProp="label"
              optionLabelProp="labelText"
              filterOption={(input, option) => String(option?.labelText || '').toLowerCase().includes(input.toLowerCase())}
              options={(functionAssets.data || []).map(asset => ({
                value: asset.function_id,
                labelText: assetOptionLabel(asset),
                label: asset.validation_status === 'invalid'
                  ? <Tooltip title={`禁用原因：${invalidAssetReason(asset)}`}><span>{assetOptionLabel(asset)}</span></Tooltip>
                  : assetOptionLabel(asset),
                disabled: asset.validation_status === 'invalid',
              }))}
              notFoundContent="暂无函数/曲线资产"
            />
          </Form.Item>
          <Descriptions size="small" column={1} items={[{ key: 'binary', label: '精确分段 MILP', children: '该策略需要二进制变量选择具体曲线分段，目前作为预留能力展示，暂不能发布为可求解模型。' }]} />
          <Alert
            className="section-gap"
            type="info"
            showIcon
            title="求解策略说明"
            description={(
              <Space orientation="vertical" size={4}>
                <span>convex_combination_lp：当前可求解，LP 凸组合近似</span>
                <span>display_only：仅展示，不参与求解</span>
                <span>binary_segment_milp：精确分段 MILP，预留能力，当前不可发布为可求解模型，暂不可发布</span>
              </Space>
            )}
          />
          {selectedStrategy === 'convex_combination_lp' && ['unknown', 'nonconvex'].includes(String(selectedConvexity || '')) && (
            <Alert
              className="section-gap"
              type="warning"
              showIcon
              title="曲线形态存在求解风险"
              description="当前选择凸组合 LP 策略，但曲线凸性未知或非凸，求解结果可能落在非相邻断点的组合上。需要严格贴合原始分段时，请先修正曲线形态或等待精确分段 MILP 能力。"
            />
          )}
          <Space style={{ width: '100%' }} size={12} align="start">
            <Form.Item style={{ flex: 1 }} name="x_pick" label="输入变量选择">
              <Select allowClear showSearch options={variableExpressionOptions(draft)} onChange={value => value && mappingForm.setFieldValue('x', value)} />
            </Form.Item>
            <Form.Item style={{ flex: 1 }} name="x" label="输入表达式 x" rules={[{ required: true, message: '请输入或选择输入变量 x' }]}>
              <Input placeholder="例如 volume[t]" />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size={12} align="start">
            <Form.Item style={{ flex: 1 }} name="y_pick" label="输出变量选择">
              <Select allowClear showSearch options={variableExpressionOptions(draft)} onChange={value => value && mappingForm.setFieldValue('y', value)} />
            </Form.Item>
            <Form.Item
              style={{ flex: 1 }}
              name="y"
              label="输出表达式 y"
              rules={[
                { required: true, message: '请输入或选择输出变量 y' },
                {
                  validator: (_, value) => {
                    if (!value || hasSemanticVariable(draft, value)) return Promise.resolve();
                    const yVar = baseVariableName(value);
                    return Promise.reject(new Error(`输出变量 ${yVar || value} 未在语义模型变量中定义，请先在 Step2 新增该变量，或选择已有变量。`));
                  },
                },
              ]}
            >
              <Input placeholder="例如 level[t]" />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item style={{ flex: 1 }} name="index_set" label="索引集合">
              <Select allowClear options={setOptions(draft)} />
            </Form.Item>
            <Form.Item name="index_alias" label="索引别名">
              <Input style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item name="solve_strategy" label="求解策略" rules={[{ required: true }]}>
            <Select options={[
              { value: 'convex_combination_lp', label: 'convex_combination_lp - LP 凸组合近似' },
              { value: 'display_only', label: 'display_only - 仅展示' },
              { value: 'binary_segment_milp', label: 'binary_segment_milp - 精确分段 MILP（预留，暂不可发布）' },
            ]} />
          </Form.Item>
          <Form.Item name="constraint_id" label="约束名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space>
            <Button onClick={() => setMappingOpen(false)}>取消</Button>
            <Button type="primary" htmlType="submit">添加</Button>
          </Space>
        </Form>
      </Modal>
    </>
  );

  return (
    <>
      <Space wrap>
        <Button type="primary" onClick={() => setEditing(newFormula('constraint'))}>新增约束公式</Button>
        <Button onClick={() => setEditing(newFormula('objective'))}>新增目标函数</Button>
        <Button onClick={compile}>编译 generic_spec</Button>
      </Space>
      {compileError && <Alert className="section-gap" type="error" showIcon title="编译失败" description={compileError} />}
      <div className="math-expansion-workbench section-gap">
        <Card className="component-list-panel" title="构件清单">
          {draft.formulas.length ? draft.formulas.map(f => (
            <button type="button" className={`component-list-item ${selectedComponentKey === f.formula_id ? 'active' : ''}`} key={f.formula_id} onClick={() => setSelectedComponentKey(f.formula_id)}>
              <span><strong>{f.name}</strong><small>{f.kind === 'objective' ? '目标函数' : '自定义约束'}</small></span>
              <Tag color={f.compile_status === 'ready' ? 'green' : 'orange'}>{f.compile_status === 'ready' ? '已配置' : '缺少配置'}</Tag>
            </button>
          )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未维护公式" />}
        </Card>
        <div className="component-config-panel">
          <Card title="展开预览">
            <Descriptions size="small" column={4} items={[
              { key: 'variables', label: '变量', children: draft.semantic.variables.length },
              { key: 'constraints', label: '约束公式', children: draft.formulas.filter(item => item.kind === 'constraint').length },
              { key: 'objectives', label: '目标函数', children: draft.formulas.filter(item => item.kind === 'objective').length },
              { key: 'compiled', label: '编译状态', children: draft.advanced.generic_spec ? <Tag color="green">已生成</Tag> : <Tag color="orange">待编译</Tag> },
            ]} />
          </Card>
          <div className="formula-list section-gap">
            {draft.formulas.length ? draft.formulas.map(f => (
              <div className="formula-row" key={f.formula_id}>
                <div>
                  <Space wrap><Tag color={f.kind === 'objective' ? 'purple' : 'blue'}>{f.kind === 'objective' ? '目标' : '约束'}</Tag><Typography.Text strong>{f.name}</Typography.Text><Tag color={f.compile_status === 'ready' ? 'green' : 'orange'}>{f.compile_status}</Tag></Space>
                  <FormulaDisplay row={f as unknown as Record<string, unknown>} />
                </div>
                <Button onClick={() => setEditing(f)}>编辑</Button>
              </div>
            )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未维护公式" />}
          </div>
        </div>
      </div>
      {draft.advanced.generic_spec && <Card className="section-gap" title="generic_spec 预览"><JsonViewer value={draft.advanced.generic_spec} /></Card>}
      <FormulaBuilderModal
        open={!!editing}
        value={editing}
        symbols={symbols}
        onApply={applyFormula}
        onCancel={() => setEditing(undefined)}
        onDelete={deleteFormula}
      />
    </>
  );
}
