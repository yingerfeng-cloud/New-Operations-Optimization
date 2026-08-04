import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { init, use } from 'echarts/core';
import { BarChart, CustomChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TitleComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

use([BarChart, CustomChart, LineChart, PieChart, ScatterChart, DataZoomComponent, GridComponent, LegendComponent, TitleComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

export function LazyEChart({ option, style, ariaLabel = '数据图表' }: { option: EChartsCoreOption; style?: CSSProperties; ariaLabel?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof init> | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    try {
      const chart = init(host.current);
      chartRef.current = chart;
      setUnavailable(false);
      const resize = () => chart.resize();
      window.addEventListener('resize', resize);
      return () => { window.removeEventListener('resize', resize); chart.dispose(); chartRef.current = null; };
    } catch {
      setUnavailable(true);
      return undefined;
    }
  }, []);
  useEffect(() => {
    try {
      chartRef.current?.setOption(option, { notMerge: false, lazyUpdate: true });
    } catch {
      setUnavailable(true);
    }
  }, [option]);
  if (unavailable) return <div className="chart-fallback" role="status">曲线预览暂不可用，不影响参数提交。</div>;
  return <div ref={host} role="img" aria-label={ariaLabel} data-testid="mock-echarts" style={{ minHeight: 280, ...style }} />;
}
