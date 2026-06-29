import { MoreOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Collapse, Descriptions, Drawer, Dropdown, Form, Input, Row, Select, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFunctionAsset, getFunctionAssets, importFunctionAssetCsv, previewFunctionAsset, updateFunctionAsset, validateFunctionAsset } from '../../api/functionAssets';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import type { FunctionAsset, FunctionAssetPreview, FunctionAssetValidation } from '../../types/functionAsset';

const starterPoints = [[0, 0], [100, 20], [200, 45]];
const starterCsv = 'storage,level\n1000,245.0\n1200,246.3\n1500,248.1\n';

function parsePoints(raw: string): number[][] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(point => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [Number(point.x), Number(point.y)]);
}

function pointText(points?: number[][]) {
  return JSON.stringify(points && points.length ? points : starterPoints, null, 2);
}

function pointRows(raw?: string) {
  try {
    return parsePoints(raw || '[]').map((point, index) => ({ key: `point_${index}`, x: point[0], y: point[1] }));
  } catch {
    return starterPoints.map((point, index) => ({ key: `point_${index}`, x: point[0], y: point[1] }));
  }
}

function validationColor(status?: string) {
  if (status === 'invalid') return 'red';
  if (status === 'warning') return 'orange';
  return 'green';
}

function validationText(status?: string) {
  if (status === 'invalid') return '异常';
  if (status === 'warning') return '有警告';
  return '正常';
}

function validationItems(items?: Array<Record<string, unknown>>) {
  return (items || []).map((item, index) => ({
    key: `${String(item.field || 'item')}-${index}`,
    field: String(item.field || '曲线断点'),
    message: String(item.message || item.error || '请检查该字段配置'),
    actual: item.actual,
    expected: item.expected,
  }));
}

function validationList(items?: Array<Record<string, unknown>>) {
  const rows = validationItems(items);
  if (!rows.length) return null;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {rows.map(row => (
        <li key={row.key}>
          <Typography.Text strong>{row.field}</Typography.Text>
          <span>：{row.message}</span>
          {row.actual !== undefined && <span>；当前值 {String(row.actual)}</span>}
          {row.expected !== undefined && <span>；期望 {String(row.expected)}</span>}
        </li>
      ))}
    </ul>
  );
}

function parseCsvRows(csvText: string) {
  const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { fields: [] as string[], rows: [] as Record<string, string>[] };
  const fields = lines[0].split(',').map(item => item.trim());
  const rows = lines.slice(1, 21).map(line => {
    const values = line.split(',');
    return Object.fromEntries(fields.map((field, index) => [field, values[index]?.trim() || '']));
  });
  return { fields, rows };
}

function schemaName(asset: FunctionAsset, kind: 'input' | 'output') {
  if (kind === 'input') {
    const first = asset.input_schema?.[0];
    return String(first?.name || first?.code || 'x');
  }
  return String(asset.output_schema?.name || asset.output_schema?.code || 'y');
}

function curveChartOption(asset: FunctionAsset, preview?: FunctionAssetPreview) {
  const originalPoints = (asset.points || []).map(point => [Number(point[0]), Number(point[1])]);
  const previewPoints = (preview?.values || []).map(point => [Number(point.x), Number(point.y)]);
  const series = [
    {
      name: '原始断点',
      type: 'line',
      data: originalPoints,
      symbol: 'circle',
      symbolSize: 8,
      lineStyle: { width: 2 },
    },
    previewPoints.length
      ? {
          name: 'preview 插值点',
          type: 'line',
          data: previewPoints,
          symbol: 'diamond',
          symbolSize: 7,
          lineStyle: { width: 2, type: 'dashed' },
        }
      : undefined,
  ].filter(Boolean);
  return {
    color: ['#1677ff', '#fa8c16'],
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { top: 44, left: 54, right: 18, bottom: 42 },
    xAxis: { type: 'value', name: schemaName(asset, 'input') },
    yAxis: { type: 'value', name: schemaName(asset, 'output') },
    series,
  };
}

export function FunctionAssetsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<FunctionAsset | undefined>();
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [validation, setValidation] = useState<FunctionAssetValidation | undefined>();
  const [preview, setPreview] = useState<FunctionAssetPreview | undefined>();
  const [advancedIdMode, setAdvancedIdMode] = useState(false);
  const [importCsvText, setImportCsvText] = useState(starterCsv);
  const [manualPoints, setManualPoints] = useState(pointRows(pointText(starterPoints)));
  const [pastePointsText, setPastePointsText] = useState('');
  const [form] = Form.useForm();
  const [importForm] = Form.useForm();
  const list = useQuery({ queryKey: ['function-assets'], queryFn: getFunctionAssets });
  const rows = list.data || [];
  const usedCount = rows.filter(item => (item.referenced_by || []).length > 0).length;
  const convexCount = rows.filter(item => item.solve_strategy === 'convex_combination_lp').length;
  const invalidCount = rows.filter(item => item.validation_status === 'invalid').length;

  const done = (text: string) => {
    if (import.meta.env.MODE !== 'test') message.success(text);
    qc.invalidateQueries({ queryKey: ['function-assets'] });
  };

  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const payload = {
        ...values,
        points: manualPoints.map(point => [Number(point.x), Number(point.y)]),
        function_type: 'piecewise_1d' as const,
      };
      delete (payload as Record<string, unknown>).points_json;
      return selected?.function_id ? updateFunctionAsset(selected.function_id, payload) : createFunctionAsset(payload);
    },
    onSuccess: asset => {
      setSelected(asset);
      setEditing(false);
      done('函数资产已保存');
    },
  });

  const importCsv = useMutation({
    mutationFn: (values: Record<string, unknown>) => importFunctionAssetCsv(values),
    onSuccess: asset => {
      setSelected(asset);
      setImporting(false);
      done('CSV 已导入为函数资产草稿');
    },
  });

  const validate = useMutation({
    mutationFn: (asset: FunctionAsset) => validateFunctionAsset(asset.function_id, asset),
    onSuccess: result => {
      setValidation(result);
      if (import.meta.env.MODE !== 'test') {
        message[result.valid ? 'success' : 'warning'](result.valid ? '曲线校验通过' : '曲线校验未通过');
      }
    },
  });

  const runPreview = useMutation({
    mutationFn: (asset: FunctionAsset) => previewFunctionAsset(asset.function_id),
    onSuccess: setPreview,
    onError: error => message.error(String(error)),
  });

  const previewColumns = useMemo(() => [
    { title: 'x', dataIndex: 'x' },
    { title: 'y', dataIndex: 'y' },
  ], []);
  const importPreview = useMemo(() => parseCsvRows(importCsvText), [importCsvText]);

  const applyPastedPoints = () => {
    const rows = pastePointsText.trim().split(/\r?\n/).map((line, index) => {
      const [x, y] = line.split(/[\t,，\s]+/).filter(Boolean);
      return { key: `paste_${Date.now()}_${index}`, x: Number(x), y: Number(y) };
    }).filter(row => Number.isFinite(row.x) && Number.isFinite(row.y));
    if (!rows.length) {
      message.warning('未识别到有效断点，请粘贴两列 x、y 数值');
      return;
    }
    setManualPoints(rows);
    setPastePointsText('');
  };

  const startCreate = () => {
    setSelected(undefined);
    setValidation(undefined);
    setPreview(undefined);
    form.setFieldsValue({
      function_id: `curve_${Date.now()}`,
      name: '新建曲线',
      interpolation: 'linear',
      solve_strategy: 'convex_combination_lp',
      status: 'draft',
      points_json: pointText(starterPoints),
    });
    setManualPoints(pointRows(pointText(starterPoints)));
    setAdvancedIdMode(false);
    setEditing(true);
  };

  const startImport = () => {
    setSelected(undefined);
    setValidation(undefined);
    setPreview(undefined);
    importForm.setFieldsValue({
      function_id: `curve_csv_${Date.now()}`,
      name: 'CSV 导入曲线',
      csv_text: starterCsv,
      x_field: 'storage',
      y_field: 'level',
      solve_strategy: 'convex_combination_lp',
    });
    setImportCsvText(starterCsv);
    setAdvancedIdMode(false);
    setImporting(true);
  };

  const startEdit = (asset: FunctionAsset) => {
    setSelected(asset);
    setValidation(undefined);
    setPreview(undefined);
    form.setFieldsValue({ ...asset, points_json: pointText(asset.points) });
    setManualPoints(pointRows(pointText(asset.points)));
    setAdvancedIdMode(false);
    setEditing(true);
  };

  return (
    <>
      <PageHeader
        title="函数/曲线资产中心"
        description="管理组件化运筹模型可复用的分段线性曲线、公式资产和求解策略。"
        extra={<Space><Button onClick={startImport}>导入 CSV</Button><Button type="primary" onClick={startCreate}>新建曲线</Button></Space>}
      />
      <Row gutter={[14, 14]}>
        <Col xs={24} md={6}><div className="card metric blue"><span>资产总数</span><b>{rows.length}</b><span>已登记函数/曲线</span></div></Col>
        <Col xs={24} md={6}><div className="card metric green"><span>已被引用</span><b>{usedCount}</b><span>模型/组件绑定</span></div></Col>
        <Col xs={24} md={6}><div className="card metric amber"><span>LP 策略</span><b>{convexCount}</b><span>凸组合近似</span></div></Col>
        <Col xs={24} md={6}><div className="card metric red"><span>异常资产</span><b>{invalidCount}</b><span>需要修正</span></div></Col>
      </Row>
      <Card className="content-card section-gap" title="函数与曲线资产">
        <Table<FunctionAsset>
          rowKey="function_id"
          loading={list.isLoading}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 1400 }}
          columns={[
            { title: '名称', render: (_, row) => <Space orientation="vertical" size={0}><Typography.Text strong>{row.name}</Typography.Text><Typography.Text type="secondary">{row.function_id}</Typography.Text></Space> },
            { title: '类型', dataIndex: 'function_type' },
            { title: '校验状态', render: (_, row) => <Tag color={validationColor(row.validation_status)}>{validationText(row.validation_status)}</Tag> },
            { title: '错误数', render: (_, row) => (row.validation_errors || []).length },
            { title: '警告数', render: (_, row) => (row.validation_warnings || []).length },
            { title: '定义域', render: (_, row) => `${row.domain?.x_min ?? '-'} .. ${row.domain?.x_max ?? '-'}` },
            { title: '单调性', dataIndex: 'monotonicity' },
            { title: '求解策略', dataIndex: 'solve_strategy' },
            { title: '状态', dataIndex: 'status', render: value => <StatusTag status={String(value || 'draft')} /> },
            { title: '引用数', render: (_, row) => <Tag color={(row.referenced_by || []).length ? 'blue' : undefined}>{(row.referenced_by || []).length}</Tag> },
            {
              title: '操作',
              fixed: 'right',
              width: 180,
              render: (_, row) => (
                <Space>
                  <Button type="link" onClick={() => { setSelected(row); setEditing(false); setValidation(undefined); setPreview(undefined); }}>查看</Button>
                  <Button type="link" onClick={() => startEdit(row)}>编辑</Button>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'validate', label: '校验曲线' },
                        { key: 'preview', label: '预览插值', disabled: row.validation_status === 'invalid' },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'validate') {
                          setSelected(row);
                          validate.mutate(row);
                        }
                        if (key === 'preview') runPreview.mutate(row);
                      },
                    }}
                  >
                    <Button type="link" icon={<MoreOutlined />}>更多</Button>
                  </Dropdown>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Drawer
        size="large"
        open={editing || importing || !!selected || !!validation || !!preview}
        onClose={() => { setEditing(false); setImporting(false); setSelected(undefined); setValidation(undefined); setPreview(undefined); }}
        title={editing ? '编辑函数资产' : importing ? '导入 CSV 曲线' : selected?.name || '函数资产'}
      >
        {editing ? (
          <Form form={form} layout="vertical" onFinish={values => save.mutate(values)}>
            <Row gutter={12}>
              <Col span={12}>
                {advancedIdMode ? (
                  <Form.Item name="function_id" label="函数 ID" rules={[{ required: true }]}><Input disabled={!!selected} /></Form.Item>
                ) : (
                  <Form.Item name="function_id" hidden><Input /></Form.Item>
                )}
                <Button size="small" onClick={() => setAdvancedIdMode(value => !value)}>{advancedIdMode ? '收起高级设置' : '高级设置：函数 ID 与底层 Schema'}</Button>
              </Col>
              <Col span={12}><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="interpolation" label="插值方式"><Select options={[{ value: 'linear', label: 'linear' }]} /></Form.Item></Col>
              <Col span={12}><Form.Item name="solve_strategy" label="求解策略"><Select options={[
                { value: 'display_only', label: 'display_only - 仅展示' },
                { value: 'convex_combination_lp', label: 'convex_combination_lp - LP 凸组合近似' },
                { value: 'binary_segment_milp', label: 'binary_segment_milp - 实验性，仅诊断' },
              ]} /></Form.Item></Col>
              <Col span={12}><Form.Item name="status" label="状态"><Select options={['draft', 'published', 'trial', 'active'].map(value => ({ value, label: value }))} /></Form.Item></Col>
              <Col span={12}><Form.Item name="description" label="说明"><Input /></Form.Item></Col>
            </Row>
            <Card
              className="section-gap"
              title="曲线数据"
              extra={<Space><Button onClick={() => setManualPoints(points => [...points, { key: `point_${Date.now()}`, x: 0, y: 0 }])}>添加断点</Button><Button onClick={() => setManualPoints(points => [...points].sort((a, b) => Number(a.x) - Number(b.x)))}>按 x 排序</Button></Space>}
            >
              <Form.Item label="批量粘贴断点">
                <Input.TextArea
                  rows={3}
                  value={pastePointsText}
                  onChange={event => setPastePointsText(event.target.value)}
                  placeholder={'0\t0\n100\t20\n200\t45'}
                />
                <Button className="section-gap-tight" onClick={applyPastedPoints}>应用粘贴数据</Button>
              </Form.Item>
              <Table
                size="small"
                pagination={false}
                rowKey="key"
                dataSource={manualPoints}
                columns={[
                  { title: 'x', dataIndex: 'x', render: (_value, row, index) => <Input value={row.x} onChange={event => setManualPoints(points => points.map((item, itemIndex) => itemIndex === index ? { ...item, x: Number(event.target.value) } : item))} /> },
                  { title: 'y', dataIndex: 'y', render: (_value, row, index) => <Input value={row.y} onChange={event => setManualPoints(points => points.map((item, itemIndex) => itemIndex === index ? { ...item, y: Number(event.target.value) } : item))} /> },
                  { title: '操作', width: 90, render: (_value, _row, index) => <Button danger type="link" onClick={() => setManualPoints(points => points.filter((_, itemIndex) => itemIndex !== index))}>删除</Button> },
                ]}
              />
            </Card>
            <Collapse
              className="section-gap"
              items={[{
                key: 'debug',
                label: '高级 JSON 调试',
                children: (
                  <Form.Item name="points_json" label="断点 JSON">
                    <Input.TextArea rows={8} onBlur={event => setManualPoints(pointRows(event.target.value))} />
                  </Form.Item>
                ),
              }]}
            />
            <Space>
              <Button onClick={() => setEditing(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={save.isPending}>保存</Button>
            </Space>
          </Form>
        ) : importing ? (
          <Form form={importForm} layout="vertical" onFinish={values => importCsv.mutate(values)}>
            <Alert
              type="info"
              title="Excel 多 Sheet 与多 group 曲线求解为预留能力"
              description="当前轻量版仅使用第一组曲线参与求解，其余分组仅保存为元数据。"
            />
            <Row gutter={12} className="section-gap">
              <Col span={12}>
                {advancedIdMode ? (
                  <Form.Item name="function_id" label="函数 ID" rules={[{ required: true }]}><Input /></Form.Item>
                ) : (
                  <Form.Item name="function_id" hidden><Input /></Form.Item>
                )}
                <Button size="small" onClick={() => setAdvancedIdMode(value => !value)}>{advancedIdMode ? '收起高级设置' : '高级设置：函数 ID 与底层 Schema'}</Button>
              </Col>
              <Col span={12}><Form.Item name="name" label="资产名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col span={8}><Form.Item name="x_field" label="x 字段" rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col span={8}><Form.Item name="y_field" label="y 字段" rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col span={8}><Form.Item name="group_field" label="分组字段"><Input placeholder="可选" /></Form.Item></Col>
              <Col span={12}><Form.Item name="x_unit" label="x 单位"><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="y_unit" label="y 单位"><Input /></Form.Item></Col>
              <Col span={24}><Form.Item name="solve_strategy" label="求解策略"><Select options={[
                { value: 'display_only', label: 'display_only - 仅展示' },
                { value: 'convex_combination_lp', label: 'convex_combination_lp - LP 凸组合近似' },
              ]} /></Form.Item></Col>
            </Row>
            <Upload
              accept=".csv,text/csv"
              maxCount={1}
              beforeUpload={file => {
                const reader = new FileReader();
                reader.onload = event => {
                  const text = String(event.target?.result || '');
                  setImportCsvText(text);
                  importForm.setFieldValue('csv_text', text);
                  const parsed = parseCsvRows(text);
                  importForm.setFieldsValue({ x_field: parsed.fields[0], y_field: parsed.fields[1] });
                };
                reader.readAsText(file);
                return false;
              }}
            >
              <Button>选择 CSV 文件</Button>
            </Upload>
            <Form.Item className="section-gap" name="csv_text" label="CSV 内容（调试备用）" rules={[{ required: true }]}>
              <Input.TextArea rows={6} onChange={event => setImportCsvText(event.target.value)} />
            </Form.Item>
            <Card size="small" title="数据预览与字段识别">
              <Descriptions size="small" column={3} items={[
                { key: 'fields', label: '识别字段', children: importPreview.fields.join('、') || '-' },
                { key: 'x', label: 'x 字段', children: importForm.getFieldValue('x_field') || importPreview.fields[0] || '-' },
                { key: 'y', label: 'y 字段', children: importForm.getFieldValue('y_field') || importPreview.fields[1] || '-' },
              ]} />
              <Table className="section-gap" size="small" pagination={false} rowKey={row => JSON.stringify(row)} dataSource={importPreview.rows} columns={importPreview.fields.map(field => ({ title: field, dataIndex: field }))} scroll={{ x: 700 }} />
            </Card>
            <Space>
              <Button onClick={() => setImporting(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={importCsv.isPending}>导入为草稿</Button>
            </Space>
          </Form>
        ) : selected ? (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="函数 ID">{selected.function_id}</Descriptions.Item>
              <Descriptions.Item label="类型">{selected.function_type}</Descriptions.Item>
              <Descriptions.Item label="校验状态"><Tag color={validationColor(selected.validation_status)}>{validationText(selected.validation_status)}</Tag></Descriptions.Item>
              <Descriptions.Item label="定义域">{selected.domain?.x_min ?? '-'} .. {selected.domain?.x_max ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="求解策略">{selected.solve_strategy}</Descriptions.Item>
              <Descriptions.Item label="单调性">{selected.monotonicity || '-'}</Descriptions.Item>
              <Descriptions.Item label="凸性">{selected.convexity || String(selected.diagnostics?.convexity || '-')}</Descriptions.Item>
              <Descriptions.Item label="引用数">{(selected.referenced_by || []).length}</Descriptions.Item>
            </Descriptions>
            <Card size="small" title="曲线诊断">
              <Descriptions size="small" column={3} items={[
                { key: 'count', label: '断点数量', children: selected.domain?.breakpoint_count ?? selected.points?.length ?? '-' },
                { key: 'domain', label: '定义域', children: `${selected.domain?.x_min ?? '-'} .. ${selected.domain?.x_max ?? '-'}` },
                { key: 'range', label: '值域', children: `${selected.domain?.y_min ?? '-'} .. ${selected.domain?.y_max ?? '-'}` },
                { key: 'monotonicity', label: '单调性', children: selected.monotonicity || '-' },
                { key: 'convexity', label: '凸性', children: selected.convexity || String(selected.diagnostics?.convexity || '-') },
                { key: 'strategy', label: '推荐策略', children: selected.solve_strategy || 'display_only' },
              ]} />
              {['unknown', 'nonconvex'].includes(String(selected.convexity || selected.diagnostics?.convexity || '')) && (
                <Alert className="section-gap" type="warning" showIcon title="凸组合风险" description="当前曲线可能存在凸包松弛风险，结果可能不严格落在原始折线上。" />
              )}
            </Card>
            {(selected.validation_errors || []).length > 0 && <Alert type="error" title="校验错误" description={validationList(selected.validation_errors)} />}
            {(selected.validation_warnings || []).length > 0 && <Alert type="warning" title="校验警告" description={validationList(selected.validation_warnings)} />}
            {validation && <Alert type={validation.valid ? 'success' : 'error'} showIcon title={validation.valid ? '校验通过' : '校验失败'} description={validation.valid ? '函数/曲线资产可用于模型绑定。' : validationList(validation.errors)} />}
            {selected.validation_status !== 'invalid' && (selected.points || []).length > 0 && (
              <Card size="small" title="曲线图预览">
                <ReactECharts option={curveChartOption(selected, preview)} style={{ height: 280 }} />
              </Card>
            )}
            {selected.validation_status !== 'invalid' && preview && <Table rowKey="x" size="small" pagination={false} dataSource={preview.values} columns={previewColumns} />}
            {(selected.referenced_by || []).length > 0 && (
              <Table
                size="small"
                pagination={false}
                rowKey={row => `${row.model_id || ''}-${row.component_id || row.component || row.parameter || ''}-${row.constraint_id || row.referenced_at || ''}`}
                dataSource={selected.referenced_by || []}
                columns={[
                  { title: '模型', dataIndex: 'model_name' },
                  { title: '模型 ID', dataIndex: 'model_id' },
                  { title: '引用组件', render: (_, row) => row.component_id || row.component || row.parameter || '-' },
                  { title: '引用时间', dataIndex: 'referenced_at' },
                ]}
              />
            )}
            <Collapse
              items={[{
                key: 'debug',
                label: '高级调试',
                children: <Typography.Text code>{JSON.stringify({ points: selected.points, validation, diagnostics: selected.diagnostics, metadata: selected.metadata }, null, 2)}</Typography.Text>,
              }]}
            />
            <Space>
              <Button aria-label="编辑" onClick={() => startEdit(selected)}>编辑</Button>
              <Button aria-label="校验" onClick={() => validate.mutate(selected)}>校验</Button>
              <Button aria-label="预览" type="primary" disabled={selected.validation_status === 'invalid'} onClick={() => runPreview.mutate(selected)}>预览</Button>
            </Space>
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}
