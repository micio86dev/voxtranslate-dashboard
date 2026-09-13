/**
 * The SharedWorker shell of the Help-Assistant relay.
 *
 * The shell is guarded by `'onconnect' in self`, so it never runs under a plain test
 * import. Here `self` is stubbed with that property before the module is imported,
 * which lets the relay's real port bookkeeping — election, broadcast fan-out, the
 * grace period, PCM forwarding — be driven directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const GRACE_MS = 5000;

// --- fakes -----------------------------------------------------------------

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  readyState = 0;
  binaryType = '';
  sent: unknown[] = [];
  closeCalls = 0;
  private listeners = new Map<string, Array<(ev: unknown) => void>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls++;
    this.readyState = FakeWebSocket.CLOSED;
  }

  private emit(type: string, ev: unknown = {}): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }
  message(data: unknown): void {
    this.emit('message', { data });
  }
  errored(): void {
    this.emit('error');
  }
  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }
  static get last(): FakeWebSocket {
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error('no WebSocket was opened');
    return ws;
  }
}

/** One connected page, seen from the worker side. */
class FakePort {
  received: Array<Record<string, unknown>> = [];
  started = false;
  throwOnPost = false;
  private listeners = new Map<string, Array<(ev: unknown) => void>>();

  postMessage(msg: unknown): void {
    if (this.throwOnPost) throw new Error('port is closed');
    this.received.push(msg as Record<string, unknown>);
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  start(): void {
    this.started = true;
  }

  /** Page → worker. */
  send(data: unknown): void {
    for (const fn of this.listeners.get('message') ?? []) fn({ data });
  }

  /** The page went away. */
  disconnect(): void {
    for (const fn of this.listeners.get('messageerror') ?? []) fn({});
  }

  /** Messages of one type, in arrival order. */
  ofType(type: string): Array<Record<string, unknown>> {
    return this.received.filter((m) => m['type'] === type);
  }

  get lastState(): string | undefined {
    return this.ofType('state_change').at(-1)?.['state'] as string | undefined;
  }
}

// --- harness ---------------------------------------------------------------

let onconnect: (ev: { ports: FakePort[] }) => void;

/** Import the worker shell fresh, with `self` looking like a SharedWorker scope. */
async function loadWorker(): Promise<void> {
  vi.resetModules();
  FakeWebSocket.reset();
  const scope: { onconnect: ((ev: unknown) => void) | null } = { onconnect: null };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('WebSocket', FakeWebSocket);

  await import('./help-assistant.worker');

  if (!scope.onconnect) throw new Error('the worker shell never registered onconnect');
  onconnect = scope.onconnect as (ev: { ports: FakePort[] }) => void;
}

/** Connect one page to the worker. */
function connect(): FakePort {
  const port = new FakePort();
  onconnect({ ports: [port] });
  return port;
}

/** Connect a page and bring a live session up through it. */
function startSession(url = 'wss://relay/voice'): { port: FakePort; ws: FakeWebSocket } {
  const port = connect();
  port.send({ type: 'start', wsUrl: url });
  const ws = FakeWebSocket.last;
  ws.open();
  return { port, ws };
}

beforeEach(async () => {
  vi.useFakeTimers();
  await loadWorker();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// --- tests -----------------------------------------------------------------

describe('connecting a page', () => {
  it('syncs the current state to a newly connected port immediately', () => {
    const port = connect();
    expect(port.received[0]).toEqual({
      type: 'sync',
      state: 'idle',
      transcript: [],
      cost_display: '$0.00',
    });
  });

  it('starts the port so its messages are delivered', () => {
    expect(connect().started).toBe(true);
  });

  it('ignores a connect event carrying no port', () => {
    expect(() => onconnect({ ports: [] })).not.toThrow();
  });

  it('hands a late-joining tab the session already in progress', () => {
    const { ws } = startSession();
    ws.message(JSON.stringify({ type: 'transcript', role: 'user', delta: 'ciao' }));
    ws.message(JSON.stringify({ type: 'cost_tick', duration_s: 10, cost_display: '$0.12' }));

    const second = connect();

    expect(second.received[0]).toEqual({
      type: 'sync',
      state: 'listening',
      transcript: [{ role: 'user', text: 'ciao' }],
      cost_display: '$0.12',
    });
  });

  it('answers get_state on demand', () => {
    const { port } = startSession();
    port.received.length = 0;

    port.send({ type: 'get_state' });

    expect(port.received[0]).toMatchObject({ type: 'sync', state: 'listening' });
  });

  it('hands out a copy, so a page cannot mutate the worker buffer', () => {
    const { ws } = startSession();
    ws.message(JSON.stringify({ type: 'transcript', role: 'user', delta: 'ciao' }));

    const second = connect();
    const snapshot = second.received[0] as { transcript: Array<{ text: string }> };
    snapshot.transcript[0]!.text = 'tampered';

    expect(
      (connect().received[0] as { transcript: Array<{ text: string }> }).transcript[0]!.text,
    ).toBe('ciao');
  });
});

describe('starting a session', () => {
  it('opens the relay socket and announces connecting', () => {
    const port = connect();
    port.send({ type: 'start', wsUrl: 'wss://relay/voice' });

    expect(FakeWebSocket.last.url).toBe('wss://relay/voice');
    expect(FakeWebSocket.last.binaryType).toBe('arraybuffer');
    expect(port.lastState).toBe('connecting');
  });

  it('announces listening once the relay accepts', () => {
    const { port } = startSession();
    expect(port.lastState).toBe('listening');
  });

  it('claims the active port without a URL, so a takeover does not reopen the socket', () => {
    connect().send({ type: 'start' });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('closes the previous socket when a new session starts over it', () => {
    const { ws: first, port } = startSession();
    port.send({ type: 'start', wsUrl: 'wss://relay/second' });

    expect(first.closeCalls).toBe(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});

describe('relaying server events', () => {
  it('broadcasts a transcript delta to every tab', () => {
    const { port, ws } = startSession();
    const observer = connect();

    ws.message(JSON.stringify({ type: 'transcript', role: 'assistant', delta: 'ciao' }));

    expect(port.ofType('transcript')).toHaveLength(1);
    expect(observer.ofType('transcript')[0]).toEqual({
      type: 'transcript',
      role: 'assistant',
      delta: 'ciao',
    });
  });

  it('accumulates consecutive deltas from the same speaker into one entry', () => {
    const { ws } = startSession();
    ws.message(JSON.stringify({ type: 'transcript', role: 'assistant', delta: 'ciao ' }));
    ws.message(JSON.stringify({ type: 'transcript', role: 'assistant', delta: 'a tutti' }));

    expect((connect().received[0] as { transcript: unknown[] }).transcript).toEqual([
      { role: 'assistant', text: 'ciao a tutti' },
    ]);
  });

  it('opens a new entry when the speaker changes', () => {
    const { ws } = startSession();
    ws.message(JSON.stringify({ type: 'transcript', role: 'user', delta: 'domanda' }));
    ws.message(JSON.stringify({ type: 'transcript', role: 'assistant', delta: 'risposta' }));

    expect((connect().received[0] as { transcript: unknown[] }).transcript).toEqual([
      { role: 'user', text: 'domanda' },
      { role: 'assistant', text: 'risposta' },
    ]);
  });

  it('broadcasts the running cost and remembers it for later tabs', () => {
    const { port, ws } = startSession();
    ws.message(JSON.stringify({ type: 'cost_tick', duration_s: 20, cost_display: '$0.24' }));

    expect(port.ofType('cost_tick')[0]).toMatchObject({ cost_display: '$0.24' });
    expect(connect().received[0]).toMatchObject({ cost_display: '$0.24' });
  });

  it('plays answer audio in the active tab only, never echoing in the others', () => {
    const { port, ws } = startSession();
    const observer = connect();

    ws.message(JSON.stringify({ type: 'answer_audio', pcm16_b64: 'AAA' }));

    expect(port.ofType('answer_audio')).toHaveLength(1);
    expect(observer.ofType('answer_audio')).toHaveLength(0);
  });

  it('ends the session on session_end and returns every tab to idle', () => {
    const { port, ws } = startSession();
    const observer = connect();

    ws.message(JSON.stringify({ type: 'session_end', duration_s: 60, cost_display: '$0.72' }));

    expect(port.ofType('session_end')).toHaveLength(1);
    expect(observer.lastState).toBe('idle');
  });

  it('stops forwarding audio once the session has ended', () => {
    const { port, ws } = startSession();
    ws.message(JSON.stringify({ type: 'session_end', duration_s: 1, cost_display: '$0.01' }));
    port.received.length = 0;

    ws.message(JSON.stringify({ type: 'answer_audio', pcm16_b64: 'AAA' }));

    expect(port.ofType('answer_audio')).toHaveLength(0);
  });

  it('broadcasts a server error and latches the error state', () => {
    const { port, ws } = startSession();

    ws.message(JSON.stringify({ type: 'error', code: 'capacity_full', message: 'Busy.' }));

    expect(port.ofType('error')[0]).toMatchObject({ code: 'capacity_full' });
    expect(port.lastState).toBe('error');
  });

  it('reports a transport failure to every tab', () => {
    const { port, ws } = startSession();

    ws.errored();

    expect(port.ofType('error')[0]).toEqual({
      type: 'error',
      code: 'ws_error',
      message: 'WebSocket connection error.',
    });
    expect(port.lastState).toBe('error');
  });

  it('returns to idle when the relay drops the socket', () => {
    const { port, ws } = startSession();
    ws.serverClose();
    expect(port.lastState).toBe('idle');
  });

  it('does not resurrect an errored session on the socket close that follows', () => {
    const { port, ws } = startSession();
    ws.message(JSON.stringify({ type: 'error', code: 'x', message: 'y' }));

    ws.serverClose();

    expect(port.lastState).toBe('error');
  });

  it('ignores a frame that is not JSON', () => {
    const { port, ws } = startSession();
    port.received.length = 0;
    expect(() => ws.message('keepalive')).not.toThrow();
    expect(port.received).toHaveLength(0);
  });

  it('ignores a binary frame', () => {
    const { port, ws } = startSession();
    port.received.length = 0;
    ws.message(new ArrayBuffer(4));
    expect(port.received).toHaveLength(0);
  });

  it('ignores an event type it does not model', () => {
    const { port, ws } = startSession();
    port.received.length = 0;
    ws.message(JSON.stringify({ type: 'speech_started' }));
    expect(port.received).toHaveLength(0);
  });

  it('keeps broadcasting to the surviving tabs when one port throws', () => {
    const { ws } = startSession();
    const broken = connect();
    const healthy = connect();
    broken.throwOnPost = true;

    ws.message(JSON.stringify({ type: 'transcript', role: 'user', delta: 'ciao' }));

    expect(healthy.ofType('transcript')).toHaveLength(1);
  });

  it('survives an active port that throws on answer audio', () => {
    const { port, ws } = startSession();
    port.throwOnPost = true;
    expect(() =>
      ws.message(JSON.stringify({ type: 'answer_audio', pcm16_b64: 'AAA' })),
    ).not.toThrow();
  });
});

describe('microphone frames', () => {
  it('forwards PCM from the active port to the relay', () => {
    const { port, ws } = startSession();
    const pcm = new ArrayBuffer(320);

    port.send({ type: 'audio', pcm });

    expect(ws.sent).toEqual([pcm]);
  });

  it('refuses PCM from a tab that does not own the microphone', () => {
    const { ws } = startSession();
    const observer = connect();

    observer.send({ type: 'audio', pcm: new ArrayBuffer(320) });

    expect(ws.sent).toHaveLength(0);
  });

  it('ignores an audio message carrying something that is not PCM', () => {
    const { port, ws } = startSession();
    port.send({ type: 'audio', pcm: 'not a buffer' });
    expect(ws.sent).toHaveLength(0);
  });

  it('drops PCM once the socket is gone', () => {
    const { port, ws } = startSession();
    ws.serverClose();
    expect(() => port.send({ type: 'audio', pcm: new ArrayBuffer(8) })).not.toThrow();
    expect(ws.sent).toHaveLength(0);
  });
});

describe('stopping', () => {
  it('asks the relay to flush', () => {
    const { port, ws } = startSession();
    port.send({ type: 'stop' });
    expect(ws.sent).toEqual([JSON.stringify({ type: 'stop' })]);
  });

  it('is a no-op with no live socket', () => {
    const port = connect();
    expect(() => port.send({ type: 'stop' })).not.toThrow();
  });

  it('ignores a message type it does not model', () => {
    const { port } = startSession();
    expect(() => port.send({ type: 'nonsense' })).not.toThrow();
  });
});

describe('the grace period after a tab goes away', () => {
  it('keeps the session alive briefly so a navigation can re-adopt it', () => {
    const { port, ws } = startSession();

    port.disconnect();
    vi.advanceTimersByTime(GRACE_MS - 1);

    expect(ws.closeCalls).toBe(0);
  });

  it('tears the session down when nobody comes back', () => {
    const { port, ws } = startSession();
    const observer = connect();

    port.disconnect();
    vi.advanceTimersByTime(GRACE_MS);

    expect(ws.sent).toEqual([JSON.stringify({ type: 'stop' })]);
    expect(ws.closeCalls).toBe(1);
    expect(observer.lastState).toBe('idle');
  });

  it('lets the new page re-adopt the live session without restarting it', () => {
    const { port, ws } = startSession();
    ws.message(JSON.stringify({ type: 'transcript', role: 'user', delta: 'ciao' }));
    port.disconnect();

    const resumed = connect();
    resumed.send({ type: 'resume' });
    vi.advanceTimersByTime(GRACE_MS * 2);

    expect(ws.closeCalls).toBe(0);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(resumed.received.at(-1)).toMatchObject({
      type: 'sync',
      state: 'listening',
      transcript: [{ role: 'user', text: 'ciao' }],
    });
  });

  it('gives the microphone to the resumed page', () => {
    const { port, ws } = startSession();
    port.disconnect();
    const resumed = connect();
    resumed.send({ type: 'resume' });

    const pcm = new ArrayBuffer(160);
    resumed.send({ type: 'audio', pcm });

    expect(ws.sent).toEqual([pcm]);
  });

  it('ignores a resume once the session is really over', () => {
    const { port, ws } = startSession();
    port.disconnect();
    vi.advanceTimersByTime(GRACE_MS);

    const late = connect();
    late.received.length = 0;
    late.send({ type: 'resume' });

    expect(late.received).toHaveLength(0);
    expect(ws.closeCalls).toBe(1);
  });

  it('cancels the grace timer when a fresh session starts instead', () => {
    const { port, ws: first } = startSession();
    port.disconnect();

    const next = connect();
    next.send({ type: 'start', wsUrl: 'wss://relay/second' });
    FakeWebSocket.last.open();
    vi.advanceTimersByTime(GRACE_MS * 2);

    // The first socket was closed by the restart, not by an expired grace timer
    // firing on top of the new session.
    expect(first.closeCalls).toBe(1);
    expect(FakeWebSocket.last.closeCalls).toBe(0);
  });

  it('does not start a grace period for a tab that never owned the microphone', () => {
    const { ws } = startSession();
    const observer = connect();

    observer.disconnect();
    vi.advanceTimersByTime(GRACE_MS * 2);

    expect(ws.closeCalls).toBe(0);
  });

  it('does not schedule a teardown when the socket is already closed', () => {
    const { port, ws } = startSession();
    ws.serverClose();

    port.disconnect();
    vi.advanceTimersByTime(GRACE_MS * 2);

    expect(ws.sent).toHaveLength(0);
  });

  it('stops broadcasting to a disconnected tab', () => {
    const { port, ws } = startSession();
    const observer = connect();
    observer.disconnect();
    observer.received.length = 0;

    ws.message(JSON.stringify({ type: 'transcript', role: 'user', delta: 'ciao' }));

    expect(observer.received).toHaveLength(0);
    expect(port.ofType('transcript')).toHaveLength(1);
  });
});
