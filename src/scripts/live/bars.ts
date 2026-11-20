/** Bar widths (whole percentages) for a CSS-only bar chart. */
const MIN_VISIBLE = 2;

/**
 * Scales every value against the largest. A positive value is never drawn narrower than
 * `MIN_VISIBLE`%, so a small desk does not vanish next to a busy one; zero stays zero.
 */
export function barPercents(values: number[]): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const max = Math.max(0, ...clean);
  if (max === 0) return clean.map(() => 0);
  return clean.map((v) => (v === 0 ? 0 : Math.max(MIN_VISIBLE, Math.round((v / max) * 100))));
}
