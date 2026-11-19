import { describe, expect, it } from 'vitest';
import { diffWaiting, formatWaited } from './waiting';
import type { WaitingGuest } from '../../lib/api';

const g = (id: string, waited = 0): WaitingGuest => ({
  session_id: id,
  guest_name: `Guest ${id}`,
  guest_lang: 'en',
  waited_secs: waited,
});

describe('diffWaiting', () => {
  it('reports only customers not seen before', () => {
    const first = diffWaiting(new Set(), [g('a'), g('b')]);
    expect(first.fresh.map((x) => x.session_id)).toEqual(['a', 'b']);
    const second = diffWaiting(first.ids, [g('a'), g('b'), g('c')]);
    expect(second.fresh.map((x) => x.session_id)).toEqual(['c']);
  });

  it('forgets a customer who left, so a later one is new again', () => {
    const first = diffWaiting(new Set(), [g('a')]);
    const gone = diffWaiting(first.ids, []);
    expect(gone.fresh).toEqual([]);
    expect(gone.ids.size).toBe(0);
    expect(diffWaiting(gone.ids, [g('a')]).fresh).toHaveLength(1);
  });

  it('never marks the first load as a cue when told it is the baseline', () => {
    const r = diffWaiting(new Set(), [g('a')], true);
    expect(r.fresh).toEqual([]);
    expect(r.ids.has('a')).toBe(true);
  });
});

describe('formatWaited', () => {
  it('says seconds under a minute, minutes and seconds after', () => {
    expect(formatWaited(0)).toBe('0:00');
    expect(formatWaited(9)).toBe('0:09');
    expect(formatWaited(75)).toBe('1:15');
    expect(formatWaited(-4)).toBe('—');
  });
});
