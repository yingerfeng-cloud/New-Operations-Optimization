import { Button, Descriptions, Drawer, Form, Input, Select, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import type { ModelDraft } from '../stores/modelCreationStore';
import type { BindingTarget } from './ComponentDependencyCard';
import { bindingSourceType, hasBindingValue, isBindingComplete } from '../utils/bindingValidation';

function componentName(component?: Record<string, unknown>) {
  if (!component) return '-';
  return String(component.display_name || component.name || component.component_id || component.code || '组件');
}

function bindingCode(binding: Record<string, unknown> | undefined, fallback: string) {
  return String(binding?.component_parameter || binding?.parameter || binding?.parameter_code || binding?.code || fallback);
}

function formatList(value: unknown) {
  return Array.isArray(value) ? value.join(', ') : String(value || '');
}

export function ParameterBindingDrawer({
  draft,
  target,
  open,
  onClose,
  onSave,
}: {
  draft: ModelDraft;
  target?: BindingTarget;
  open: boolean;
  onClose: () => void;
  onSave: (target: BindingTarget, binding: Record<string, unknown>) => void;
}) {
  const [form] = Form.useForm();
  const component = target ? draft.components[target.componentIndex] : undefined;
  const binding = target?.binding;
  const code = bindingCode(binding, target?.parameterCode || '');
  const currentValues = Form.useWatch([], form) || {};
  const draftBinding = {
    ...binding,
    component_parameter: code,
    parameter: code,
    model_parameter: currentValues.model_parameter,
    runtime_key: currentValues.runtime_key,
    function_asset_id: currentValues.function_asset_id,
    source_path: currentValues.source_path,
    value: currentValues.default_value,
    default_value: currentValues.default_value,
    unit: currentValues.unit,
    index_mode: currentValues.index_mode,
    indices: currentValues.index_set ? [currentValues.index_set] : binding?.indices,
  };
  const isBound = isBindingComplete(draftBinding);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      model_parameter: binding?.model_parameter,
      runtime_key: binding?.runtime_key,
      function_asset_id: binding?.function_asset_id,
      source_path: binding?.source_path,
      default_value: binding?.value ?? binding?.default_value ?? binding?.defaultValue ?? binding?.default,
      unit: binding?.unit,
      index_mode: binding?.index_mode || 'by_set',
      index_set: Array.isArray(binding?.indices) ? binding?.indices?.[0] : Array.isArray(binding?.dimension) ? binding?.dimension?.[0] : undefined,
    });
  }, [binding, form, open]);

  const modelParameterOptions = draft.semantic.parameters.map(parameter => ({
    value: parameter.code,
    label: parameter.name ? `${parameter.name} (${parameter.code})` : parameter.code,
  }));
  const setOptions = draft.semantic.sets.map(set => ({
    value: set.code,
    label: set.name ? `${set.name} (${set.code})` : set.code,
  }));
  const functionAssetOptions = [
    ...draft.components.flatMap(component => {
      const rows = Array.isArray(component.function_assets) ? component.function_assets as Array<Record<string, unknown>> : [];
      return rows.map(asset => ({
        value: String(asset.function_asset_id || asset.asset_id || asset.function_id || asset.code || ''),
        label: String(asset.name || asset.display_name || asset.function_asset_id || asset.asset_id || asset.function_id || asset.code || ''),
      })).filter(option => option.value);
    }),
    ...draft.formulas.map(formula => {
      const row = formula as unknown as Record<string, unknown>;
      return {
        value: String(row.function_asset_id || ''),
        label: String(formula.name || row.function_asset_id || ''),
      };
    }).filter(option => option.value),
  ].filter((option, index, all) => all.findIndex(item => item.value === option.value) === index);
  const selectedModelParameter = Form.useWatch('model_parameter', form);
  const selectedRuntimeKey = Form.useWatch('runtime_key', form);
  const selectedDefaultValue = Form.useWatch('default_value', form);
  const sourceType = bindingSourceType(binding || {});
  const selectedSet = Form.useWatch('index_set', form);
  const mappingComplete = isBindingComplete(draftBinding);
  const validationRows = [
    { label: '数据类型匹配', ok: true },
    { label: '索引集合匹配', ok: Boolean(!selectedSet || draft.semantic.sets.some(item => item.code === selectedSet)) },
    { label: sourceType === 'static' ? '静态默认值' : sourceType === 'function_asset' ? '函数资产映射' : '运行参数映射', ok: mappingComplete },
  ];

  const save = (validate = false) => {
    if (!target) return;
    const values = form.getFieldsValue();
    const nextBinding = {
      ...binding,
      component_parameter: code,
      parameter: code,
      model_parameter: values.model_parameter,
      runtime_key: values.runtime_key,
      function_asset_id: values.function_asset_id,
      source_path: values.source_path,
      value: values.default_value,
      default_value: values.default_value,
      unit: values.unit,
      index_mode: values.index_mode,
      indices: values.index_set ? [values.index_set] : binding?.indices,
    };
    const complete = isBindingComplete(nextBinding);
    if (validate && !complete) {
      const fieldName = sourceType === 'static' ? 'default_value' : sourceType === 'function_asset' ? 'function_asset_id' : 'model_parameter';
      form.setFields([
        { name: fieldName, errors: [sourceType === 'static' ? '请填写静态默认值' : sourceType === 'function_asset' ? '请绑定函数资产' : '请选择模型参数或填写运行参数键'] },
      ]);
      return;
    }
    onSave(target, {
      ...nextBinding,
      status: complete ? 'bound' : 'missing',
    });
    onClose();
  };

  return (
    <Drawer
      className="parameter-binding-drawer"
      size="large"
      open={open}
      onClose={onClose}
      title={(
        <div className="parameter-binding-title">
          <div>
            <Typography.Title level={5}>编辑参数绑定</Typography.Title>
            <Typography.Text>{componentName(component)} / {code || '-'}</Typography.Text>
          </div>
          <Tag color={isBound ? 'green' : 'orange'}>{isBound ? '已绑定' : '缺少映射'}</Tag>
        </div>
      )}
      footer={(
        <div className="detail-drawer-footer">
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button onClick={() => save(false)}>保存草稿</Button>
            <Button type="primary" onClick={() => save(true)}>保存并校验</Button>
          </Space>
        </div>
      )}
    >
      <Space orientation="vertical" size={14} style={{ width: '100%' }}>
        <section className="drawer-form-section">
          <Typography.Title level={5}>当前上下文</Typography.Title>
          <Descriptions size="small" column={1} items={[
            { key: 'component', label: '组件', children: componentName(component) },
            { key: 'parameter', label: '参数', children: code || '-' },
            { key: 'type', label: '类型', children: String(binding?.type || binding?.data_type || binding?.value_type || 'float') },
            { key: 'indices', label: '索引', children: formatList(binding?.indices || binding?.dimension) || '-' },
          ]} />
        </section>

        <Form form={form} layout="vertical">
          <section className="drawer-form-section">
            <Typography.Title level={5}>模型参数映射</Typography.Title>
            <Form.Item name="model_parameter" label="映射到模型参数" tooltip="优先选择 Step2 已定义的模型参数。">
              <Select allowClear showSearch options={modelParameterOptions} placeholder="请选择模型参数" />
            </Form.Item>
            <Form.Item name="runtime_key" label="运行参数键">
              <Input placeholder="例如 startup_cost" />
            </Form.Item>
            {sourceType === 'function_asset' && (
              <Form.Item name="function_asset_id" label="函数资产" tooltip="函数资产类型参数必须选择函数/曲线资产。">
                <Select allowClear showSearch options={functionAssetOptions} placeholder="请选择函数资产" />
              </Form.Item>
            )}
            <Form.Item name="default_value" label="默认值">
              <Input placeholder="未提供模型参数时可设置默认值" />
            </Form.Item>
            <Form.Item name="unit" label="单位">
              <Input placeholder="例如 MW、元/次、MWh" />
            </Form.Item>
          </section>

          <section className="drawer-form-section">
            <Typography.Title level={5}>索引集合</Typography.Title>
            <Form.Item name="index_mode" label="索引方式">
              <Select options={[{ value: 'by_set', label: '按集合索引' }, { value: 'scalar', label: '标量参数' }]} />
            </Form.Item>
            <Form.Item name="index_set" label="选择集合">
              <Select allowClear showSearch options={setOptions} placeholder="请选择集合" />
            </Form.Item>
          </section>
        </Form>

        <section className="validation-result-panel">
          <Typography.Title level={5}>校验结果</Typography.Title>
          {validationRows.map(row => (
            <div className={`validation-result-row ${row.ok ? 'ok' : 'warning'}`} key={row.label}>
              {row.ok ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
              <span>{row.label}</span>
            </div>
          ))}
          <Typography.Text type={mappingComplete ? 'success' : 'warning'}>
            {mappingComplete ? `已完成映射${selectedModelParameter ? `：${selectedModelParameter}` : selectedRuntimeKey ? `：${selectedRuntimeKey}` : hasBindingValue(selectedDefaultValue) ? '：静态默认值' : ''}` : `仍缺少 ${code || '组件参数'} 的必填映射`}
          </Typography.Text>
        </section>
      </Space>
    </Drawer>
  );
}
