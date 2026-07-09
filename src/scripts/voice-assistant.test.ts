/**
 * Unit tests for the B2B Voice Assistant client (PR 3).
 *
 * Runs under jsdom/vitest. DOM APIs that are absent from jsdom (AudioContext,
 * MediaRecorder, WebSocket) are mocked inline per test. The module under test
 * exports pure functions and a class; network/hardware never touches real APIs.
 */
import { describe, it, expect } from 'vitest';
import {
  VoiceAssistantState,
  stateMachineTransition,
  buildWsUrl,
  pcm16FromFloat32,
  formatCostDisplay,
  type VoiceAssistantInboundEvent,
} from './voice-assistant';

// ---------------------------------------------------------------------------
// 3.1 [RED] — state machine transitions
// ---------------------------------------------------------------------------

describe('stateMachineTransition', () => {
  it('idle → connecting on "connect" action', () => {
    expect(stateMachineTransition(VoiceAssistantState.Idle, 'connect')).toBe(
      VoiceAssistantState.Connecting,
    );
  });

  it('connecting → listening when "session_ready"', () => {
    expect(stateMachineTransition(VoiceAssistantState.Connecting, 'session_ready')).toBe(
      VoiceAssistantState.Listening,
    );
  });

  it('listening → speaking when "speech_started"', () => {
    expect(stateMachineTransition(VoiceAssistantState.Listening, 'speech_started')).toBe(
      VoiceAssistantState.Speaking,
    );
  });

  it('speaking → listening when "speech_stopped"', () => {
    expect(stateMachineTransition(VoiceAssistantState.Speaking, 'speech_stopped')).toBe(
      VoiceAssistantState.Listening,
    );
  });

  it('listening → idle on "disconnect" action', () => {
    expect(stateMachineTransition(VoiceAssistantState.Listening, 'disconnect')).toBe(
      VoiceAssistantState.Idle,
    );
  });

  it('any state → error on "error" action', () => {
    expect(stateMachineTransition(VoiceAssistantState.Listening, 'error')).toBe(
      VoiceAssistantState.Error,
    );
    expect(stateMachineTransition(VoiceAssistantState.Speaking, 'error')).toBe(
      VoiceAssistantState.Error,
    );
    expect(stateMachineTransition(VoiceAssistantState.Connecting, 'error')).toBe(
      VoiceAssistantState.Error,
    );
  });

  it('error → idle on "reset" action', () => {
    expect(stateMachineTransition(VoiceAssistantState.Error, 'reset')).toBe(
      VoiceAssistantState.Idle,
    );
  });

  it('idle → idle for unknown action (defensive)', () => {
    // Unknown actions on idle must not throw, must return idle.
    expect(stateMachineTransition(VoiceAssistantState.Idle, 'unknown_action')).toBe(
      VoiceAssistantState.Idle,
    );
  });
});

// ---------------------------------------------------------------------------
// 3.1 — buildWsUrl helper
// ---------------------------------------------------------------------------

describe('buildWsUrl', () => {
  it('builds wss:// URL from https API base', () => {
    const url = buildWsUrl('https://api.voxtranslate.app', 'org-123');
    expect(url).toBe(
      'wss://api.voxtranslate.app/api/business/organizations/org-123/voice-assistant',
    );
  });

  it('builds ws:// URL from http API base', () => {
    const url = buildWsUrl('http://localhost:3001', 'org-abc');
    expect(url).toBe('ws://localhost:3001/api/business/organizations/org-abc/voice-assistant');
  });

  it('appends project_id query param when provided', () => {
    const url = buildWsUrl('https://api.example.com', 'org-1', { project_id: 'proj-2' });
    expect(url).toContain('project_id=proj-2');
  });

  it('appends member_id query param when provided', () => {
    const url = buildWsUrl('https://api.example.com', 'org-1', { member_id: 'mem-5' });
    expect(url).toContain('member_id=mem-5');
  });

  it('appends both project_id and member_id', () => {
    const url = buildWsUrl('https://api.example.com', 'org-1', {
      project_id: 'proj-2',
      member_id: 'mem-5',
    });
    expect(url).toContain('project_id=proj-2');
    expect(url).toContain('member_id=mem-5');
  });
});

// ---------------------------------------------------------------------------
// 3.1 — PCM16 conversion
// ---------------------------------------------------------------------------

describe('pcm16FromFloat32', () => {
  it('converts a zero signal to all-zero PCM16 bytes', () => {
    const input = new Float32Array([0, 0, 0]);
    const out = pcm16FromFloat32(input);
    expect(out.byteLength).toBe(6); // 3 samples × 2 bytes
    const view = new DataView(out);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(0);
    expect(view.getInt16(4, true)).toBe(0);
  });

  it('converts +1.0 to max int16 (32767)', () => {
    const input = new Float32Array([1.0]);
    const out = pcm16FromFloat32(input);
    const view = new DataView(out);
    expect(view.getInt16(0, true)).toBe(32767);
  });

  it('converts -1.0 to min int16 (-32768)', () => {
    const input = new Float32Array([-1.0]);
    const out = pcm16FromFloat32(input);
    const view = new DataView(out);
    expect(view.getInt16(0, true)).toBe(-32768);
  });

  it('clips values beyond [-1, 1]', () => {
    const input = new Float32Array([2.0, -3.0]);
    const out = pcm16FromFloat32(input);
    const view = new DataView(out);
    expect(view.getInt16(0, true)).toBe(32767);
    expect(view.getInt16(2, true)).toBe(-32768);
  });

  it('output is little-endian ArrayBuffer', () => {
    const input = new Float32Array([0.5]);
    const out = pcm16FromFloat32(input);
    expect(out).toBeInstanceOf(ArrayBuffer);
    const view = new DataView(out);
    // 0.5 × 32767 ≈ 16383
    expect(view.getInt16(0, true)).toBeCloseTo(16383, -1);
  });
});

// ---------------------------------------------------------------------------
// 3.1 — formatCostDisplay
// ---------------------------------------------------------------------------

describe('formatCostDisplay', () => {
  it('formats 0 credits as €0.00', () => {
    expect(formatCostDisplay(0)).toBe('€0.00');
  });

  it('formats 38 credits as €0.38', () => {
    expect(formatCostDisplay(38)).toBe('€0.38');
  });

  it('formats 100 credits as €1.00', () => {
    expect(formatCostDisplay(100)).toBe('€1.00');
  });
});

// ---------------------------------------------------------------------------
// 3.1 — inbound event shape (type narrowing helpers)
// ---------------------------------------------------------------------------

describe('VoiceAssistantInboundEvent type guards', () => {
  it('recognises cost_tick event shape', () => {
    const ev: VoiceAssistantInboundEvent = {
      type: 'cost_tick',
      duration_s: 10,
      credits_so_far: 6,
      cost_display: '€0.06',
    };
    expect(ev.type).toBe('cost_tick');
  });

  it('recognises session_end event shape', () => {
    const ev: VoiceAssistantInboundEvent = {
      type: 'session_end',
      duration_s: 60,
      credits_used: 38,
      cost_display: '€0.38',
    };
    expect(ev.type).toBe('session_end');
  });

  it('recognises answer_audio event shape', () => {
    const ev: VoiceAssistantInboundEvent = {
      type: 'answer_audio',
      pcm16_b64: 'AAAA',
    };
    expect(ev.type).toBe('answer_audio');
  });

  it('recognises transcript event shape', () => {
    const ev: VoiceAssistantInboundEvent = {
      type: 'transcript',
      role: 'user',
      delta: 'hello',
    };
    expect(ev.type).toBe('transcript');
  });

  it('recognises error event shape', () => {
    const ev: VoiceAssistantInboundEvent = {
      type: 'error',
      code: 'capacity_full',
      message: 'All sessions are currently in use.',
    };
    expect(ev.type).toBe('error');
  });
});
