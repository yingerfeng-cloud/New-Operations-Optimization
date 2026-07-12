import { MoreOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Collapse, Descriptions, Drawer, Dropdown, Form, Input, InputNumber, Row, Select, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { checkFunctionAssetApiReady, createFunctionAsset, getFunctionAssets, importFunctionAssetCsv, previewFunctionAsset, updateFunctionAsset, validateFunctionAsset } from '../../api/functionAssets';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { MetricCard, MetricGrid } from '../../components/WorkspaceUI';
import type { FunctionAsset, FunctionAssetPreview, FunctionAssetValidation } from '../../types/functionAsset';

type ManualPoint = { key: string; x: number; y: number; z?: number };

const samplePoints1d = [[0, 0], [100, 20], [200, 45]];
const samplePoints2d = [[0, 0, 1], [10, 0, 21], [0, 10, 31], [10, 10, 51]];
const sampleCsv1d = 'storage,level\n1000,245.0\n1200,246.3\n1500,248.1\n';
const sampleCsv2d = 'flow,head,power\n0,0,1\n10,0,21\n0,10,31\n10,10,51\n';

function pointText(points?: number[][]) {
  return JSON.stringify(points || [], null, 2);
}

function pointRows(points?: number[][]): ManualPoint[] {
  return (points || []).map((point, index) => ({
    key: `point_${index}`,
    x: Number(point[0]),
    y: Number(point[1]),
    z: point[2] === undefined ? undefined : Number(point[2]),
  }));
}

function parsePointText(raw: string): ManualPoint[] {
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((point, index) => Array.isArray(point)
      ? { key: `json_${index}`, x: Number(point[0]), y: Number(point[1]), z: point[2] === undefined ? undefined : Number(point[2]) }
      : { key: `json_${index}`, x: Number(point.x), y: Number(point.y), z: point.z === undefined ? undefined : Number(point.z) })
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function parseCsvRows(csvText: string) {
  const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { fields: [] as string[], rows: [] as Record<string, string>[] };
  const fields = lines[0].split(',').map(item => item.trim()).filter(Boolean);
  const rows = lines.slice(1, 21).map(line => {
    const values = line.split(',');
    return Object.fromEntries(fields.map((field, index) => [field, values[index]?.trim() || '']));
  });
  return { fields, rows };
}

function pickRecommendedFields(fields: string[], type: FunctionAsset['function_type']) {
  if (!fields.length) return { x_field: undefined, y_field: undefined, z_field: undefined };
  const lower = new Map(fields.map(field => [field.toLowerCase(), field]));
  const first = (...names: string[]) => names.map(name => lower.get(name)).find(Boolean);
  return {
    x_field: first('x', 'flow', 'storage', 'volume') || fields[0],
    y_field: first('y', 'head', 'level') || fields[1],
    z_field: type === 'piecewise_2d' ? first('z', 'power', 'value') || fields[2] : undefined,
  };
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

function functionTypeText(type?: string) {
  if (type === 'piecewise_2d') return '二维曲面';
  if (type === 'piecewise_1d') return '一维曲线';
  return type || '-';
}

function hydroAssetLabel(id?: string, name?: string) {
  const map: Record<string, string> = {
    cascade_hydro_level_storage_v1: '水位库容曲线',
    cascade_hydro_tailwater_outflow_v1: '尾水位流量曲线',
    cascade_hydro_power_surface_v1: '水电出力二维曲面',
  };
  return map[String(id || '')] || name || id || '-';
}

function isHydroDemoAsset(asset?: FunctionAsset) {
  return ['cascade_hydro_level_storage_v1', 'cascade_hydro_tailwater_outflow_v1', 'cascade_hydro_power_surface_v1'].includes(String(asset?.function_id || ''));
}

function solveStrategyText(strategy?: string) {
  const map: Record<string, string> = {
    display_only: '仅展示',
    convex_combination_lp: 'LP 凸组合',
    convex_hull_lp_approx: 'LP 凸包近似',
    binary_segment_milp: 'MILP 分段',
    triangulated_milp_exact: 'MILP 三角剖分',
  };
  return map[String(strategy || '')] || String(strategy || '-');
}

function validationList(items?: Array<Record<string, unknown>>) {
  const rows = (items || []).map((item, index) => ({
    key: `${String(item.field || 'item')}-${index}`,
    field: validationFieldText(item.field),
    message: validationMessageText(item.message || item.error),
    actual: item.actual,
    expected: item.expected,
  }));
  if (!rows.length) return null;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {rows.map(row => (
        <li key={row.key}>
          <Typography.Text strong>{row.field}</Typography.Text>
          <span>：{row.message}</span>
          {row.actual !== undefined && <span>；当前值 {formatValidationActual(row.actual)}</span>}
          {row.expected !== undefined && <span>；期望 {formatValidationActual(row.expected)}</span>}
        </li>
      ))}
    </ul>
  );
}

function validationFieldText(value: unknown) {
  const map: Record<string, string> = {
    points: '曲线点',
    points_2d: '二维曲面点',
    triangles: '三角剖分',
    solve_strategy: '求解策略',
    monotonicity: '单调性',
  };
  const text = String(value || '字段');
  return map[text] || text;
}

function validationMessageText(value: unknown) {
  const map: Record<string, string> = {
    'regular grid has missing points': '规则网格点不完整。当前二维曲面仍可按已提供三角形参与求解；如果想按完整规则网格自动三角剖分，请补齐缺失的 x/y 组合。',
    'non-grid scattered 2D points require user-provided triangles for solve participation': '非规则散点需要提供三角形索引，才能参与求解。',
    'piecewise_2d requires at least three [x, y, z] points': '二维曲面至少需要 3 个 [x, y, z] 点。',
    'duplicate (x,y) point is not allowed': '不允许重复的 (x, y) 点。',
    'convex_hull_lp_approx is not an exact representation for general 2D surfaces': '凸包 LP 近似不能精确表示一般二维曲面。',
    '2D PWL point count exceeds the default recommended limit of 200': '二维 PWL 点数超过默认建议上限 200。',
    '2D PWL triangle count exceeds the default recommended limit of 400': '二维 PWL 三角形数量超过默认建议上限 400。',
  };
  const text = String(value || '请检查该字段配置');
  return map[text] || text;
}

function formatValidationActual(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(item => Array.isArray(item) ? `(${item.join(', ')})` : String(item)).join('、');
  }
  return String(value);
}

function schemaName(asset: FunctionAsset, kind: 'input' | 'output', index = 0) {
  if (kind === 'input') {
    const field = asset.input_schema?.[index];
    return String(field?.name || field?.code || (index === 0 ? 'x' : 'y'));
  }
  return String(asset.output_schema?.name || asset.output_schema?.code || 'z');
}

function curveChartOption(asset: FunctionAsset, preview?: FunctionAssetPreview) {
  const originalPoints = (asset.points || []).map(point => [Number(point[0]), Number(point[1])]);
  const previewPoints = (preview?.values || []).map(point => [Number(point.x), Number(point.y)]);
  return {
    color: ['#1677ff', '#fa8c16'],
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { top: 44, left: 54, right: 18, bottom: 42 },
    xAxis: { type: 'value', name: schemaName(asset, 'input') },
    yAxis: { type: 'value', name: schemaName(asset, 'output') },
    series: [
      { name: '原始断点', type: 'line', data: originalPoints, symbol: 'circle', symbolSize: 8, lineStyle: { width: 2 } },
      previewPoints.length ? { name: 'preview 插值点', type: 'line', data: previewPoints, symbol: 'diamond', symbolSize: 7, lineStyle: { width: 2, type: 'dashed' } } : undefined,
    ].filter(Boolean),
  };
}

function surfaceChartOption(asset: FunctionAsset) {
  const points = asset.points_2d || [];
  const triangles = asset.triangles || [];
  const zValues = points.map(point => Number(point[2])).filter(Number.isFinite);
  const edgeData = triangles.flatMap(triangle => {
    const vertices = triangle.map(index => points[index]).filter(Boolean);
    if (vertices.length !== 3) return [];
    return [
      [[vertices[0][0], vertices[0][1]], [vertices[1][0], vertices[1][1]]],
      [[vertices[1][0], vertices[1][1]], [vertices[2][0], vertices[2][1]]],
      [[vertices[2][0], vertices[2][1]], [vertices[0][0], vertices[0][1]]],
    ];
  });
  return {
    tooltip: { formatter: (params: { data?: number[] }) => params.data ? `x=${params.data[0]}<br/>y=${params.data[1]}<br/>z=${params.data[2]}` : '' },
    visualMap: zValues.length ? { min: Math.min(...zValues), max: Math.max(...zValues), dimension: 2, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: ['#2f54eb', '#13c2c2', '#fadb14', '#fa541c'] } } : undefined,
    grid: { top: 24, left: 54, right: 18, bottom: 64 },
    xAxis: { type: 'value', name: schemaName(asset, 'input', 0) },
    yAxis: { type: 'value', name: schemaName(asset, 'input', 1) },
    series: [
      { name: 'z 值', type: 'scatter', data: points.map(point => [Number(point[0]), Number(point[1]), Number(point[2])]), symbolSize: 10 },
      ...edgeData.map((line, index) => ({ name: `triangle_${index}`, type: 'line', data: line, showSymbol: false, lineStyle: { color: '#595959', width: 1 }, tooltip: { show: false } })),
    ],
  };
}

function is2d(asset?: FunctionAsset) {
  return asset?.function_type === 'piecewise_2d';
}

function boolText(value: unknown) {
  if (value === true || value === 'true') return '是';
  if (value === false || value === 'false') return '否';
  return String(value ?? '-');
}

function triangulationStatusText(value: unknown) {
  const map: Record<string, string> = {
    provided: '已提供三角剖分',
    auto_grid_triangulated: '规则网格自动三角剖分',
    missing: '缺少三角剖分',
    failed: '三角剖分失败',
  };
  const text = String(value || '-');
  return map[text] || text;
}

function generatedId(type: FunctionAsset['function_type']) {
  const prefix = type === 'piecewise_2d' ? 'surface' : 'curve';
  return `${prefix}_${Date.now()}`;
}

export function FunctionAssetsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<FunctionAsset | undefined>();
  const [editing, setEditing] = useState(false);
  const [editingType, setEditingType] = useState<FunctionAsset['function_type']>('piecewise_1d');
  const [importing, setImporting] = useState(false);
  const [importType, setImportType] = useState<FunctionAsset['function_type']>('piecewise_1d');
  const [validation, setValidation] = useState<FunctionAssetValidation | undefined>();
  const [preview, setPreview] = useState<FunctionAssetPreview | undefined>();
  const [importCsvText, setImportCsvText] = useState('');
  const [manualPoints, setManualPoints] = useState<ManualPoint[]>([]);
  const [pastePointsText, setPastePointsText] = useState('');
  const [previewInput, setPreviewInput] = useState({ x: 5, y: 5 });
  const [form] = Form.useForm();
  const [importForm] = Form.useForm();
  const list = useQuery({ queryKey: ['function-assets'], queryFn: getFunctionAssets });
  const rows = list.data || [];
  const sortedRows = useMemo(() => [...rows].sort((a, b) => Number(isHydroDemoAsset(b)) - Number(isHydroDemoAsset(a))), [rows]);
  const importPreview = useMemo(() => parseCsvRows(importCsvText), [importCsvText]);

  const usedCount = rows.filter(item => (item.referenced_by || []).length > 0).length;
  const oneDimCount = rows.filter(item => item.function_type === 'piecewise_1d').length;
  const twoDimCount = rows.filter(item => item.function_type === 'piecewise_2d').length;
  const lpStrategyCount = rows.filter(item => String(item.solve_strategy || '').includes('lp')).length;
  const invalidCount = rows.filter(item => item.validation_status === 'invalid').length;

  const done = (text: string) => {
    if (import.meta.env.MODE !== 'test') message.success(text);
    qc.invalidateQueries({ queryKey: ['function-assets'] });
  };

  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const apiReady = await checkFunctionAssetApiReady();
      if (!apiReady) {
        throw new Error('function_asset_api_not_ready');
      }
      const functionType = String(values.function_type || editingType || 'piecewise_1d') as FunctionAsset['function_type'];
      const payload: Partial<FunctionAsset> & Record<string, unknown> = {
        ...values,
        function_type: functionType,
        input_schema: functionType === 'piecewise_2d'
          ? [
              { code: 'x', name: values.x_name || 'x', unit: values.x_unit || '', type: 'number' },
              { code: 'y', name: values.y_name || 'y', unit: values.y_unit || '', type: 'number' },
            ]
          : [{ code: 'x', name: values.x_name || 'x', unit: values.x_unit || '', type: 'number' }],
        output_schema: { code: functionType === 'piecewise_2d' ? 'z' : 'y', name: values.z_name || (functionType === 'piecewise_2d' ? 'z' : 'y'), unit: values.z_unit || '', type: 'number' },
        points: functionType === 'piecewise_2d' ? [] : manualPoints.map(point => [Number(point.x), Number(point.y)]),
        points_2d: functionType === 'piecewise_2d' ? manualPoints.map(point => [Number(point.x), Number(point.y), Number(point.z)]) : [],
      };
      delete payload.points_json;
      delete payload.x_name;
      delete payload.x_unit;
      delete payload.y_name;
      delete payload.y_unit;
      delete payload.z_name;
      delete payload.z_unit;
      return selected?.function_id ? updateFunctionAsset(selected.function_id, payload) : createFunctionAsset(payload);
    },
    onSuccess: asset => {
      setSelected(undefined);
      setEditing(false);
      done('函数资产已保存');
    },
    onError: () => {
      message.error('函数资产保存失败，请确认 FastAPI 后端已启动且版本为最新');
    },
  });

  const importCsv = useMutation({
    mutationFn: (values: Record<string, unknown>) => importFunctionAssetCsv({ ...values, function_type: importType }),
    onSuccess: asset => {
      setSelected(asset);
      setImporting(false);
      done('CSV 已导入为函数资产');
    },
  });

  const validate = useMutation({
    mutationFn: (asset: FunctionAsset) => validateFunctionAsset(asset.function_id, asset),
    onSuccess: result => setValidation(result),
  });

  const runPreview = useMutation({
    mutationFn: (asset: FunctionAsset) => previewFunctionAsset(asset.function_id, is2d(asset) ? previewInput : undefined),
    onSuccess: setPreview,
    onError: error => message.error(String(error)),
  });

  const previewColumns = useMemo(() => [{ title: 'x', dataIndex: 'x' }, { title: 'y', dataIndex: 'y' }], []);

  const validatePointCount = (type: FunctionAsset['function_type']) => {
    if (type === 'piecewise_2d') {
      if (manualPoints.length < 3) {
        message.warning('二维曲面至少需要 3 个点，规则网格建议至少 4 个点。');
        return false;
      }
      if (manualPoints.some(point => !Number.isFinite(point.z))) {
        message.warning('二维曲面每个点都必须包含 z 值。');
        return false;
      }
      return true;
    }
    if (manualPoints.length < 2) {
      message.warning('一维曲线至少需要 2 个点。');
      return false;
    }
    return true;
  };

  const submitAsset = (values: Record<string, unknown>) => {
    const type = String(values.function_type || editingType) as FunctionAsset['function_type'];
    if (!validatePointCount(type)) return;
    save.mutate(values);
  };

  const submitCsv = (values: Record<string, unknown>) => {
    if (!String(values.csv_text || '').trim()) {
      message.warning('请上传 CSV 文件或粘贴 CSV 内容');
      return;
    }
    importCsv.mutate(values);
  };

  const applyPastedPoints = () => {
    const parsed = pastePointsText.trim().split(/\r?\n/).map((line, index) => {
      const [x, y, z] = line.split(/[\t,\s]+/).filter(Boolean);
      return { key: `paste_${Date.now()}_${index}`, x: Number(x), y: Number(y), z: z === undefined ? undefined : Number(z) };
    }).filter(row => Number.isFinite(row.x) && Number.isFinite(row.y));
    if (!parsed.length) {
      message.warning('未识别到有效点，请粘贴 x/y 或 x/y/z 数据');
      return;
    }
    setManualPoints(parsed);
    form.setFieldValue('points_json', pointText(parsed.map(point => editingType === 'piecewise_2d' ? [point.x, point.y, point.z ?? 0] : [point.x, point.y])));
    setPastePointsText('');
  };

  const setCommonFormValues = (type: FunctionAsset['function_type'], points: number[][], values: Record<string, unknown>) => {
    setEditingType(type);
    form.resetFields();
    form.setFieldsValue({
      function_type: type,
      interpolation: 'linear',
      status: 'draft',
      solve_strategy: type === 'piecewise_2d' ? 'triangulated_milp_exact' : 'convex_combination_lp',
      x_name: 'x',
      y_name: type === 'piecewise_2d' ? 'y' : undefined,
      z_name: type === 'piecewise_2d' ? 'z' : 'y',
      points_json: pointText(points),
      ...values,
    });
    setManualPoints(pointRows(points));
    setEditing(true);
  };

  const startCreate = () => {
    setSelected(undefined);
    setValidation(undefined);
    setPreview(undefined);
    setPastePointsText('');
    setCommonFormValues('piecewise_1d', [], { function_id: generatedId('piecewise_1d'), name: '' });
  };

  const onEditTypeChange = (type: FunctionAsset['function_type']) => {
    setEditingType(type);
    form.setFieldsValue({
      function_type: type,
      function_id: selected ? selected.function_id : generatedId(type),
      solve_strategy: type === 'piecewise_2d' ? 'triangulated_milp_exact' : 'convex_combination_lp',
      y_name: type === 'piecewise_2d' ? 'y' : undefined,
      z_name: type === 'piecewise_2d' ? 'z' : 'y',
    });
    if (!selected) {
      setManualPoints([]);
      form.setFieldValue('points_json', pointText([]));
    } else {
      const points = selected.function_type === 'piecewise_2d' ? selected.points_2d : selected.points;
      setManualPoints(pointRows(points));
      form.setFieldValue('points_json', pointText(points));
    }
  };

  const fillSamplePoints = () => {
    const points = editingType === 'piecewise_2d' ? samplePoints2d : samplePoints1d;
    setManualPoints(pointRows(points));
    form.setFieldValue('points_json', pointText(points));
  };

  const startEdit = (asset: FunctionAsset) => {
    setSelected(asset);
    setValidation(undefined);
    setPreview(undefined);
    setPastePointsText('');
    const type = asset.function_type || 'piecewise_1d';
    const points = type === 'piecewise_2d' ? (asset.points_2d || []) : (asset.points || []);
    const xMeta = asset.input_schema?.[0] || {};
    const yMeta = type === 'piecewise_2d' ? (asset.input_schema?.[1] || {}) : {};
    setCommonFormValues(type, points, {
      ...asset,
      x_name: xMeta.name || xMeta.code || 'x',
      x_unit: xMeta.unit || '',
      y_name: type === 'piecewise_2d' ? (yMeta.name || yMeta.code || 'y') : undefined,
      y_unit: type === 'piecewise_2d' ? (yMeta.unit || '') : undefined,
      z_name: asset.output_schema?.name || asset.output_schema?.code || (type === 'piecewise_2d' ? 'z' : 'y'),
      z_unit: asset.output_schema?.unit || '',
      points_json: pointText(points),
    });
  };

  const startImport = () => {
    setSelected(undefined);
    setValidation(undefined);
    setPreview(undefined);
    setImportType('piecewise_1d');
    setImportCsvText('');
    importForm.resetFields();
    importForm.setFieldsValue({
      function_id: generatedId('piecewise_1d'),
      name: '',
      function_type: 'piecewise_1d',
      csv_text: '',
      x_field: undefined,
      y_field: undefined,
      z_field: undefined,
      solve_strategy: 'convex_combination_lp',
    });
    setImporting(true);
  };

  const applyCsvText = (text: string, type = importType) => {
    const parsed = parseCsvRows(text);
    const recommendations = text.trim() ? pickRecommendedFields(parsed.fields, type) : { x_field: undefined, y_field: undefined, z_field: undefined };
    setImportCsvText(text);
    importForm.setFieldsValue({ csv_text: text, ...recommendations });
  };

  const onImportTypeChange = (type: FunctionAsset['function_type']) => {
    setImportType(type);
    const parsed = parseCsvRows(importCsvText);
    const recommendations = importCsvText.trim() ? pickRecommendedFields(parsed.fields, type) : { x_field: undefined, y_field: undefined, z_field: undefined };
    importForm.setFieldsValue({
      function_type: type,
      function_id: generatedId(type),
      solve_strategy: type === 'piecewise_2d' ? 'triangulated_milp_exact' : 'convex_combination_lp',
      ...recommendations,
    });
  };

  const fillCsvSample = (type: FunctionAsset['function_type']) => {
    setImportType(type);
    const text = type === 'piecewise_2d' ? sampleCsv2d : sampleCsv1d;
    importForm.setFieldsValue({
      function_type: type,
      function_id: generatedId(type),
      solve_strategy: type === 'piecewise_2d' ? 'triangulated_milp_exact' : 'convex_combination_lp',
    });
    applyCsvText(text, type);
  };

  const editingStrategyOptions = editingType === 'piecewise_2d'
    ? [
        { value: 'display_only', label: solveStrategyText('display_only') },
        { value: 'triangulated_milp_exact', label: solveStrategyText('triangulated_milp_exact') },
        { value: 'convex_hull_lp_approx', label: solveStrategyText('convex_hull_lp_approx') },
      ]
    : [
        { value: 'display_only', label: solveStrategyText('display_only') },
        { value: 'convex_combination_lp', label: solveStrategyText('convex_combination_lp') },
        { value: 'binary_segment_milp', label: solveStrategyText('binary_segment_milp') },
      ];
  const importStrategyOptions = importType === 'piecewise_2d'
    ? [
        { value: 'display_only', label: solveStrategyText('display_only') },
        { value: 'triangulated_milp_exact', label: solveStrategyText('triangulated_milp_exact') },
        { value: 'convex_hull_lp_approx', label: solveStrategyText('convex_hull_lp_approx') },
      ]
    : [
        { value: 'display_only', label: solveStrategyText('display_only') },
        { value: 'convex_combination_lp', label: solveStrategyText('convex_combination_lp') },
        { value: 'binary_segment_milp', label: solveStrategyText('binary_segment_milp') },
      ];

  const surfaceDiagnostics = selected?.surface_diagnostics || selected?.diagnostics || {};
  const drawerTitle = editing ? (selected ? '编辑函数资产' : '新建函数资产') : importing ? '导入 CSV 函数资产' : selected?.name || '函数资产';
  const drawerRuntimeProps = import.meta.env.MODE === 'test'
    ? { destroyOnHidden: true, getContainer: false as const }
    : { destroyOnHidden: true };

  return (
    <>
      <PageHeader
        title="函数/曲线资产中心"
        description="管理组件化运筹模型可复用的分段线性曲线、二维曲面和求解策略。"
        extra={<Space><Button onClick={startImport}>导入 CSV</Button><Button type="primary" onClick={startCreate}>新建函数资产</Button></Space>}
      />
      <MetricGrid>
        <MetricCard title="资产总数" value={rows.length} description={`${oneDimCount} 条一维曲线 / ${twoDimCount} 个二维曲面`} tone="blue" />
        <MetricCard title="已被引用" value={usedCount} description="模型/组件绑定" tone="green" />
        <MetricCard title="LP 策略" value={lpStrategyCount} description="分段线性与凸组合策略" tone="purple" />
        <MetricCard title="异常资产" value={invalidCount} description={invalidCount ? '需要修正' : '暂无异常'} tone={invalidCount ? 'red' : 'neutral'} />
      </MetricGrid>

      <Card className="content-card section-gap" title="函数与曲线资产">
        <Table<FunctionAsset>
          rowKey="function_id"
          loading={list.isLoading}
          dataSource={sortedRows}
          pagination={false}
          columns={[
            { title: '名称', render: (_, row) => <Space orientation="vertical" size={0}><Typography.Text strong>{hydroAssetLabel(row.function_id, row.name)}</Typography.Text><Typography.Text type="secondary">{row.function_id}</Typography.Text>{isHydroDemoAsset(row) && <Tag color="geekblue">水电调度演示资产</Tag>}</Space> },
            { title: '类型', render: (_, row) => functionTypeText(row.function_type) },
            { title: '校验状态', render: (_, row) => <Tag color={validationColor(row.validation_status)}>{validationText(row.validation_status)}</Tag> },
            { title: '求解策略', render: (_, row) => solveStrategyText(row.solve_strategy) },
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
                        { key: 'validate', label: '校验' },
                        { key: 'preview', label: '预览', disabled: row.validation_status === 'invalid' },
                      ],
                      onClick: ({ key }) => {
                        setSelected(row);
                        if (key === 'validate') validate.mutate(row);
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
        title={drawerTitle}
        {...drawerRuntimeProps}
      >
        {editing ? (
          <Form form={form} layout="vertical" onFinish={submitAsset}>
            <Row gutter={12}>
              <Col span={24}>
                <Form.Item name="function_type" label="函数类型" rules={[{ required: true }]}>
                  <Select
                    disabled={!!selected}
                    options={[
                      { value: 'piecewise_1d', label: '一维曲线 y=f(x)' },
                      { value: 'piecewise_2d', label: '二维曲面 z=f(x,y)' },
                    ]}
                    onChange={onEditTypeChange}
                  />
                </Form.Item>
              </Col>
              <Col span={12}><Form.Item name="name" label="资产名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="solve_strategy" label="求解策略" rules={[{ required: true }]}><Select options={editingStrategyOptions} /></Form.Item></Col>
              <Col span={24}><Typography.Text strong>输入字段</Typography.Text></Col>
              <Col span={12}><Form.Item name="x_name" label="x 名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="x_unit" label="x 单位"><Input /></Form.Item></Col>
              {editingType === 'piecewise_2d' && <Col span={12}><Form.Item name="y_name" label="y 名称" rules={[{ required: true }]}><Input /></Form.Item></Col>}
              {editingType === 'piecewise_2d' && <Col span={12}><Form.Item name="y_unit" label="y 单位"><Input /></Form.Item></Col>}
              <Col span={24}><Typography.Text strong>输出字段</Typography.Text></Col>
              <Col span={12}><Form.Item name="z_name" label={editingType === 'piecewise_2d' ? 'z 名称' : '输出 y 名称'} rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="z_unit" label={editingType === 'piecewise_2d' ? 'z 单位' : '输出 y 单位'}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="status" label="状态"><Select options={['draft', 'published', 'trial', 'active'].map(value => ({ value, label: value }))} /></Form.Item></Col>
              <Col span={24}><Form.Item name="description" label="说明"><Input /></Form.Item></Col>
            </Row>
            <Collapse
              className="section-gap"
              items={[{
                key: 'advanced',
                label: '高级配置',
                children: (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      title="自定义技术标识"
                      description="函数 ID 是系统技术标识，默认自动生成；仅在需要外部 API、模型模板或组件绑定时手工修改。"
                    />
                    <Form.Item className="section-gap" name="function_id" label="函数 ID" rules={[{ required: true }]}><Input disabled={!!selected} /></Form.Item>
                  </>
                ),
              }]}
            />
            <Card
              className="section-gap"
              title={editingType === 'piecewise_2d' ? '二维曲面数据 points_2d' : '一维曲线数据 points'}
              extra={<Space><Button onClick={() => setManualPoints(points => [...points, { key: `point_${Date.now()}`, x: 0, y: 0, z: editingType === 'piecewise_2d' ? 0 : undefined }])}>添加点</Button><Button onClick={fillSamplePoints}>填充示例数据</Button><Button onClick={() => setManualPoints(points => [...points].sort((a, b) => Number(a.x) - Number(b.x)))}>按 x 排序</Button></Space>}
            >
              <Alert
                className="section-gap-tight"
                type="info"
                showIcon
                title={editingType === 'piecewise_2d' ? '二维曲面至少需要 3 个点，规则网格建议至少 4 个点。' : '一维曲线至少需要 2 个点。'}
              />
              <Form.Item label="批量粘贴点">
                <Input.TextArea rows={3} value={pastePointsText} onChange={event => setPastePointsText(event.target.value)} placeholder={editingType === 'piecewise_2d' ? '0 0 1\n10 0 21\n0 10 31' : '0 0\n100 20\n200 45'} />
                <Button className="section-gap-tight" onClick={applyPastedPoints}>应用粘贴数据</Button>
              </Form.Item>
              <Table
                size="small"
                pagination={false}
                rowKey="key"
                locale={{ emptyText: '暂无点数据，请添加点或粘贴数据' }}
                dataSource={manualPoints}
                columns={[
                  { title: 'x', dataIndex: 'x', render: (_value, row, index) => <InputNumber value={row.x} onChange={value => setManualPoints(points => points.map((item, itemIndex) => itemIndex === index ? { ...item, x: Number(value) } : item))} /> },
                  { title: editingType === 'piecewise_2d' ? 'y' : '输出 y', dataIndex: 'y', render: (_value, row, index) => <InputNumber value={row.y} onChange={value => setManualPoints(points => points.map((item, itemIndex) => itemIndex === index ? { ...item, y: Number(value) } : item))} /> },
                  ...(editingType === 'piecewise_2d' ? [{ title: 'z', dataIndex: 'z', render: (_value: unknown, row: ManualPoint, index: number) => <InputNumber value={row.z} onChange={value => setManualPoints(points => points.map((item, itemIndex) => itemIndex === index ? { ...item, z: Number(value) } : item))} /> }] : []),
                  { title: '操作', width: 90, render: (_value, _row, index) => <Button danger type="link" onClick={() => setManualPoints(points => points.filter((_, itemIndex) => itemIndex !== index))}>删除</Button> },
                ]}
              />
            </Card>
            <Collapse className="section-gap" items={[{ key: 'debug', label: '高级 JSON 调试', children: <Form.Item name="points_json" label="点 JSON"><Input.TextArea rows={8} onBlur={event => setManualPoints(parsePointText(event.target.value))} /></Form.Item> }]} />
            <Space><Button onClick={() => setEditing(false)}>取消</Button><Button type="primary" htmlType="submit" loading={save.isPending}>保存</Button></Space>
          </Form>
        ) : importing ? (
          <Form form={importForm} layout="vertical" onFinish={submitCsv}>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="name" label="资产名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="function_type" label="函数类型" rules={[{ required: true }]}><Select options={[{ value: 'piecewise_1d', label: '一维曲线 y=f(x)' }, { value: 'piecewise_2d', label: '二维曲面 z=f(x,y)' }]} onChange={onImportTypeChange} /></Form.Item></Col>
              <Col span={12}><Form.Item name="solve_strategy" label="求解策略"><Select options={importStrategyOptions} /></Form.Item></Col>
              <Col span={importType === 'piecewise_2d' ? 8 : 12}><Form.Item name="x_field" label="x 字段" rules={[{ required: true }]}><Select allowClear showSearch options={importPreview.fields.map(field => ({ value: field, label: field }))} /></Form.Item></Col>
              <Col span={importType === 'piecewise_2d' ? 8 : 12}><Form.Item name="y_field" label="y 字段" rules={[{ required: true }]}><Select allowClear showSearch options={importPreview.fields.map(field => ({ value: field, label: field }))} /></Form.Item></Col>
              {importType === 'piecewise_2d' && <Col span={8}><Form.Item name="z_field" label="z 字段" rules={[{ required: true }]}><Select allowClear showSearch options={importPreview.fields.map(field => ({ value: field, label: field }))} /></Form.Item></Col>}
              <Col span={8}><Form.Item name="x_unit" label="x 单位"><Input /></Form.Item></Col>
              <Col span={8}><Form.Item name="y_unit" label="y 单位"><Input /></Form.Item></Col>
              {importType === 'piecewise_2d' && <Col span={8}><Form.Item name="z_unit" label="z 单位"><Input /></Form.Item></Col>}
            </Row>
            <Collapse
              className="section-gap"
              items={[{
                key: 'advanced',
                label: '高级配置',
                children: (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      title="自定义技术标识"
                      description="函数 ID 是系统技术标识，默认自动生成；仅在需要外部 API、模型模板或组件绑定时手工修改。"
                    />
                    <Form.Item className="section-gap" name="function_id" label="函数 ID" rules={[{ required: true }]}><Input /></Form.Item>
                  </>
                ),
              }]}
            />
            <Space className="section-gap" wrap>
              <Upload
                accept=".csv,text/csv"
                maxCount={1}
                beforeUpload={file => {
                  const reader = new FileReader();
                  reader.onload = event => applyCsvText(String(event.target?.result || ''));
                  reader.readAsText(file);
                  return false;
                }}
              >
                <Button>选择 CSV 文件</Button>
              </Upload>
              <Button onClick={() => fillCsvSample('piecewise_1d')}>填充一维示例</Button>
              <Button onClick={() => fillCsvSample('piecewise_2d')}>填充二维示例</Button>
            </Space>
            <Form.Item className="section-gap" name="csv_text" label="CSV 内容" rules={[{ required: true, message: '请上传 CSV 文件或粘贴 CSV 内容' }]}>
              <Input.TextArea rows={6} placeholder="请上传 CSV 文件或粘贴 CSV 内容" onChange={event => applyCsvText(event.target.value)} />
            </Form.Item>
            <Card size="small" title="字段识别">
              {!importCsvText.trim() ? (
                <Alert type="info" showIcon title="请上传 CSV 文件或粘贴 CSV 内容" />
              ) : (
                <>
                  <Descriptions size="small" column={3} items={[
                    { key: 'fields', label: '字段列表', children: importPreview.fields.join(', ') || '-' },
                    { key: 'x', label: 'x 字段', children: importForm.getFieldValue('x_field') || '-' },
                    { key: 'y', label: 'y 字段', children: importForm.getFieldValue('y_field') || '-' },
                    { key: 'z', label: 'z 字段', children: importType === 'piecewise_2d' ? (importForm.getFieldValue('z_field') || '-') : '不适用' },
                  ]} />
                  <Collapse
                    className="section-gap"
                    items={[{
                      key: 'preview',
                      label: `高级预览：前 ${importPreview.rows.length} 行`,
                      children: <Table className="import-preview-table" size="small" pagination={false} rowKey={row => JSON.stringify(row)} dataSource={importPreview.rows} columns={importPreview.fields.map(field => ({ title: field, dataIndex: field }))} />,
                    }]}
                  />
                </>
              )}
            </Card>
            <Space className="section-gap"><Button onClick={() => setImporting(false)}>取消</Button><Button type="primary" htmlType="submit" loading={importCsv.isPending}>导入为草稿</Button></Space>
          </Form>
        ) : selected ? (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="函数 ID">{selected.function_id}</Descriptions.Item>
              <Descriptions.Item label="业务展示名">{hydroAssetLabel(selected.function_id, selected.name)}</Descriptions.Item>
              <Descriptions.Item label="类型">{functionTypeText(selected.function_type)}</Descriptions.Item>
              <Descriptions.Item label="校验状态"><Tag color={validationColor(selected.validation_status)}>{validationText(selected.validation_status)}</Tag></Descriptions.Item>
              <Descriptions.Item label="求解策略">{solveStrategyText(selected.solve_strategy)}</Descriptions.Item>
              <Descriptions.Item label="引用数">{(selected.referenced_by || []).length}</Descriptions.Item>
              <Descriptions.Item label="错误 / 警告">{(selected.validation_errors || []).length} / {(selected.validation_warnings || []).length}</Descriptions.Item>
            </Descriptions>

            {selected.function_type === 'piecewise_2d' ? (
              <Card size="small" title="二维曲面诊断" className="function-surface-diagnostics">
                <Descriptions size="small" column={3} items={[
                  { key: 'x_dim', label: 'x 维度', children: `${schemaName(selected, 'input', 0)} / q_gen` },
                  { key: 'y_dim', label: 'y 维度', children: `${schemaName(selected, 'input', 1)} / head` },
                  { key: 'z_dim', label: 'z 输出', children: `${schemaName(selected, 'output')} / power` },
                  { key: 'points', label: '点数量', children: String(selected.domain?.point_count ?? selected.points_2d?.length ?? '-') },
                  { key: 'triangles', label: '三角形数量', children: String(surfaceDiagnostics.triangle_count ?? selected.triangles?.length ?? '-') },
                  { key: 'x', label: 'x 定义域', children: `${selected.domain?.x_min ?? '-'} .. ${selected.domain?.x_max ?? '-'}` },
                  { key: 'y', label: 'y 定义域', children: `${selected.domain?.y_min ?? '-'} .. ${selected.domain?.y_max ?? '-'}` },
                  { key: 'z', label: 'z 值域', children: `${selected.domain?.z_min ?? '-'} .. ${selected.domain?.z_max ?? '-'}` },
                  { key: 'grid', label: '是否规则网格', children: boolText(surfaceDiagnostics.is_regular_grid ?? '-') },
                  { key: 'triangulable', label: '是否可三角剖分', children: boolText(surfaceDiagnostics.triangulable ?? selected.triangulation_status !== 'failed') },
                  { key: 'duplicates', label: '是否存在重复点', children: boolText(Number(surfaceDiagnostics.duplicate_point_count ?? 0) > 0) },
                  { key: 'status', label: '三角化状态', children: triangulationStatusText(selected.triangulation_status || surfaceDiagnostics.triangulation_status || '-') },
                  { key: 'degenerate', label: '退化三角形数量', children: String(surfaceDiagnostics.degenerate_triangle_count ?? 0) },
                  { key: 'recommended', label: '推荐求解策略', children: solveStrategyText(String(surfaceDiagnostics.recommended_solve_strategy || selected.solve_strategy || '')) },
                ]} />
                <div className="function-surface-impact">
                  <Typography.Text type="secondary">预计 MILP 二进制变量影响</Typography.Text>
                  <span>每个曲面命中点约增加 {Math.max(1, Number(surfaceDiagnostics.triangle_count ?? selected.triangles?.length ?? 1))} 个三角选择变量，规模会随时段数和电站数放大。</span>
                </div>
              </Card>
            ) : (
              <Card size="small" title="曲线诊断">
                <Descriptions size="small" column={3} items={[
                  { key: 'count', label: '断点数量', children: selected.domain?.breakpoint_count ?? selected.points?.length ?? '-' },
                  { key: 'domain', label: '定义域', children: `${selected.domain?.x_min ?? '-'} .. ${selected.domain?.x_max ?? '-'}` },
                  { key: 'range', label: '值域', children: `${selected.domain?.y_min ?? '-'} .. ${selected.domain?.y_max ?? '-'}` },
                  { key: 'monotonicity', label: '单调性', children: String(selected.monotonicity || '-') },
                  { key: 'convexity', label: '凸性', children: String(selected.convexity || selected.diagnostics?.convexity || '-') },
                ]} />
              </Card>
            )}
            {(selected.validation_errors || []).length > 0 && <Alert type="error" title="校验错误" description={validationList(selected.validation_errors)} />}
            {(selected.validation_warnings || []).length > 0 && <Alert type="warning" title="校验警告" description={validationList(selected.validation_warnings)} />}
            {validation && <Alert type={validation.valid ? 'success' : 'error'} showIcon title={validation.valid ? '校验通过' : '校验失败'} description={validation.valid ? '函数资产可用于模型绑定。' : validationList(validation.errors)} />}

            {selected.validation_status !== 'invalid' && selected.function_type === 'piecewise_2d' && (
              <Card size="small" title="二维曲面预览">
                <Alert
                  showIcon
                  type="info"
                  title="输入 x/y 后，平台返回插值 z、命中的三角形 triangle 和插值权重 lambda。"
                  description="triangle 表示当前点落在哪个二维曲面三角面片；lambda 表示当前点在三角形三个顶点上的插值权重。后端未返回时显示当前未返回该项。"
                />
                <ReactECharts option={surfaceChartOption(selected)} style={{ height: 320 }} />
                <Space className="section-gap" wrap>
                  <InputNumber value={previewInput.x} onChange={value => setPreviewInput(current => ({ ...current, x: Number(value) }))} addonBefore="x" />
                  <InputNumber value={previewInput.y} onChange={value => setPreviewInput(current => ({ ...current, y: Number(value) }))} addonBefore="y" />
                  <Button onClick={() => runPreview.mutate(selected)}>计算 z</Button>
                </Space>
                {preview && preview.status && (
                  <Descriptions className="section-gap" size="small" column={4} items={[
                    { key: 'status', label: '状态', children: preview.status },
                    { key: 'z', label: '插值 z', children: preview.z ?? '当前未返回该项' },
                    { key: 'triangle', label: 'triangle', children: preview.triangle ? JSON.stringify(preview.triangle) : '当前未返回该项' },
                    { key: 'lambda', label: 'lambda', children: preview.lambda ? JSON.stringify(preview.lambda) : '当前未返回该项' },
                  ]} />
                )}
              </Card>
            )}
            {selected.validation_status !== 'invalid' && selected.function_type !== 'piecewise_2d' && (selected.points || []).length > 0 && <Card size="small" title="曲线图预览"><ReactECharts option={curveChartOption(selected, preview)} style={{ height: 280 }} /></Card>}
            {selected.validation_status !== 'invalid' && preview?.values && <Table rowKey="x" size="small" pagination={false} dataSource={preview.values} columns={previewColumns} />}

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
            <Collapse items={[{ key: 'debug', label: '高级调试', children: <Typography.Text code>{JSON.stringify({ points: selected.points, points_2d: selected.points_2d, triangles: selected.triangles, validation, diagnostics: selected.diagnostics, surface_diagnostics: selected.surface_diagnostics }, null, 2)}</Typography.Text> }]} />
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
