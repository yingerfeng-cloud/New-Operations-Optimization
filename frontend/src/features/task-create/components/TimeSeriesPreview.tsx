import { useEffect, useMemo, useState } from 'react';
import { LazyEChart } from '../../../components/LazyEChart';
import { ParameterNotice } from './ParameterNotice';

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
    const invalid = debounced.filter((value, index) => value !== '' && value != null && !Number.isFinite(numeric[index])).length;
    const constant = valid.length > 1 && valid.every(value => value === valid[0]);
    const previewLabels = numeric.map((_, index) => labels[index] || `T${index + 1}`);
    const preview = sample(previewLabels, numeric.map(value => Number.isFinite(value) ? value : NaN));
    return { valid, missing, invalid, constant, preview };
  }, [debounced, labels]);
  const previewTitle = `${name}曲线预览${unit ? `（${unit}）` : ''}`;
  if (!analysis.valid.length) return <section className="time-series-preview" aria-label={previewTitle}>
    <div className="time-series-preview-header"><strong>{previewTitle}</strong></div>
    <ParameterNotice className="time-series-preview-notice" title="暂无曲线预览" description="填写数值后显示曲线预览。" />
  </section>;
  const min = Math.min(...analysis.valid); const max = Math.max(...analysis.valid); const average = analysis.valid.reduce((sum, value) => sum + value, 0) / analysis.valid.length;
  const notices = [analysis.missing ? `存在 ${analysis.missing} 个空值` : '', analysis.invalid ? `存在 ${analysis.invalid} 个非数字值` : '', analysis.constant ? '全序列数值相同，请确认是否符合预期' : ''].filter(Boolean);
  return <section className="time-series-preview" aria-label={previewTitle}>
    <div className="time-series-preview-header">
      <strong>{previewTitle}</strong>
      <div className="time-series-preview-metrics" aria-label="序列统计摘要">
        <span className="time-series-preview-metric"><span>最小值</span><b>{min}</b></span>
        <span className="time-series-preview-metric"><span>最大值</span><b>{max}</b></span>
        <span className="time-series-preview-metric"><span>平均值</span><b>{Number(average.toFixed(3))}</b></span>
      </div>
    </div>
    {notices.length > 0 && <ParameterNotice className="time-series-preview-notice" type="warning" title="数据质量提示" description={`${notices.join('；')}（仅提示，不会自动阻止提交）`} />}
    <LazyEChart ariaLabel={previewTitle} style={{ height: 196, minHeight: 196 }} option={{ animation: false, grid: { left: 48, right: 20, top: 20, bottom: 34 }, tooltip: { trigger: 'axis' }, xAxis: { type: 'category', data: analysis.preview.labels }, yAxis: { type: 'value', name: unit }, series: [{ name, type: 'line', showSymbol: analysis.preview.values.length <= 96, data: analysis.preview.values }] }} />
    {values.length > SAMPLE_LIMIT && <small>当前 {values.length} 点，预览已抽样至不超过 {SAMPLE_LIMIT} 点；提交数据保持原始长度。</small>}
  </section>;
}
