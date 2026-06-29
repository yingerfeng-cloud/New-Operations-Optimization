import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Empty, Form, Input, Row, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { useEffect, useState } from 'react';
import { FormulaBuilderModal } from '../formula-editor/FormulaBuilderModal';
import type { ComponentDef, SchemaItem } from '../../types/component';
import type { FormulaDef } from '../../types/formula';

type EditorProps = {
  component?: ComponentDef;
  availableIds?: string[];
  onSave: (value: Partial<ComponentDef>) => void;
};

const statusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '已发布', value: 'published' },
  { label: '已停用', value: 'offline' },
];

function SchemaList({ name, title }: { name: 'required_sets' | 'parameters' | 'variables'; title: string }) {
  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {fields.map(field => (
            <Card
              key={field.key}
              size="small"
              title={`${title} #${field.name + 1}`}
              extra={<Button aria-label={`删除${title}`} danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
            >
              <Row gutter={12}>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'code']} label="编码" rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'name']} label="名称"><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'unit']} label="单位"><Input /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={[field.name, 'dimension']} label="维度"><Select mode="tags" /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={[field.name, 'source_system']} label="数据来源"><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'required']} label="必填" valuePropName="checked"><Switch /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'default']} label="默认值"><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'sample_value']} label="示例值"><Input /></Form.Item></Col>
              </Row>
            </Card>
          ))}
          <Button icon={<PlusOutlined />} onClick={() => add({ required: name !== 'variables' })}>新增{title}</Button>
        </Space>
      )}
    </Form.List>
  );
}

function formulaFromRow(row: Record<string, unknown> | undefined, kind: 'constraint' | 'objective'): FormulaDef {
  const id = String(row?.constraint_id || row?.term_id || row?.name || crypto.randomUUID());
  const dsl = String(row?.dsl_formula || row?.formula || row?.expression || '');
  return {
    formula_id: id,
    name: String(row?.name || (kind === 'constraint' ? '新约束' : '目标项')),
    kind,
    display_formula: String(row?.display_formula || row?.readable_formula || dsl),
    dsl_formula: dsl,
    tokens: Array.isArray(row?.tokens) ? row.tokens as FormulaDef['tokens'] : [],
    foreach: Array.isArray(row?.foreach) ? row.foreach as string[] : Array.isArray(row?.indices) ? row.indices as string[] : [],
    referenced_sets: [],
    referenced_parameters: [],
    referenced_variables: [],
    free_indices: [],
    compile_status: 'ready',
  };
}

function symbolsFromSchema(sets?: SchemaItem[], parameters?: SchemaItem[], variables?: SchemaItem[]) {
  return {
    sets: Object.fromEntries((sets || []).map(item => [item.code, item.name || item.code])),
    parameters: Object.fromEntries((parameters || []).map(item => [item.code, { label: item.name || item.code, indices: item.dimension, unit: item.unit }])),
    variables: Object.fromEntries((variables || []).map(item => [item.code, { label: item.name || item.code, indices: item.dimension, unit: item.unit }])),
  };
}

function FormulaList({ name, title, form, component }: { name: 'generated_constraints' | 'generated_objective_terms'; title: string; form: FormInstance<Partial<ComponentDef>>; component?: ComponentDef }) {
  const kind = name === 'generated_constraints' ? 'constraint' : 'objective';
  const rows = Form.useWatch(name, form) as Array<Record<string, unknown>> | undefined;
  const sets = (Form.useWatch('required_sets', form) as SchemaItem[] | undefined) || component?.required_sets;
  const parameters = (Form.useWatch('parameters', form) as SchemaItem[] | undefined) || component?.parameters;
  const variables = (Form.useWatch('variables', form) as SchemaItem[] | undefined) || component?.variables;
  const symbols = symbolsFromSchema(sets, parameters, variables);
  const [editing, setEditing] = useState<{ index: number; formula: FormulaDef }>();
  const currentRows = rows || [];
  const setRows = (next: Array<Record<string, unknown>>) => form.setFieldValue(name, next);
  const updateFormula = (index: number, formula: FormulaDef) => {
    const next = [...currentRows];
    next[index] = {
      ...(next[index] || {}),
      name: formula.name,
      formula: formula.dsl_formula,
      dsl_formula: formula.dsl_formula,
      display_formula: formula.display_formula,
      tokens: formula.tokens,
      foreach: formula.foreach,
      indices: formula.foreach,
      compile_status: formula.compile_status,
    };
    setRows(next);
  };
  const addFormula = () => {
    const nextIndex = currentRows.length;
    const draft = formulaFromRow(undefined, kind);
    setRows([...currentRows, {
      name: draft.name,
      constraint_id: draft.formula_id,
      term_id: draft.formula_id,
      solve_participation: 'solve_active',
      formula: '',
      dsl_formula: '',
      display_formula: '',
      tokens: [],
      foreach: [],
      indices: [],
      compile_status: 'error',
    }]);
    setEditing({ index: nextIndex, formula: draft });
  };
  const copyFormula = (index: number) => {
    const source = currentRows[index] || {};
    const clone = {
      ...source,
      constraint_id: `${String(source.constraint_id || source.term_id || 'formula')}_copy`,
      term_id: `${String(source.term_id || source.constraint_id || 'formula')}_copy`,
      name: `${String(source.name || title)} 副本`,
    };
    setRows([...currentRows, clone]);
  };
  const removeFormula = (index: number) => setRows(currentRows.filter((_, itemIndex) => itemIndex !== index));
  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Table
        size="small"
        pagination={false}
        rowKey={row => String(row.constraint_id || row.term_id || row.name || row.formula)}
        dataSource={currentRows}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '编码', render: (_, row) => String(row.constraint_id || row.term_id || '-') },
          { title: '类型', render: () => <Tag color={kind === 'constraint' ? 'blue' : 'purple'}>{kind === 'constraint' ? '约束' : '目标'}</Tag> },
          { title: '公式摘要', ellipsis: true, render: (_, row) => String(row.display_formula || row.dsl_formula || row.formula || '-') },
          { title: '参与求解', render: (_, row) => String(row.solve_participation || 'solve_active') === 'preview_only' ? '仅预览' : '参与求解' },
          { title: '状态', render: (_, row) => <Tag color={String(row.compile_status || row.formula || row.dsl_formula) ? 'green' : 'orange'}>{String(row.compile_status || row.formula || row.dsl_formula) ? '已配置' : '待配置'}</Tag> },
          {
            title: '操作',
            fixed: 'right' as const,
            width: 180,
            render: (_, _row, index) => (
              <Space>
                <Button type="link" onClick={() => setEditing({ index, formula: formulaFromRow(currentRows[index], kind) })}>编辑</Button>
                <Button type="link" onClick={() => copyFormula(index)}>复制</Button>
                <Button danger type="link" onClick={() => removeFormula(index)}>删除</Button>
              </Space>
            ),
          },
        ]}
      />
      <Button icon={<PlusOutlined />} onClick={addFormula}>新增{title}</Button>
      <FormulaBuilderModal
        open={!!editing}
        value={editing?.formula}
        symbols={symbols}
        onApply={formula => {
          if (editing) updateFormula(editing.index, formula);
          setEditing(undefined);
        }}
        onCancel={() => setEditing(undefined)}
        onDelete={() => {
          if (editing) removeFormula(editing.index);
          setEditing(undefined);
        }}
      />
    </Space>
  );
}

function BindingList() {
  return (
    <Form.List name="parameter_bindings">
      {(fields, { add, remove }) => (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {fields.map(field => (
            <Card
              key={field.key}
              size="small"
              title={`参数绑定 #${field.name + 1}`}
              extra={<Button aria-label="删除参数绑定" danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
            >
              <Row gutter={12}>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'component_parameter']} label="组件参数" rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'model_parameter']} label="模型参数"><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'status']} label="绑定状态"><Select options={[{ label: '已绑定', value: 'bound' }, { label: '未绑定', value: 'unbound' }]} /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={[field.name, 'source_system']} label="数据来源"><Input /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={[field.name, 'runtime_key']} label="运行参数键"><Input /></Form.Item></Col>
              </Row>
            </Card>
          ))}
          <Button icon={<PlusOutlined />} onClick={() => add({ status: 'bound' })}>新增参数绑定</Button>
        </Space>
      )}
    </Form.List>
  );
}

function DependencyEditor({ form, component, availableIds = [] }: { form: FormInstance<Partial<ComponentDef>>; component?: ComponentDef; availableIds?: string[] }) {
  const deps = (Form.useWatch('depends_on', form) as string[] | undefined) || [];
  const currentId = String(Form.useWatch('component_id', form) || component?.component_id || '');
  const normalizedAvailable = availableIds.filter(id => id !== currentId);
  const missing = deps.filter(dep => !normalizedAvailable.includes(dep));
  const blocksPublish = missing.length > 0;
  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Form.Item
        name="depends_on"
        label="依赖组件编码"
        rules={[{
          validator: async () => {
            if (missing.length) throw new Error(`存在缺失依赖：${missing.join('、')}`);
          },
        }]}
      >
        <Select mode="tags" options={normalizedAvailable.map(id => ({ value: id, label: id }))} />
      </Form.Item>
      <Alert
        showIcon
        type={blocksPublish ? 'error' : 'success'}
        title={blocksPublish ? '缺失依赖将阻止发布' : '依赖校验通过'}
        description={blocksPublish ? `缺失依赖：${missing.join('、')}` : '当前依赖均在组件库中。'}
      />
      <div className="dependency-list">
        {deps.length ? deps.map(dep => (
          <div className="dependency-row" key={dep}>
            <span>{dep}</span>
            <Tag color={missing.includes(dep) ? 'red' : 'green'}>{missing.includes(dep) ? '缺失' : '可用'}</Tag>
          </div>
        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无组件依赖" />}
      </div>
      <Typography.Text type={blocksPublish ? 'danger' : 'secondary'}>
        发布阻断：{blocksPublish ? '是' : '否'}
      </Typography.Text>
    </Space>
  );
}

export function ComponentEditor({ component, availableIds = [], onSave }: EditorProps) {
  const [form] = Form.useForm<Partial<ComponentDef>>();
  const [activeSection, setActiveSection] = useState('basic');
  useEffect(() => {
    if (component) form.setFieldsValue(component);
  }, [component, form]);
  const handleSave = (value: Partial<ComponentDef>) => {
    const deps = [...new Set([...(value.depends_on || []), ...(value.dependencies || [])])];
    const currentId = String(value.component_id || component?.component_id || '');
    const missing = deps.filter(dep => dep !== currentId && !availableIds.includes(dep));
    onSave({
      ...value,
      depends_on: deps,
      dependencies: deps,
      validation_result: {
        valid: missing.length === 0,
        errors: missing.map(dep => ({ field: 'depends_on', message: `依赖组件 ${dep} 不存在` })),
      },
    });
  };
  const sections = [
    {
      key: 'basic',
      label: '基础信息',
      children: (
        <Row gutter={12}>
          <Col xs={24} md={12}><Form.Item name="name" label="组件名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="display_name" label="展示名称"><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="component_id" label="组件编码" rules={[{ required: true }]}><Input disabled={!!component} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="version" label="版本"><Input /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="category" label="分类"><Input /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="domain" label="领域"><Input /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="status" label="状态"><Select options={statusOptions} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="implemented" label="后端已实现" valuePropName="checked"><Switch /></Form.Item></Col>
          <Col span={24}><Form.Item name="description" label="组件说明"><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} /></Form.Item></Col>
        </Row>
      ),
    },
    { key: 'sets', label: '集合配置', children: <SchemaList name="required_sets" title="集合" /> },
    { key: 'params', label: '参数配置', children: <SchemaList name="parameters" title="参数" /> },
    { key: 'vars', label: '变量配置', children: <SchemaList name="variables" title="变量" /> },
    { key: 'constraints', label: '约束公式', children: <FormulaList form={form} component={component} name="generated_constraints" title="约束公式" /> },
    { key: 'objective', label: '目标项', children: <FormulaList form={form} component={component} name="generated_objective_terms" title="目标项" /> },
    { key: 'binding', label: '参数绑定', children: <BindingList /> },
    { key: 'dependencies', label: '依赖关系', children: <DependencyEditor form={form} component={component} availableIds={availableIds} /> },
  ];
  const currentSection = sections.find(section => section.key === activeSection) || sections[0];
  return (
    <Form id="component-editor-form" form={form} layout="vertical" initialValues={component || { enabled: true, implemented: true, status: 'draft', version: '1.0.0' }} onFinish={handleSave}>
      <div className="component-editor-layout">
        <nav className="component-editor-nav" aria-label="组件编辑分区">
          {sections.map(section => (
            <button
              type="button"
              key={section.key}
              className={section.key === currentSection.key ? 'active' : ''}
              onClick={() => setActiveSection(section.key)}
            >
              {section.label}
            </button>
          ))}
        </nav>
        <section className="component-editor-body">
          <div className="component-editor-section-head">
            <Typography.Title level={5}>{currentSection.label}</Typography.Title>
          </div>
          {currentSection.children}
        </section>
      </div>
    </Form>
  );
}
