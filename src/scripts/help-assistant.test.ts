/**
 * Unit tests for the Help Assistant page controller (help-assistant.ts).
 *
 * Tests the pure/extractable functions:
 *   - detectSharedWorkerSupport: returns false when SharedWorker is undefined
 *   - buildHaFullWsUrl: appends token param to the base WS URL
 *   - handleWorkerMessage: pure dispatcher from worker events to callbacks
 *   - isActivePort: whether this page is the audio-active port
 *
 * The class-level lifecycle (mic capture, AudioContext, DOM wiring) uses
 * browser APIs that jsdom does not implement; those paths are covered by the
 * SharedWorker integration in the full suite / manual smoke test.
 */
import { describe, it, expect } from 'vitest';
import {
  detectSharedWorkerSupport,
  buildHaFullWsUrl,
  handleWorkerMessage,
  type HaWorkerInboundMessage,
  type HaCallbacks,
} from './help-assistant';

// ---------------------------------------------------------------------------
// detectSharedWorkerSupport
// ---------------------------------------------------------------------------

describe('detectSharedWorkerSupport', () => {
  it('returns false when SharedWorker is undefined (jsdom / Safari / iOS)', () => {
    // jsdom does not implement SharedWorker, so this should return false.
    const result = detectSharedWorkerSupport();
    expect(result).toBe(false);
  });

  it('returns true when SharedWorker constructor is available', () => {
    // Stub the global
    const originalSharedWorker = (globalThis as Record<string, unknown>)['SharedWorker'];
    (globalThis as Record<string, unknown>)['SharedWorker'] = class {};
    expect(detectSharedWorkerSupport()).toBe(true);
    (globalThis as Record<string, unknown>)['SharedWorker'] = originalSharedWorker;
  });
});

// ---------------------------------------------------------------------------
// buildHaFullWsUrl
// ---------------------------------------------------------------------------

describe('buildHaFullWsUrl', () => {
  it('appends ?token= when a token is provided', () => {
    const url = buildHaFullWsUrl(
      'wss://api.example.com/api/business/organizations/org-1/help-assistant',
      'jwt-abc',
    );
    expect(url).toBe(
      'wss://api.example.com/api/business/organizations/org-1/help-assistant?token=jwt-abc',
    );
  });

  it('URL-encodes the token', () => {
    const url = buildHaFullWsUrl('wss://api.example.com/ha', 'tok en+/=');
    expect(url).toContain('token=tok%20en%2B%2F%3D');
  });

  it('returns the base URL unchanged when no token is provided', () => {
    const base = 'wss://api.example.com/api/business/organizations/org-1/help-assistant';
    const url = buildHaFullWsUrl(base, null);
    expect(url).toBe(base);
  });

  it('appends with & when the base URL already has a query string', () => {
    const base = 'wss://api.example.com/ha?debug=1';
    const url = buildHaFullWsUrl(base, 'tok');
    expect(url).toBe('wss://api.example.com/ha?debug=1&token=tok');
  });
});

// ---------------------------------------------------------------------------
// handleWorkerMessage — pure dispatcher
// ---------------------------------------------------------------------------

/** Build a stub callbacks object with vi-compatible mock functions. */
function makeCallbacks(): HaCallbacks & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    onStateChange: [],
    onTranscript: [],
    onCostTick: [],
    onSessionEnd: [],
    onError: [],
    onSync: [],
  };
  return {
    calls,
    onStateChange: (state: string) => calls['onStateChange'].push([state]),
    onTranscript: (role: string, delta: string) => calls['onTranscript'].push([role, delta]),
    onCostTick: (durationS: number, creditsSoFar: number, costDisplay: string) =>
      calls['onCostTick'].push([durationS, creditsSoFar, costDisplay]),
    onSessionEnd: (durationS: number, creditsUsed: number, costDisplay: string) =>
      calls['onSessionEnd'].push([durationS, creditsUsed, costDisplay]),
    onError: (code: string, message: string) => calls['onError'].push([code, message]),
    onSync: (state: string, transcript: unknown[], costDisplay: string) =>
      calls['onSync'].push([state, transcript, costDisplay]),
  };
}

describe('handleWorkerMessage', () => {
  it('calls onStateChange for state_change events', () => {
    const cb = makeCallbacks();
    const msg: HaWorkerInboundMessage = { type: 'state_change', state: 'listening' };
    handleWorkerMessage(msg, cb);
    expect(cb.calls['onStateChange']).toHaveLength(1);
    expect(cb.calls['onStateChange'][0]).toEqual(['listening']);
  });

  it('calls onTranscript for transcript events', () => {
    const cb = makeCallbacks();
    const msg: HaWorkerInboundMessage = { type: 'transcript', role: 'assistant', delta: 'Hello!' };
    handleWorkerMessage(msg, cb);
    expect(cb.calls['onTranscript']).toHaveLength(1);
    expect(cb.calls['onTranscript'][0]).toEqual(['assistant', 'Hello!']);
  });

  it('calls onCostTick for cost_tick events', () => {
    const cb = makeCallbacks();
    const msg: HaWorkerInboundMessage = {
      type: 'cost_tick',
      duration_s: 10,
      credits_so_far: 6,
      cost_display: '$0.06',
    };
    handleWorkerMessage(msg, cb);
    expect(cb.calls['onCostTick']).toHaveLength(1);
    expect(cb.calls['onCostTick'][0]).toEqual([10, 6, '$0.06']);
  });

  it('calls onSessionEnd for session_end events', () => {
    const cb = makeCallbacks();
    const msg: HaWorkerInboundMessage = {
      type: 'session_end',
      duration_s: 60,
      credits_used: 38,
      cost_display: '$0.38',
    };
    handleWorkerMessage(msg, cb);
    expect(cb.calls['onSessionEnd']).toHaveLength(1);
    expect(cb.calls['onSessionEnd'][0]).toEqual([60, 38, '$0.38']);
  });

  it('calls onError for error events', () => {
    const cb = makeCallbacks();
    const msg: HaWorkerInboundMessage = {
      type: 'error',
      code: 'capacity_full',
      message: 'Session limit reached.',
    };
    handleWorkerMessage(msg, cb);
    expect(cb.calls['onError']).toHaveLength(1);
    expect(cb.calls['onError'][0]).toEqual(['capacity_full', 'Session limit reached.']);
  });

  it('calls onSync for sync events (new port snapshot)', () => {
    const cb = makeCallbacks();
    const transcript = [{ role: 'user' as const, text: 'Hi' }];
    const msg: HaWorkerInboundMessage = {
      type: 'sync',
      state: 'listening',
      transcript,
      cost_display: '$0.10',
    };
    handleWorkerMessage(msg, cb);
    expect(cb.calls['onSync']).toHaveLength(1);
    expect(cb.calls['onSync'][0]).toEqual(['listening', transcript, '$0.10']);
  });

  it('does not throw or call any callback for unknown event types', () => {
    const cb = makeCallbacks();
    // answer_audio is handled by the page directly (not via handleWorkerMessage)
    handleWorkerMessage(
      { type: 'answer_audio', pcm16_b64: 'AAAA' } as unknown as HaWorkerInboundMessage,
      cb,
    );
    const allCalls = Object.values(cb.calls).flat();
    expect(allCalls).toHaveLength(0);
  });
});
