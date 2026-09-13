/**
 * The `VoiceAssistant` session class.
 *
 * Everything the browser provides — microphone, WebSocket, Web Audio — is faked, so
 * what is exercised is the class's own lifecycle: when the mic opens, what crosses the
 * socket, how server events are folded in, and what is released on teardown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceAssistant, VoiceAssistantState } from './voice-assistant';

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

  // --- drivers
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

class FakeAudioNode {
  disconnectCalls = 0;
  connect(target: unknown): unknown {
    return target;
  }
  disconnect(): void {
    this.disconnectCalls++;
  }
}

class FakeScriptProcessor extends FakeAudioNode {
  static last: FakeScriptProcessor | null = null;
  private handlers: Array<(ev: unknown) => void> = [];

  constructor(
    readonly bufferSize: number,
    readonly inputs: number,
    readonly outputs: number,
  ) {
    super();
    FakeScriptProcessor.last = this;
  }

  addEventListener(_type: string, fn: (ev: unknown) => void): void {
    this.handlers.push(fn);
  }

  /** Deliver one capture buffer the way the audio thread would. */
  capture(samples: Float32Array): void {
    const ev = { inputBuffer: { getChannelData: () => samples } };
    for (const fn of this.handlers) fn(ev);
  }
}

class FakeBufferSource extends FakeAudioNode {
  static started: number[] = [];
  buffer: { duration: number } | null = null;
  start(at: number): void {
    FakeBufferSource.started.push(at);
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  destination = new FakeAudioNode();
  closeCalls = 0;

  constructor(readonly options: { sampleRate: number }) {
    FakeAudioContext.instances.push(this);
  }

  createMediaStreamSource(): FakeAudioNode {
    return new FakeAudioNode();
  }
  createAnalyser(): FakeAudioNode & { fftSize: number } {
    return Object.assign(new FakeAudioNode(), { fftSize: 0 });
  }
  createScriptProcessor(size: number, i: number, o: number): FakeScriptProcessor {
    return new FakeScriptProcessor(size, i, o);
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return {
      duration: length / rate,
      copyToChannel: vi.fn(),
    };
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource();
  }
  async close(): Promise<void> {
    this.closeCalls++;
  }

  static reset(): void {
    FakeAudioContext.instances = [];
  }
  static get last(): FakeAudioContext {
    const ctx = FakeAudioContext.instances.at(-1);
    if (!ctx) throw new Error('no AudioContext was created');
    return ctx;
  }
}

class FakeTrack {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

class FakeMediaStream {
  tracks = [new FakeTrack(), new FakeTrack()];
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

// --- harness ---------------------------------------------------------------

function makeAssistant(opts: { orgId?: string; projectId?: string; memberId?: string } = {}) {
  const callbacks = {
    onStateChange: vi.fn(),
    onTranscript: vi.fn(),
    onCostTick: vi.fn(),
    onSessionEnd: vi.fn(),
    onError: vi.fn(),
  };
  const assistant = new VoiceAssistant({ orgId: 'org-1', ...opts }, callbacks);
  return { assistant, callbacks };
}

/** base64-encode raw bytes the way the server does. */
function pcm16Base64(samples: number[]): string {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  samples.forEach((s, i) => view.setInt16(i * 2, s, true));
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin);
}

let getUserMedia: ReturnType<typeof vi.fn>;
let stream: FakeMediaStream;

beforeEach(() => {
  FakeWebSocket.reset();
  FakeAudioContext.reset();
  FakeScriptProcessor.last = null;
  FakeBufferSource.started = [];
  stream = new FakeMediaStream();
  getUserMedia = vi.fn(async () => stream);

  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Start a session and bring the socket up. */
async function connected(opts = {}) {
  const harness = makeAssistant(opts);
  await harness.assistant.start();
  FakeWebSocket.last.open();
  return harness;
}

// --- tests -----------------------------------------------------------------

describe('start', () => {
  it('asks for the microphone, audio only', async () => {
    const { assistant } = makeAssistant();
    await assistant.start();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
  });

  it('moves to connecting before any hardware is touched', async () => {
    const { assistant, callbacks } = makeAssistant();
    await assistant.start();
    expect(callbacks.onStateChange).toHaveBeenNthCalledWith(1, VoiceAssistantState.Connecting);
  });

  it('reaches listening once the relay accepts the socket', async () => {
    const { assistant, callbacks } = await connected();
    expect(assistant.currentState).toBe(VoiceAssistantState.Listening);
    expect(callbacks.onStateChange).toHaveBeenLastCalledWith(VoiceAssistantState.Listening);
  });

  it('reports a refused microphone as mic_denied and opens no socket', async () => {
    getUserMedia.mockRejectedValue(new Error('Permission denied'));
    const { assistant, callbacks } = makeAssistant();

    await assistant.start();

    expect(assistant.currentState).toBe(VoiceAssistantState.Error);
    expect(callbacks.onError).toHaveBeenCalledWith('mic_denied', 'Permission denied');
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('still reports mic_denied when the browser throws a non-Error', async () => {
    getUserMedia.mockRejectedValue('NotAllowedError');
    const { assistant, callbacks } = makeAssistant();

    await assistant.start();

    expect(callbacks.onError).toHaveBeenCalledWith('mic_denied', 'Microphone access denied.');
  });

  it('refuses to start a second session over a live one', async () => {
    const { assistant } = await connected();
    await assistant.start();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('scopes the socket to the organization', async () => {
    const { assistant } = makeAssistant();
    await assistant.start();
    expect(FakeWebSocket.last.url).toContain('/api/business/organizations/org-1/voice-assistant');
    expect(FakeWebSocket.last.url.startsWith('ws')).toBe(true);
  });

  it('carries the project and member scope when given', async () => {
    const { assistant } = makeAssistant({ projectId: 'p1', memberId: 'm1' });
    await assistant.start();
    const url = new URL(FakeWebSocket.last.url.replace(/^ws/, 'http'));
    expect(url.searchParams.get('project_id')).toBe('p1');
    expect(url.searchParams.get('member_id')).toBe('m1');
  });

  it('passes the stored token as a query param, since a WS carries no headers', async () => {
    localStorage.setItem('voxb.token', 'tok/with+chars');
    const { assistant } = makeAssistant({ projectId: 'p1' });

    await assistant.start();

    const url = new URL(FakeWebSocket.last.url.replace(/^ws/, 'http'));
    expect(url.searchParams.get('token')).toBe('tok/with+chars');
    // The scope params must survive the append.
    expect(url.searchParams.get('project_id')).toBe('p1');
  });

  it('opens an unauthenticated socket when there is no stored token', async () => {
    const { assistant } = makeAssistant();
    await assistant.start();
    expect(FakeWebSocket.last.url).not.toContain('token=');
  });

  it('reads binary frames as ArrayBuffers', async () => {
    const { assistant } = makeAssistant();
    await assistant.start();
    expect(FakeWebSocket.last.binaryType).toBe('arraybuffer');
  });
});

describe('audio capture', () => {
  it('runs the context at the rate the realtime session declares', async () => {
    await connected();
    // 24 kHz for capture AND playback: resampling per chunk left boundary artifacts
    // that accumulated into growing noise over a turn.
    expect(FakeAudioContext.last.options.sampleRate).toBe(24000);
  });

  it('exposes an analyser sized for the waveform animation', async () => {
    const { assistant } = await connected();
    expect(assistant.analyserNode).not.toBeNull();
    expect((assistant.analyserNode as unknown as { fftSize: number }).fftSize).toBe(256);
  });

  it('streams captured PCM16 onto the open socket', async () => {
    await connected();
    FakeScriptProcessor.last?.capture(new Float32Array([0, 1, -1]));

    const sent = FakeWebSocket.last.sent;
    expect(sent).toHaveLength(1);
    const samples = new Int16Array(sent[0] as ArrayBuffer);
    expect(Array.from(samples)).toEqual([0, 32767, -32768]);
  });

  it('drops captured audio once the socket is no longer open', async () => {
    await connected();
    FakeWebSocket.last.readyState = FakeWebSocket.CLOSED;
    FakeScriptProcessor.last?.capture(new Float32Array([0.5]));
    expect(FakeWebSocket.last.sent).toHaveLength(0);
  });

  it('releases the microphone and the context on teardown', async () => {
    const { assistant } = await connected();
    const ctx = FakeAudioContext.last;

    assistant.stop();

    expect(stream.tracks.every((t) => t.stopped)).toBe(true);
    expect(ctx.closeCalls).toBe(1);
    expect(assistant.analyserNode).toBeNull();
  });
});

describe('server events', () => {
  it('forwards transcript deltas with their role', async () => {
    const { callbacks } = await connected();
    FakeWebSocket.last.message(
      JSON.stringify({ type: 'transcript', role: 'assistant', delta: 'ciao' }),
    );
    expect(callbacks.onTranscript).toHaveBeenCalledWith('assistant', 'ciao');
  });

  it('forwards the running cost', async () => {
    const { callbacks } = await connected();
    FakeWebSocket.last.message(
      JSON.stringify({
        type: 'cost_tick',
        duration_s: 30,
        credits_so_far: 38,
        cost_display: '$0.38',
      }),
    );
    expect(callbacks.onCostTick).toHaveBeenCalledWith(30, 38, '$0.38');
  });

  it('closes the socket and reports the summary on session_end', async () => {
    const { assistant, callbacks } = await connected();
    const ws = FakeWebSocket.last;

    ws.message(
      JSON.stringify({
        type: 'session_end',
        duration_s: 120,
        credits_used: 150,
        cost_display: '$1.50',
      }),
    );

    expect(callbacks.onSessionEnd).toHaveBeenCalledWith(120, 150, '$1.50');
    expect(ws.closeCalls).toBe(1);
    expect(assistant.currentState).toBe(VoiceAssistantState.Idle);
  });

  it('surfaces a server error and hangs up', async () => {
    const { assistant, callbacks } = await connected();
    const ws = FakeWebSocket.last;

    ws.message(
      JSON.stringify({ type: 'error', code: 'credits_exhausted', message: 'Out of credit.' }),
    );

    expect(callbacks.onError).toHaveBeenCalledWith('credits_exhausted', 'Out of credit.');
    expect(assistant.currentState).toBe(VoiceAssistantState.Error);
    expect(ws.closeCalls).toBe(1);
  });

  it('ignores a frame that is not JSON', async () => {
    const { callbacks } = await connected();
    expect(() => FakeWebSocket.last.message('keepalive')).not.toThrow();
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
  });

  it('ignores a binary frame', async () => {
    const { callbacks } = await connected();
    FakeWebSocket.last.message(new ArrayBuffer(8));
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
  });

  it('ignores an event type it does not model', async () => {
    const { assistant, callbacks } = await connected();
    FakeWebSocket.last.message(JSON.stringify({ type: 'speech_started' }));
    expect(assistant.currentState).toBe(VoiceAssistantState.Listening);
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});

describe('answer playback', () => {
  it('queues chunks back to back instead of stacking them at "now"', async () => {
    // Every chunk starting at `now` is what made the AI voice play on top of itself.
    await connected();
    const ws = FakeWebSocket.last;
    const chunk = pcm16Base64(new Array(2400).fill(0));

    ws.message(JSON.stringify({ type: 'answer_audio', pcm16_b64: chunk }));
    ws.message(JSON.stringify({ type: 'answer_audio', pcm16_b64: chunk }));

    expect(FakeBufferSource.started).toHaveLength(2);
    expect(FakeBufferSource.started[1]).toBeCloseTo(0.1, 5);
  });

  it('starts at "now" again after a gap between turns', async () => {
    await connected();
    const ws = FakeWebSocket.last;
    const chunk = pcm16Base64(new Array(2400).fill(0));

    ws.message(JSON.stringify({ type: 'answer_audio', pcm16_b64: chunk }));
    FakeAudioContext.last.currentTime = 30; // the user spoke for a while
    ws.message(JSON.stringify({ type: 'answer_audio', pcm16_b64: chunk }));

    expect(FakeBufferSource.started[1]).toBe(30);
  });

  it('resets the playback cursor for a fresh session', async () => {
    const { assistant } = await connected();
    const chunk = pcm16Base64(new Array(24_000).fill(0));
    FakeWebSocket.last.message(JSON.stringify({ type: 'answer_audio', pcm16_b64: chunk }));
    assistant.stop();
    FakeWebSocket.last.serverClose();

    FakeBufferSource.started = [];
    await assistant.start();
    FakeWebSocket.last.open();
    FakeWebSocket.last.message(JSON.stringify({ type: 'answer_audio', pcm16_b64: chunk }));

    // A stale cursor would have delayed this by a whole second.
    expect(FakeBufferSource.started[0]).toBe(0);
  });

  it('drops answer audio arriving with no audio context', async () => {
    const { assistant } = await connected();
    const ws = FakeWebSocket.last;
    assistant.stop();

    expect(() =>
      ws.message(JSON.stringify({ type: 'answer_audio', pcm16_b64: pcm16Base64([0, 1]) })),
    ).not.toThrow();
  });
});

describe('stop and disconnect', () => {
  it('tells the server to flush before closing the mic', async () => {
    const { assistant } = await connected();
    const ws = FakeWebSocket.last;

    assistant.stop();

    expect(ws.sent).toEqual([JSON.stringify({ type: 'stop' })]);
    expect(assistant.currentState).toBe(VoiceAssistantState.Idle);
  });

  it('still tears down when the socket is already gone', async () => {
    const { assistant } = await connected();
    FakeWebSocket.last.readyState = FakeWebSocket.CLOSED;

    assistant.stop();

    expect(FakeWebSocket.last.sent).toHaveLength(0);
    expect(stream.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('is safe to call before anything started', () => {
    const { assistant } = makeAssistant();
    expect(() => assistant.stop()).not.toThrow();
    expect(assistant.currentState).toBe(VoiceAssistantState.Idle);
  });

  it('returns to idle when the server drops the socket', async () => {
    const { assistant } = await connected();
    FakeWebSocket.last.serverClose();
    expect(assistant.currentState).toBe(VoiceAssistantState.Idle);
    expect(stream.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('leaves an errored session in error rather than resetting it to idle', async () => {
    const { assistant } = await connected();
    FakeWebSocket.last.message(
      JSON.stringify({ type: 'error', code: 'capacity_full', message: 'Busy.' }),
    );

    FakeWebSocket.last.serverClose();

    expect(assistant.currentState).toBe(VoiceAssistantState.Error);
  });

  it('reports a transport failure as ws_error', async () => {
    const { assistant, callbacks } = await connected();

    FakeWebSocket.last.errored();

    expect(callbacks.onError).toHaveBeenCalledWith('ws_error', 'WebSocket connection error.');
    expect(assistant.currentState).toBe(VoiceAssistantState.Error);
  });

  it('cancels a pending animation frame on teardown', async () => {
    const { assistant } = await connected();
    assistant.stop();
    // Nothing scheduled one, so the guard must not call it with null.
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
  });
});
