import { describe, it, expect } from 'vitest';
import { isSubscriptionLive } from './subscription';

const NOW = new Date('2026-09-06T12:00:00Z');

describe('isSubscriptionLive', () => {
  it('is live while the paid period is still running', () => {
    expect(isSubscriptionLive('active', '2026-10-01T00:00:00Z', NOW)).toBe(true);
  });

  // The case that started this: a gifted plan whose period ran out on 29 Aug.
  // Nothing updates the row, so the status still reads 'active' — and the
  // dashboard believed it, showing a live plan to an org the server had already
  // cut off.
  it('is NOT live once the period has passed, whatever the status says', () => {
    expect(isSubscriptionLive('active', '2026-08-29T00:00:00Z', NOW)).toBe(false);
  });

  it('treats an open-ended period as live', () => {
    expect(isSubscriptionLive('active', null, NOW)).toBe(true);
    expect(isSubscriptionLive('active', undefined, NOW)).toBe(true);
  });

  it('is never live for a non-active status', () => {
    for (const st of ['none', 'past_due', 'canceled', 'incomplete']) {
      expect(isSubscriptionLive(st, '2026-10-01T00:00:00Z', NOW)).toBe(false);
    }
  });

  it('denies rather than grants when the date cannot be read', () => {
    expect(isSubscriptionLive('active', 'not-a-date', NOW)).toBe(false);
  });
});
