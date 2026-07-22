import { expect, test } from 'vitest';
import { parseRuntimeGrid, runtimeGridStrategy, validateRuntimeGrid } from '../../features/task-create/utils/runtimeParameterImport';

test('parses Excel clipboard and validates matrix shape', () => {
  const parsed = parseRuntimeGrid('1\t2\n3\t4');
  expect(parsed.rows).toEqual([[1, 2], [3, 4]]);
  expect(validateRuntimeGrid(parsed, 2, 2)).toEqual([]);
});

test('reports short, oversized and non numeric grids', () => {
  expect(validateRuntimeGrid(parseRuntimeGrid('1\n2'), 3, 1)[0]).toContain('期望 3 行');
  expect(validateRuntimeGrid(parseRuntimeGrid('1,2,3'), 1, 2)[0]).toContain('期望 2 列');
  expect(validateRuntimeGrid(parseRuntimeGrid('1,x'), 1, 2)).toContain('包含非数字单元格');
});

test('uses centralized large data thresholds', () => {
  expect(runtimeGridStrategy(1000)).toBe('inline');
  expect(runtimeGridStrategy(1001)).toBe('focus');
  expect(runtimeGridStrategy(5001)).toBe('import');
});
