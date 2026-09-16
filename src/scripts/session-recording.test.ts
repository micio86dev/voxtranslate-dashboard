import { describe, expect, it } from 'vitest';
import { showsRoomRecording } from './session-recording';

describe('showsRoomRecording', () => {
  it('hides the room-recording control when the session came from a phone call', () => {
    // A phone call is never room-recorded — the leg is a telephone, not a browser
    // WebRTC room — so `/recording/url` 404s every time for one. The real recording
    // lives on the call's own detail page via the VoIP-specific endpoint.
    expect(showsRoomRecording('phone')).toBe(false);
  });

  it('keeps the room-recording control for a normal video/audio call session', () => {
    expect(showsRoomRecording(null)).toBe(true);
    expect(showsRoomRecording(undefined)).toBe(true);
    expect(showsRoomRecording('video')).toBe(true);
  });
});
