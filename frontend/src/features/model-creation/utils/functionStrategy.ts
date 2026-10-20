export function effective1dStrategy(value: unknown): string {
  return !value || ['convex_combination_lp', 'binary_segment_milp'].includes(String(value)) ? 'segment_binary' : String(value);
}
