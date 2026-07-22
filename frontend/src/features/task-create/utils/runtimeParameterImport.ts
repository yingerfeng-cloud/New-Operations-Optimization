export const RUNTIME_MATRIX_COMPACT_LIMIT = 1000;
export const RUNTIME_MATRIX_FOCUS_LIMIT = 5000;

export type ParsedRuntimeGrid = { rows: unknown[][]; rowCount: number; columnCount: number; errors: string[] };

export function parseRuntimeGrid(text: string): ParsedRuntimeGrid {
  const rows = text.trim().split(/\r?\n/).filter(line => line.trim()).map(line => line.split(/\t|,/).map(cell => {
    const value = cell.trim();
    if (!value) return '';
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }));
  const columnCount = rows.length ? Math.max(...rows.map(row => row.length)) : 0;
  const errors: string[] = [];
  if (rows.some(row => row.length !== columnCount)) errors.push('各行列数不一致');
  return { rows, rowCount: rows.length, columnCount, errors };
}

export function validateRuntimeGrid(parsed: ParsedRuntimeGrid, expectedRows?: number, expectedColumns?: number, numeric = true) {
  const errors = [...parsed.errors];
  if (expectedRows !== undefined && parsed.rowCount !== expectedRows) errors.push(`期望 ${expectedRows} 行，识别到 ${parsed.rowCount} 行`);
  if (expectedColumns !== undefined && parsed.columnCount !== expectedColumns) errors.push(`期望 ${expectedColumns} 列，识别到 ${parsed.columnCount} 列`);
  if (numeric && parsed.rows.flat().some(value => value !== '' && typeof value !== 'number')) errors.push('包含非数字单元格');
  return [...new Set(errors)];
}

export function runtimeGridStrategy(cellCount: number) {
  if (cellCount <= RUNTIME_MATRIX_COMPACT_LIMIT) return 'inline' as const;
  if (cellCount <= RUNTIME_MATRIX_FOCUS_LIMIT) return 'focus' as const;
  return 'import' as const;
}
