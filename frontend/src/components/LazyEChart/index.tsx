import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { init, use } from 'echarts/core';
import { LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

use([LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export function LazyEChart({ option, style }: { option: EChartsCoreOption; style?: CSSProperties }) {
  const host = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    try {
      const chart = init(host.current);
      chart.setOption(option);
      setUnavailable(false);
      const resize = () => chart.resize();
      window.addEventListener('resize', resize);
      return () => { window.removeEventListener('resize', resize); chart.dispose(); };
    } catch {
      setUnavailable(true);
      return undefined;
    }
  }, [option]);
  if (unavailable) return <div className="chart-fallback" role="status">曲线预览暂不可用，不影响参数提交。</div>;
  return <div ref={host} role="img" aria-label="数据图表" data-testid="mock-echarts" style={{ minHeight: 280, ...style }} />;
}
