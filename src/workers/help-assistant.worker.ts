/**
 * SharedWorker: Help-Assistant WebSocket relay + buffer manager.
 *
 * Responsibilities (worker-side only):
 *   - WebSocket lifecycle (open, relay binary frames, relay text events)
 *   - Text buffers: state, transcript[], current cost display string
 *   - Port lifecycle: tracking active ports, broadcasting events
 *   - Active-port election: the port that sent 'start' is the audio-active port
 *
 * NOT the worker's responsibility (stays on the page):
 *   - getUserMedia / AudioContext / AudioNode (no access in Workers)
 *   - DOM manipulation
 *   - PCM16 capture (page sends binary frames via port.postMessage)
 *   - Playback of answer_audio (page receives it from active-port message)
 *
 * The pure exported functions (workerStateTransition, buildSyncMessage,
 * shouldBroadcast, targetActivePortOnly) are unit-tested in Vitest.
 * The SharedWorker shell (self.onconnect) is thin glue and not unit-tested.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkerState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
}

type WorkerAction =
  | 'connect'
  | 'session_ready'
  | 'speech_started'
  | 'speech_stopped'
  | 'disconnect'
  | 'error'
  | 'reset'
  | string;

// Worker → Page message types
type OutboundMessageType =
  | 'state_change'
  | 'transcript'
  | 'cost_tick'
  | 'session_end'
  | 'error'
  | 'sync'
  | 'answer_audio';

// ---------------------------------------------------------------------------
// Pure exported functions (unit-testable)
// ---------------------------------------------------------------------------

/**
 * Pure state transition function for the worker state machine.
 * Unknown actions on any state return the current state unchanged (defensive).
 */
export function workerStateTransition(state: WorkerState, action: WorkerAction): WorkerState {
  if (action === 'error') return 'error';
  if (action === 'reset') return 'idle';

  switch (state) {
    case 'idle':
      if (action === 'connect') return 'connecting';
      return 'idle';

    case 'connecting':
      if (action === 'session_ready') return 'listening';
      return 'connecting';

    case 'listening':
      if (action === 'speech_started') return 'speaking';
      if (action === 'disconnect') return 'idle';
      return 'listening';

    case 'speaking':
      if (action === 'speech_stopped') return 'listening';
      if (action === 'disconnect') return 'idle';
      return 'speaking';

    case 'error':
      return 'error';

    default:
      return state;
  }
}

/**
 * Build the sync snapshot sent to a newly connected port.
 * Returns a fresh copy of the transcript array so the caller cannot
 * mutate the worker's internal buffer through the snapshot reference.
 */
export function buildSyncMessage(
  state: WorkerState,
  transcript: TranscriptEntry[],
  costDisplay: string,
): { type: 'sync'; state: WorkerState; transcript: TranscriptEntry[]; cost_display: string } {
  return {
    type: 'sync',
    state,
    transcript: transcript.map((e) => ({ ...e })), // shallow copy per entry
    cost_display: costDisplay,
  };
}

/**
 * Returns true if the given outbound event type should be broadcast to ALL
 * connected ports (e.g. transcript, cost_tick, state_change).
 */
export function shouldBroadcast(type: OutboundMessageType | string): boolean {
  switch (type) {
    case 'state_change':
    case 'transcript':
    case 'cost_tick':
    case 'session_end':
    case 'error':
      return true;
    default:
      return false;
  }
}

/**
 * Returns true if the given outbound event type should be delivered ONLY to
 * the active port (the one that sent 'start' and owns the mic capture).
 * Currently only answer_audio qualifies — playback must not echo in other tabs.
 */
export function targetActivePortOnly(type: OutboundMessageType | string): boolean {
  return type === 'answer_audio';
}

// ---------------------------------------------------------------------------
// SharedWorker shell (thin glue — not unit-tested)
// ---------------------------------------------------------------------------

// Guard: this file is also imported by Vitest (Node/jsdom), where
// `SharedWorkerGlobalScope` and `self.onconnect` do not exist.
// Only wire up the SharedWorker shell when running inside an actual worker.
if (typeof self !== 'undefined' && 'onconnect' in self) {
  // Worker-level mutable state
  let ws: WebSocket | null = null;
  let workerState: WorkerState = 'idle';
  const transcript: TranscriptEntry[] = [];
  let costDisplay = '€0.00';
  let activePort: MessagePort | null = null;
  let gracePeriodTimer: ReturnType<typeof setTimeout> | null = null;

  const GRACE_MS = 5000;

  const ports: Set<MessagePort> = new Set();

  /** Broadcast a message to all connected ports. */
  function broadcast(msg: unknown): void {
    for (const p of ports) {
      try {
        p.postMessage(msg);
      } catch {
        // Port might be closed; ignore errors here
      }
    }
  }

  /** Send a message only to the active port. */
  function sendToActivePort(msg: unknown): void {
    if (activePort) {
      try {
        activePort.postMessage(msg);
      } catch {
        // Active port closed; grace period will handle teardown
      }
    }
  }

  /** Transition the worker state and broadcast the change. */
  function transition(action: WorkerAction): void {
    const next = workerStateTransition(workerState, action);
    if (next !== workerState) {
      workerState = next;
      broadcast({ type: 'state_change', state: workerState });
    }
  }

  /** Accumulate a transcript delta into the running buffer. */
  function appendTranscript(role: 'user' | 'assistant', delta: string): void {
    const last = transcript[transcript.length - 1];
    if (last && last.role === role) {
      last.text += delta;
    } else {
      transcript.push({ role, text: delta });
    }
  }

  /** Open a WebSocket to the given URL. */
  function openWs(wsUrl: string): void {
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }

    transition('connect');
    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      transition('session_ready');
    });

    ws.addEventListener('message', (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = msg['type'] as string;

      switch (type) {
        case 'transcript': {
          const role = msg['role'] as 'user' | 'assistant';
          const delta = msg['delta'] as string;
          appendTranscript(role, delta);
          broadcast({ type: 'transcript', role, delta });
          break;
        }
        case 'cost_tick': {
          costDisplay = msg['cost_display'] as string;
          broadcast(msg);
          break;
        }
        case 'session_end': {
          costDisplay = msg['cost_display'] as string;
          broadcast(msg);
          transition('disconnect');
          ws = null;
          activePort = null;
          break;
        }
        case 'error': {
          broadcast(msg);
          transition('error');
          break;
        }
        case 'answer_audio': {
          // Only the active port plays audio (no echo in other tabs)
          sendToActivePort(msg);
          break;
        }
        default:
          break;
      }
    });

    ws.addEventListener('close', () => {
      if (workerState !== 'idle' && workerState !== 'error') {
        transition('disconnect');
      }
      ws = null;
    });

    ws.addEventListener('error', () => {
      broadcast({ type: 'error', code: 'ws_error', message: 'WebSocket connection error.' });
      transition('error');
      ws = null;
    });
  }

  /** Close the WS and reset state — called after grace period expires. */
  function teardown(): void {
    if (ws) {
      try {
        ws.send(JSON.stringify({ type: 'stop' }));
        ws.close();
      } catch {
        // ignore
      }
      ws = null;
    }
    activePort = null;
    workerState = 'idle';
    broadcast({ type: 'state_change', state: 'idle' });
  }

  /** Handle a port disconnecting (messageerror or explicit close). */
  function handlePortDisconnect(port: MessagePort): void {
    ports.delete(port);

    if (port !== activePort) return;

    // The active port disconnected — start grace period
    activePort = null;

    if (gracePeriodTimer !== null) {
      clearTimeout(gracePeriodTimer);
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      // Keep WS alive in read-only mode for the grace period
      gracePeriodTimer = setTimeout(() => {
        gracePeriodTimer = null;
        teardown();
      }, GRACE_MS);
    }
  }

  // SharedWorker entry point
  // SharedWorkerGlobalScope is not in the default lib; cast through unknown.
  interface SharedWorkerSelf {
    onconnect: ((ev: MessageEvent) => void) | null;
  }
  (self as unknown as SharedWorkerSelf).onconnect = (ev: MessageEvent): void => {
    const port = ev.ports[0];
    if (!port) return;

    ports.add(port);

    // Send current state immediately to the new port
    port.postMessage(buildSyncMessage(workerState, transcript, costDisplay));

    port.addEventListener('message', (msgEv: MessageEvent) => {
      const data = msgEv.data as { type: string; wsUrl?: string; pcm?: ArrayBuffer };

      switch (data.type) {
        case 'start': {
          // Cancel any pending grace timer — new port is taking over
          if (gracePeriodTimer !== null) {
            clearTimeout(gracePeriodTimer);
            gracePeriodTimer = null;
          }
          activePort = port;
          if (data.wsUrl) {
            openWs(data.wsUrl);
          }
          break;
        }

        case 'resume': {
          // Re-adopt a live session after a page navigation: become the active
          // port and cancel the teardown grace timer WITHOUT restarting the WS.
          // If the session already ended (grace expired, WS gone), this is a
          // no-op — the page already got an 'idle' sync and stays idle.
          if (ws && ws.readyState === WebSocket.OPEN) {
            if (gracePeriodTimer !== null) {
              clearTimeout(gracePeriodTimer);
              gracePeriodTimer = null;
            }
            activePort = port;
            port.postMessage(buildSyncMessage(workerState, transcript, costDisplay));
          }
          break;
        }

        case 'stop': {
          if (ws && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'stop' }));
            } catch {
              // ignore
            }
          }
          break;
        }

        case 'audio': {
          // Only forward PCM frames from the active port
          if (port !== activePort) break;
          if (ws && ws.readyState === WebSocket.OPEN && data.pcm instanceof ArrayBuffer) {
            try {
              ws.send(data.pcm);
            } catch {
              // ignore
            }
          }
          break;
        }

        case 'get_state': {
          port.postMessage(buildSyncMessage(workerState, transcript, costDisplay));
          break;
        }

        default:
          break;
      }
    });

    port.addEventListener('messageerror', () => {
      handlePortDisconnect(port);
    });

    port.start();
  };
}
