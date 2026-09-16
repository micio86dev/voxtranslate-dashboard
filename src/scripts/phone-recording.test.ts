import { describe, expect, it } from 'vitest';
import { isRecordingUrlFresh, recordingFailureKey } from './phone-recording';

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

describe('recordingFailureKey', () => {
  it('names the specific "no recording" reason when the server said so — 404 or 502 alike', () => {
    // The server reports the same `recording_unavailable` code on both statuses; this
    // function reads the code, not the status, so it does not need to know that.
    expect(recordingFailureKey('recording_unavailable')).toBe('phone.reason.recording_unavailable');
  });

  it('falls back to a generic retry message for a transient failure', () => {
    // A network error, an unrelated 5xx, or a 401 carries no `recording_unavailable`
    // code — telling the caller "no recording exists" for those is actively wrong, since
    // the recording may well be there and the request simply failed.
    expect(recordingFailureKey(null)).toBe('phone.error.actionFailed');
    expect(recordingFailureKey(undefined)).toBe('phone.error.actionFailed');
    expect(recordingFailureKey('some_other_code')).toBe('phone.error.actionFailed');
  });
});
