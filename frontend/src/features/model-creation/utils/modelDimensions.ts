export const DIMENSION_FIELDS = ['dimension', 'dimensions', 'indices', 'index_sets'] as const;

export function extractDimensions(item: Record<string, unknown>): string[] {
  for (const field of DIMENSION_FIELDS) {
    if (!(field in item)) continue;
    const dimensions = normalizeDimensionValue(item[field]);
    if (dimensions.length) return dimensions;
  }
  return [];
}

export function dimensionFieldConflict(item: Record<string, unknown>): Record<string, string[]> | undefined {
  const declared = Object.fromEntries(DIMENSION_FIELDS.flatMap(field => {
    if (!(field in item)) return [];
    const dimensions = normalizeDimensionValue(item[field]);
    return dimensions.length ? [[field, dimensions]] : [];
  }));
  const unique = new Set(Object.values(declared).map(value => JSON.stringify(value)));
  return unique.size > 1 ? declared : undefined;
}

function normalizeDimensionValue(value: unknown): string[] {
  const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const result: string[] = [];
  for (const entry of values) {
    const code = typeof entry === 'string'
      ? entry.trim()
      : entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).set === 'string'
        ? String((entry as Record<string, unknown>).set).trim()
        : '';
    if (code && !result.includes(code)) result.push(code);
  }
  return result;
}
