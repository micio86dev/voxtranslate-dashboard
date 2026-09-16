import { describe, expect, it } from 'vitest';
import { isRecordingUrlFresh } from './phone-recording';

describe('isRecordingUrlFresh', () => {
  const now = new Date('2026-09-16T12:00:00Z');

  it('is fresh while the expiry is still ahead of now', () => {
    expect(isRecordingUrlFresh('2026-09-16T12:05:00Z', now)).toBe(true);
  });

  it('is stale once the expiry has passed', () => {
    // Handing an expired URL to <audio> fails silently or mid-playback — the caller
    // must re-fetch instead, which is the whole reason this check exists.
    expect(isRecordingUrlFresh('2026-09-16T11:59:59Z', now)).toBe(false);
  });

  it('is stale for anything that cannot be parsed as a date, including nothing at all', () => {
    expect(isRecordingUrlFresh(null, now)).toBe(false);
    expect(isRecordingUrlFresh(undefined, now)).toBe(false);
    expect(isRecordingUrlFresh('', now)).toBe(false);
    expect(isRecordingUrlFresh('not-a-date', now)).toBe(false);
  });
});
