//! Tiny dependency-free chart helpers (inline SVG / flex bars), shared by the
//! analytics page and the dashboard overview. All render to an HTML string; the
//! caller passes already-localised unit/label strings.

export function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c,
  );
}

// Categorical palette (theme tokens) for the labelled bars.
const PALETTE = [
  'var(--color-brand)',
  'var(--color-ok)',
  'var(--color-warn)',
  'var(--color-danger)',
  'var(--color-muted)',
];

/** Vertical bar chart of a daily series, as inline SVG (no chart dependency). */
export function barChart(
  points: { day: string; calls: number; minutes: number }[],
  unit: string,
): string {
  if (points.length === 0) return '';
  const W = 560;
  const H = 180;
  const pad = { l: 28, r: 8, t: 8, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = Math.max(1, ...points.map((p) => p.calls));
  const n = points.length;
  const gap = 2;
  const bw = Math.max(1, iw / n - gap);
  const bars = points
    .map((p, i) => {
      const h = (p.calls / max) * ih;
      const x = pad.l + i * (iw / n);
      const y = pad.t + (ih - h);
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="var(--color-brand)"><title>${esc(p.day)}: ${p.calls} ${esc(unit)} · ${p.minutes} min</title></rect>`;
    })
    .join('');
  const labels = `
      <text x="0" y="${pad.t + 8}" font-size="10" fill="var(--color-muted)">${max}</text>
      <text x="0" y="${pad.t + ih}" font-size="10" fill="var(--color-muted)">0</text>
      <text x="${pad.l}" y="${H - 6}" font-size="9" fill="var(--color-muted)">${esc(points[0].day.slice(5))}</text>
      <text x="${W - pad.r}" y="${H - 6}" font-size="9" text-anchor="end" fill="var(--color-muted)">${esc(points[n - 1].day.slice(5))}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="w-full" role="img" preserveAspectRatio="none" style="max-height:200px">${bars}${labels}</svg>`;
}

/** Horizontal labelled bars (e.g. credits by type, top projects). */
export function hbars(items: { label: string; value: number }[], suffix = ''): string {
  if (items.length === 0) return '';
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    '<div class="flex flex-col gap-2">' +
    items
      .map((it, i) => {
        const pct = (it.value / max) * 100;
        const color = PALETTE[i % PALETTE.length];
        return `<div class="flex items-center gap-2 text-sm">
            <span class="w-28 shrink-0 truncate text-muted" title="${esc(it.label)}">${esc(it.label)}</span>
            <span class="h-3 rounded" style="width:${pct.toFixed(1)}%;min-width:2px;background:${color}"></span>
            <span class="ml-auto tabular-nums">${it.value}${esc(suffix)}</span>
          </div>`;
      })
      .join('') +
    '</div>'
  );
}
