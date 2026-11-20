import { describe, expect, it } from 'vitest';
import { customRange, dayStartIso, nextDayStartIso, presetRange, RANGE_PRESETS } from './range';

describe('RANGE_PRESETS', () => {
  it('offers 7, 30 and 90 days, defaulting to 30', () => {
    expect(RANGE_PRESETS.map((p) => p.days)).toEqual([7, 30, 90]);
    expect(RANGE_PRESETS.find((p) => p.default)?.days).toBe(30);
  });
});

describe('presetRange', () => {
  it('ends now and starts that many days earlier', () => {
    const now = new Date('2026-05-10T12:00:00Z');
    const r = presetRange(7, now);
    expect(r.to).toBe('2026-05-10T12:00:00.000Z');
    expect(r.from).toBe('2026-05-03T12:00:00.000Z');
  });
});

describe('day helpers', () => {
  it('start of a local day, and the start of the one after it (an exclusive end)', () => {
    const s = new Date(dayStartIso('2026-03-01'));
    expect([s.getFullYear(), s.getMonth(), s.getDate(), s.getHours()]).toEqual([2026, 2, 1, 0]);
    const e = new Date(nextDayStartIso('2026-03-01'));
    expect([e.getFullYear(), e.getMonth(), e.getDate(), e.getHours()]).toEqual([2026, 2, 2, 0]);
  });

  it('rolls over month ends', () => {
    const e = new Date(nextDayStartIso('2026-01-31'));
    expect([e.getMonth(), e.getDate()]).toEqual([1, 1]);
  });
});

describe('customRange', () => {
  it('turns two dates into an inclusive range', () => {
    const r = customRange('2026-03-01', '2026-03-31');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.range.from).toBe(dayStartIso('2026-03-01'));
      expect(r.range.to).toBe(nextDayStartIso('2026-03-31'));
    }
  });

  it('requires both dates', () => {
    expect(customRange('', '2026-03-31')).toEqual({ ok: false, error: 'required' });
    expect(customRange('2026-03-01', '')).toEqual({ ok: false, error: 'required' });
  });

  it('refuses a malformed date', () => {
    expect(customRange('2026-13-45', '2026-03-31')).toEqual({ ok: false, error: 'required' });
    expect(customRange('not-a-date', '2026-03-31')).toEqual({ ok: false, error: 'required' });
  });

  it('refuses an end before the start, as the server would (bad_range)', () => {
    expect(customRange('2026-03-31', '2026-03-01')).toEqual({ ok: false, error: 'order' });
  });

  it('accepts the same day on both ends', () => {
    expect(customRange('2026-03-01', '2026-03-01').ok).toBe(true);
  });

  it('refuses more than a year, the server limit', () => {
    expect(customRange('2024-01-01', '2026-01-01')).toEqual({ ok: false, error: 'tooLong' });
    expect(customRange('2025-03-01', '2026-02-28').ok).toBe(true);
  });
});
