import { describe, it, expect } from 'vitest';
import { esc, barChart, hbars } from './charts';

describe('esc', () => {
  it('escapes the HTML-significant characters', () => {
    expect(esc('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it('leaves a clean string untouched', () => {
    expect(esc('hello world')).toBe('hello world');
  });
});

describe('barChart', () => {
  it('returns an empty string for no points', () => {
    expect(barChart([], 'calls')).toBe('');
  });

  it('renders one <rect> per point with an escaped <title>', () => {
    const svg = barChart(
      [
        { day: '2026-06-01', calls: 2, minutes: 10 },
        { day: '2026-06-02', calls: 4, minutes: 20 },
      ],
      'calls',
    );
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.match(/<rect /g)).toHaveLength(2);
    // unit appears inside the bar title
    expect(svg).toContain('2 calls');
    // axis labels show the month-day slice of first/last day
    expect(svg).toContain('06-01');
    expect(svg).toContain('06-02');
  });

  it('treats an all-zero series without dividing by zero (max floored to 1)', () => {
    const svg = barChart([{ day: '2026-06-01', calls: 0, minutes: 0 }], 'calls');
    expect(svg).toContain('height="0.0"');
    expect(svg).not.toContain('NaN');
  });
});

describe('hbars', () => {
  it('returns an empty string for no items', () => {
    expect(hbars([])).toBe('');
  });

  it('renders a labelled row per item and cycles the palette', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ label: `L${i}`, value: i + 1 }));
    const html = hbars(items, '%');
    expect(html.match(/flex items-center/g)).toHaveLength(6);
    // suffix is appended to each value
    expect(html).toContain('6%');
    // the 6th item (index 5) wraps back to the first palette colour
    expect(html).toContain('var(--color-brand)');
  });

  it('escapes the label in both the title and the text', () => {
    const html = hbars([{ label: '<x>', value: 1 }]);
    expect(html).toContain('&lt;x&gt;');
    expect(html).not.toContain('<x>');
  });
});
