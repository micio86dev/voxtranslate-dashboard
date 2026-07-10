/**
 * Unit tests for the SharedWorker logic exported from help-assistant.worker.ts.
 *
 * The SharedWorker shell (self.onconnect / port management) cannot be
 * instantiated in Vitest. Instead, the worker exports pure functions that
 * encode all testable logic:
 *   - workerStateTransition     — state machine (mirrors VA but worker-side)
 *   - buildSyncMessage          — snapshot sent to new ports on connect
 *   - shouldBroadcast           — true for events that go to ALL ports
 *   - targetActivePortOnly      — true for events that go ONLY to the active port
 *
 * Tests are layered:
 *   Layer A — pure state machine
 *   Layer B — sync message construction
 *   Layer C — broadcast routing rules
 *   Layer D — active-port election / grace logic (pure predicates)
 */
import { describe, it, expect } from 'vitest';
import {
  workerStateTransition,
  buildSyncMessage,
  shouldBroadcast,
  targetActivePortOnly,
  type WorkerState,
  type TranscriptEntry,
} from './help-assistant.worker';

// ---------------------------------------------------------------------------
// Layer A — state machine
// ---------------------------------------------------------------------------

describe('workerStateTransition', () => {
  it('idle → connecting on "connect" action', () => {
    const next = workerStateTransition('idle', 'connect');
    expect(next).toBe('connecting');
  });

  it('connecting → listening on "session_ready" action', () => {
    expect(workerStateTransition('connecting', 'session_ready')).toBe('listening');
  });

  it('listening → speaking on "speech_started" action', () => {
    expect(workerStateTransition('listening', 'speech_started')).toBe('speaking');
  });

  it('speaking → listening on "speech_stopped" action', () => {
    expect(workerStateTransition('speaking', 'speech_stopped')).toBe('listening');
  });

  it('listening → idle on "disconnect" action', () => {
    expect(workerStateTransition('listening', 'disconnect')).toBe('idle');
  });

  it('any state → error on "error" action', () => {
    expect(workerStateTransition('idle', 'error')).toBe('error');
    expect(workerStateTransition('listening', 'error')).toBe('error');
    expect(workerStateTransition('speaking', 'error')).toBe('error');
  });

  it('error → idle on "reset" action', () => {
    expect(workerStateTransition('error', 'reset')).toBe('idle');
  });

  it('unknown action leaves state unchanged (defensive)', () => {
    expect(workerStateTransition('idle', 'unknown_action')).toBe('idle');
    expect(workerStateTransition('listening', 'unknown_action')).toBe('listening');
  });
});

// ---------------------------------------------------------------------------
// Layer B — sync message construction
// ---------------------------------------------------------------------------

describe('buildSyncMessage', () => {
  it('returns a sync message with the current state, transcript, and cost', () => {
    const transcript: TranscriptEntry[] = [
      { role: 'user', text: 'Hello' },
      { role: 'assistant', text: 'Hi there!' },
    ];
    const msg = buildSyncMessage('listening', transcript, '€0.06');

    expect(msg.type).toBe('sync');
    expect(msg.state).toBe('listening');
    expect(msg.transcript).toHaveLength(2);
    expect(msg.transcript[0]).toEqual({ role: 'user', text: 'Hello' });
    expect(msg.transcript[1]).toEqual({ role: 'assistant', text: 'Hi there!' });
    expect(msg.cost_display).toBe('€0.06');
  });

  it('builds a sync message with empty transcript when no conversation yet', () => {
    const msg = buildSyncMessage('idle', [], '€0.00');
    expect(msg.type).toBe('sync');
    expect(msg.state).toBe('idle');
    expect(msg.transcript).toEqual([]);
    expect(msg.cost_display).toBe('€0.00');
  });

  it('produces a fresh copy of the transcript array (not the original reference)', () => {
    const transcript: TranscriptEntry[] = [{ role: 'user', text: 'test' }];
    const msg = buildSyncMessage('listening', transcript, '€0.01');
    // Mutating the original must not affect the snapshot
    transcript.push({ role: 'assistant', text: 'extra' });
    expect(msg.transcript).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Layer C — broadcast routing rules
// ---------------------------------------------------------------------------

describe('shouldBroadcast', () => {
  it('returns true for state_change (all tabs need UI updates)', () => {
    expect(shouldBroadcast('state_change')).toBe(true);
  });

  it('returns true for transcript (all tabs show the conversation)', () => {
    expect(shouldBroadcast('transcript')).toBe(true);
  });

  it('returns true for cost_tick (all tabs show cost meter)', () => {
    expect(shouldBroadcast('cost_tick')).toBe(true);
  });

  it('returns true for session_end (all tabs must know the session ended)', () => {
    expect(shouldBroadcast('session_end')).toBe(true);
  });

  it('returns true for error (all tabs should surface errors)', () => {
    expect(shouldBroadcast('error')).toBe(true);
  });

  it('returns false for answer_audio (active port only plays audio)', () => {
    expect(shouldBroadcast('answer_audio')).toBe(false);
  });

  it('returns false for sync (targeted reply to a single port)', () => {
    expect(shouldBroadcast('sync')).toBe(false);
  });
});

describe('targetActivePortOnly', () => {
  it('returns true for answer_audio', () => {
    expect(targetActivePortOnly('answer_audio')).toBe(true);
  });

  it('returns false for broadcast events (they are not active-port-only)', () => {
    expect(targetActivePortOnly('state_change')).toBe(false);
    expect(targetActivePortOnly('transcript')).toBe(false);
    expect(targetActivePortOnly('cost_tick')).toBe(false);
  });

  it('returns false for sync (that is a point-to-point reply, not active-port-only)', () => {
    expect(targetActivePortOnly('sync')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Layer D — WorkerState type: valid state strings
// ---------------------------------------------------------------------------

describe('WorkerState values', () => {
  // Ensure all expected states are valid (compile-time type check via assignment)
  it('covers idle, connecting, listening, speaking, error', () => {
    const states: WorkerState[] = ['idle', 'connecting', 'listening', 'speaking', 'error'];
    expect(states).toHaveLength(5);
    // Each must be accepted by the state machine without exploding
    for (const s of states) {
      const result = workerStateTransition(s, 'unknown');
      expect(result).toBe(s); // unknown action → no change
    }
  });
});
