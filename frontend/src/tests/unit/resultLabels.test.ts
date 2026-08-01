import { buildResultLabelMap, resultLabel } from '../../features/result-center/resultLabels';
import type { ModelAsset } from '../../types/model';
import type { SolveResult } from '../../types/result';

const model = {
  id: 'MODEL-LABELS',
  name: '指标元数据模型',
  semantic_spec: {
    parameters: [{ code: 'fuel_cost', name: '燃料成本' }],
    metrics_config: {
      metrics: [
        { key: 'average_spot_price', name: '平均现货价格' },
        { key: 'english_only', name: 'English only' },
      ],
    },
  },
  component_spec: {
    metrics_config: {
      metrics: [{ key: 'storage_discharge_energy', name: '储能放电量' }],
    },
  },
} as unknown as ModelAsset;

test('collects Chinese result labels recursively from model metadata', () => {
  const labels = buildResultLabelMap(model);

  expect(resultLabel('fuel_cost', labels)).toBe('燃料成本');
  expect(resultLabel('average_spot_price', labels)).toBe('平均现货价格');
  expect(resultLabel('storage_discharge_energy', labels)).toBe('储能放电量');
  expect(resultLabel('english_only', labels)).toBe('english_only');
});

test('collects labels from result metadata without model-specific rendering logic', () => {
  const result = {
    result_metadata: {
      metric_definitions: [{ key: 'dynamic_metric', label: '动态指标' }],
    },
  } as SolveResult;

  expect(resultLabel('dynamic_metric', buildResultLabelMap(undefined, result))).toBe('动态指标');
});
