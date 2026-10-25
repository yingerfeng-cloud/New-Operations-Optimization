import { vi } from 'vitest';
import { taskTrendOption } from '../../pages/Dashboard/dashboardCharts';

// Render the real chart: a config-only assertion would miss label collisions.
const { init } = await vi.importActual<typeof import('echarts')>('echarts');

interface TextBounds {
  text: string;
  fill: unknown;
  x: number;
  y: number;
  width: number;
  height: number;
}

function renderTrend(width: number, days: number, rate: number | null, trailingEmpty = false) {
  const chart = init(null, null, { renderer: 'svg', ssr: true, width, height: 272 });
  const measuredIndex = days - (trailingEmpty ? 2 : 1);
  const trend = Array.from({ length: days }, (_, index) => {
    const measured = rate !== null && (index === 0 || index === measuredIndex);
    const success = measured ? rate : 0;
    const failed = measured ? 100 - rate : 0;
    return { label: `10/${index + 1}`, success, failed, other: 0, total: success + failed, successRate: measured ? rate : null };
  });
  chart.setOption(taskTrendOption(trend, 'Arial'));
  const labels: TextBounds[] = chart.getZr().storage.getDisplayList().flatMap(element => {
    if (element.type !== 'tspan') return [];
    const style = (element as unknown as { style: { text: string; fill: unknown } }).style;
    const bounds = element.getBoundingRect().clone();
    bounds.applyTransform(element.getComputedTransform());
    return [{ text: style.text, fill: style.fill, ...bounds }];
  });
  chart.dispose();
  return labels;
}

beforeEach(() => {
  // ECharts uses its SSR font metrics when no canvas is available.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => vi.restoreAllMocks());

describe.each([520, 880])('task trend at %ipx chart width', width => {
  test.each([
    [7, 100, false], [7, 0, false], [7, 33, false],
    [14, 100, false], [14, 0, false],
    [30, 100, false], [30, 0, false], [30, 50, false],
    [7, 100, true],
  ])('%i days, rate=%i, trailing empty=%s: latest label stays inside the plot and clear of other text', (days, rate, trailingEmpty) => {
    const labels = renderTrend(width, days, rate, trailingEmpty);
    const values = labels.filter(label => label.fill === '#466bc4' && label.text === `${rate}%`);
    expect(values).toHaveLength(1);
    const value = values[0];
    // Include the badge padding when checking the actual rendered text bounds.
    const badge = { left: value.x - 4, right: value.x + value.width + 4, top: value.y - 2, bottom: value.y + value.height + 2 };
    expect(badge.top).toBeGreaterThanOrEqual(28);
    expect(badge.bottom).toBeLessThanOrEqual(272 - 60);
    expect(badge.left).toBeGreaterThanOrEqual(0);
    expect(badge.right).toBeLessThanOrEqual(width);
    const collisions = labels.filter(label => label !== value && badge.left < label.x + label.width && badge.right > label.x && badge.top < label.y + label.height && badge.bottom > label.y);
    expect(collisions.map(label => label.text)).toEqual([]);
  });

  test('empty dates do not receive a percentage label', () => {
    expect(renderTrend(width, 7, null).filter(label => label.fill === '#466bc4')).toEqual([]);
  });
});
