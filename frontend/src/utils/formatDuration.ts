export function formatDurationSeconds(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  if (seconds < 1) return seconds === 0 ? '< 1 ms' : `${Math.max(1, Math.round(seconds * 1000))} ms`;
  if (seconds < 60) return `${Number(seconds.toFixed(seconds < 10 ? 2 : 1))} s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return remainingSeconds ? `${minutes} min ${remainingSeconds} s` : `${minutes} min`;
}
