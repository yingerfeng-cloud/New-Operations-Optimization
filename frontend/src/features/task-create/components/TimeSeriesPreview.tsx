import { Alert, Statistic } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { LazyEChart } from '../../../components/LazyEChart';

const SAMPLE_LIMIT = 240;

function sample(labels: string[], values: number[]) {
  if (values.length <= SAMPLE_LIMIT) return { labels, values };
  const stride = Math.ceil(values.length / SAMPLE_LIMIT);
  const indices = Array.from({ length: Math.ceil(values.length / stride) }, (_, index) => Math.min(index * stride, values.length - 1));
  return { labels: indices.map(index => labels[index]), values: indices.map(index => values[index]) };
}

export function TimeSeriesPreview({ name, unit, labels, values }: { name: string; unit?: string; labels: string[]; values: unknown[] }) {
  const [debounced, setDebounced] = useState(values);
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(values), 300); return () => window.clearTimeout(timer); }, [values]);
  const analysis = useMemo(() => {
    const numeric = debounced.map(value => value === '' || value == null ? Number.NaN : Number(value));
    const valid = numeric.filter(Number.isFinite);
    const missing = debounced.filter(value => value === '' || value == null).length;
    const invalid = numeric.length - valid.length;
    const constant = valid.length > 1 && valid.every(value => value === valid[0]);
    const previewLabels = numeric.map((_, index) => labels[index] || `T${index + 1}`);
    const preview = sample(previewLabels, numeric.map(value => Number.isFinite(value) ? value : NaN));
    return { valid, missing, invalid, constant, preview };
  }, [debounced, labels]);
  if (!analysis.valid.length) return <Alert className="time-series-preview" type="info" showIcon title="填写数值后显示曲线预览" />;
  const min = Math.min(...analysis.valid); const max = Math.max(...analysis.valid); const average = analysis.valid.reduce((sum, value) => sum + value, 0) / analysis.valid.length;
  const notices = [analysis.missing ? `存在 ${analysis.missing} 个空值` : '', analysis.invalid ? `存在 ${analysis.invalid} 个非数字值` : '', analysis.constant ? '全序列数值相同，请确认是否符合预期' : ''].filter(Boolean);
  return <section className="time-series-preview" aria-label={`${name}曲线预览`}>
    <div className="time-series-preview-header"><strong>{name}曲线预览{unit ? `（${unit}）` : ''}</strong><div><Statistic title="最小值" value={min} /><Statistic title="最大值" value={max} /><Statistic title="平均值" value={Number(average.toFixed(3))} /></div></div>
    {notices.length > 0 && <Alert type="warning" showIcon title={notices.join('；')} description="提示仅用于数据检查，不会自动阻止提交。" />}
    <LazyEChart style={{ height: 220, minHeight: 220 }} option={{ animation: false, grid: { left: 48, right: 20, top: 24, bottom: 40 }, tooltip: { trigger: 'axis' }, xAxis: { type: 'category', data: analysis.preview.labels }, yAxis: { type: 'value', name: unit }, series: [{ name, type: 'line', showSymbol: analysis.preview.values.length <= 96, data: analysis.preview.values }] }} />
    {values.length > SAMPLE_LIMIT && <small>当前 {values.length} 点，预览已抽样至不超过 {SAMPLE_LIMIT} 点；提交数据保持原始长度。</small>}
  </section>;
}
