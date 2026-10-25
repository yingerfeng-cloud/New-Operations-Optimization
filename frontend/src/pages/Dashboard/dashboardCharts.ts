import type { EChartsOption } from 'echarts';

interface TrendDay {
  label: string;
  success: number;
  failed: number;
  other: number;
  total: number;
  successRate: number | null;
}

const colors = { success: '#49a58b', failed: '#d78275', other: '#b4c1d3', rate: '#466bc4' };

export function taskTrendOption(trend: TrendDay[], fontFamily: string): EChartsOption {
  const dates = trend.map(day => day.label);
  const lastMeasuredDay = [...trend].reverse().find(day => day.successRate !== null);
  const axisLabel = { color: '#73829a', fontSize: 11, fontFamily };
  return {
    animation: false,
    textStyle: { fontFamily },
    color: [colors.success, colors.failed, colors.other, colors.rate],
    grid: { top: 28, left: 40, right: 46, bottom: 60 },
    title: [
      { text: '任务量（个）', left: 0, top: 0, padding: 0, textStyle: { color: '#64728a', fontSize: 12, fontWeight: 400 } },
      { text: '成功率', right: 0, top: 0, padding: 0, textStyle: { color: '#64728a', fontSize: 12, fontWeight: 400 } },
    ],
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: '#fff',
      borderColor: '#e5eaf2',
      borderWidth: 1,
      padding: [12, 14],
      extraCssText: 'border-radius:10px;box-shadow:0 8px 28px #20314914;',
      textStyle: { color: '#53637e', fontSize: 12, fontFamily },
      axisPointer: { type: 'line', lineStyle: { color: '#c6d2e5', width: 1 } },
      formatter: params => {
        const point = Array.isArray(params) ? params[0] : params;
        const day = trend[point?.dataIndex ?? -1];
        if (!day) return '';
        const row = (label: string, value: string | number, color: string) => `<div style="display:flex;align-items:center;gap:7px;margin-top:6px"><i style="width:6px;height:6px;border-radius:2px;background:${color}"></i><span style="flex:1">${label}</span><strong style="margin-left:24px;color:#203149;font-weight:600">${value}</strong></div>`;
        return `<div style="margin-bottom:8px;color:#203149;font-weight:600">${day.label}<span style="margin-left:24px;color:#8995a8;font-weight:400">${day.total} 个任务</span></div>`
          + row('成功', day.success, colors.success)
          + row('异常', day.failed, colors.failed)
          + row('处理中', day.other, colors.other)
          + row('成功率', day.successRate === null ? '无任务' : `${day.successRate}%`, colors.rate);
      },
    },
    legend: { bottom: 0, left: 'center', itemWidth: 12, itemHeight: 8, itemGap: 22, textStyle: { color: '#64728a', fontSize: 12, fontFamily } },
    xAxis: { type: 'category', data: dates, boundaryGap: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...axisLabel, margin: 12, interval: trend.length > 14 ? 4 : trend.length > 7 ? 1 : 0, showMinLabel: true, showMaxLabel: true, hideOverlap: true } },
    yAxis: [
      { type: 'value', min: 0, max: Math.max(4, Math.ceil(Math.max(...trend.map(day => day.total), 0) * 1.2)), minInterval: 1, splitNumber: 2, axisLine: { show: false }, axisTick: { show: false }, axisLabel, splitLine: { lineStyle: { color: '#edf1f6', type: 'dashed' } } },
      { type: 'value', min: 0, max: 100, interval: 50, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...axisLabel, formatter: '{value}%' }, splitLine: { show: false } },
    ],
    series: [
      { name: '成功', type: 'bar', stack: 'tasks', xAxisIndex: 0, yAxisIndex: 0, barMaxWidth: 22, data: trend.map(day => day.success), itemStyle: { borderRadius: [3, 3, 0, 0] } },
      { name: '异常', type: 'bar', stack: 'tasks', xAxisIndex: 0, yAxisIndex: 0, barMaxWidth: 22, data: trend.map(day => day.failed), itemStyle: { borderRadius: [3, 3, 0, 0] } },
      { name: '处理中', type: 'bar', stack: 'tasks', xAxisIndex: 0, yAxisIndex: 0, barMaxWidth: 22, data: trend.map(day => day.other), itemStyle: { borderRadius: [3, 3, 0, 0] } },
      {
        name: '成功率', type: 'line', xAxisIndex: 0, yAxisIndex: 1,
        smooth: false, connectNulls: false, showSymbol: true, symbol: 'circle', symbolSize: 4,
        data: trend.map(day => ({
          value: day.successRate,
          label: {
            show: day === lastMeasuredDay,
            formatter: `${day.successRate}%`,
            // Keep percentage badges inside the plot, clear of axis titles and dates.
            position: (day.successRate ?? 0) >= 80 ? 'bottom' : 'top',
            distance: 8,
            color: colors.rate,
            fontSize: 11,
            backgroundColor: '#ffffffed',
            borderRadius: 4,
            padding: [2, 4],
          },
        })),
        lineStyle: { width: 1.8, color: colors.rate },
        itemStyle: { color: colors.rate, borderColor: '#fff', borderWidth: 1 },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#466bc40c' }, { offset: 1, color: '#466bc400' }] } },
        emphasis: { scale: 1.6 },
      },
    ],
  };
}
