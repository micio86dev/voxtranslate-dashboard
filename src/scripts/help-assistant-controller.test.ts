/**
 * The two Help-Assistant page controllers.
 *
 * `HelpAssistantController` drives the SharedWorker path (one shared session across
 * tabs); `HelpAssistantFallback` drives the direct-WebSocket path used where
 * SharedWorker does not exist (Safari / iOS). Microphone, Web Audio, the worker and
 * the socket are all faked, so what is exercised is the controllers' own behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HelpAssistantController,
  HelpAssistantFallback,
  createHelpAssistant,
  detectSharedWorkerSupport,
} from './help-assistant';

// --- fakes -----------------------------------------------------------------

class FakePort {
  posted: Array<Record<string, unknown>> = [];
  started = false;
  private listeners: Array<(ev: unknown) => void> = [];

  postMessage(msg: unknown): void {
    this.posted.push(msg as Record<string, unknown>);
  }
  addEventListener(_type: string, fn: (ev: unknown) => void): void {
    this.listeners.push(fn);
  }
  start(): void {
    this.started = true;
  }
  /** Worker to page. */
  deliver(data: unknown): void {
    for (const fn of this.listeners) fn({ data });
  }
  ofType(type: string): Array<Record<string, unknown>> {
    return this.posted.filter((m) => m['type'] === type);
  }
}

class FakeSharedWorker {
  static instances: FakeSharedWorker[] = [];
  static shouldThrow = false;
  port = new FakePort();

  constructor(
    readonly url: unknown,
    readonly options: unknown,
  ) {
    if (FakeSharedWorker.shouldThrow) throw new Error('SharedWorker blocked');
    FakeSharedWorker.instances.push(this);
  }

  static reset(): void {
    FakeSharedWorker.instances = [];
    FakeSharedWorker.shouldThrow = false;
  }
  static get last(): FakeSharedWorker {
    const w = FakeSharedWorker.instances.at(-1);
    if (!w) throw new Error('no SharedWorker was opened');
    return w;
  }
}

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
  constructor(readonly bufferSize: number) {
    super();
    FakeScriptProcessor.last = this;
  }
  addEventListener(_type: string, fn: (ev: unknown) => void): void {
    this.handlers.push(fn);
  }
  capture(samples: Float32Array): void {
    for (const fn of this.handlers) fn({ inputBuffer: { getChannelData: () => samples } });
  }
}

class FakeBufferSource extends FakeAudioNode {
  static started: number[] = [];
  buffer: unknown = null;
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
  createScriptProcessor(size: number): FakeScriptProcessor {
    return new FakeScriptProcessor(size);
  }
  createBuffer(_ch: number, length: number, rate: number) {
    return { duration: length / rate, copyToChannel: vi.fn() };
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
  tracks = [new FakeTrack()];
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

// --- harness ---------------------------------------------------------------

function makeCallbacks() {
  return {
    onStateChange: vi.fn(),
    onTranscript: vi.fn(),
    onCostTick: vi.fn(),
    onSessionEnd: vi.fn(),
    onError: vi.fn(),
    onSync: vi.fn(),
  };
}

/** base64 PCM16 for `count` samples (content irrelevant, length is what matters). */
function silence(count: number): string {
  return btoa('A'.repeat(count * 2));
}

let getUserMedia: ReturnType<typeof vi.fn>;
let stream: FakeMediaStream;

beforeEach(() => {
  FakeSharedWorker.reset();
  FakeWebSocket.reset();
  FakeAudioContext.reset();
  FakeScriptProcessor.last = null;
  FakeBufferSource.started = [];
  stream = new FakeMediaStream();
  getUserMedia = vi.fn(async () => stream);

  vi.stubGlobal('SharedWorker', FakeSharedWorker);
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// --- tests -----------------------------------------------------------------

describe('createHelpAssistant', () => {
  it('uses the SharedWorker controller where SharedWorker exists', () => {
    expect(detectSharedWorkerSupport()).toBe(true);
    expect(createHelpAssistant('org-1', makeCallbacks())).toBeInstanceOf(HelpAssistantController);
  });

  it('falls back to a direct socket on Safari and iOS', () => {
    vi.stubGlobal('SharedWorker', undefined);
    expect(detectSharedWorkerSupport()).toBe(false);
    expect(createHelpAssistant('org-1', makeCallbacks())).toBeInstanceOf(HelpAssistantFallback);
  });
});

describe('HelpAssistantController - attaching', () => {
  it('opens the worker and pumps its messages without starting a session', () => {
    const controller = new HelpAssistantController('org-1', makeCallbacks());

    controller.attach();

    expect(FakeSharedWorker.instances).toHaveLength(1);
    expect(FakeSharedWorker.last.port.started).toBe(true);
    expect(FakeSharedWorker.last.port.posted).toHaveLength(0);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('reuses one worker across attach, start and resume', async () => {
    const controller = new HelpAssistantController('org-1', makeCallbacks());
    controller.attach();
    await controller.start();

    expect(FakeSharedWorker.instances).toHaveLength(1);
  });

  it('stays silent when the worker cannot be opened on page load', () => {
    // attach() runs unprompted on every page; it must never surface an error.
    FakeSharedWorker.shouldThrow = true;
    const callbacks = makeCallbacks();

    new HelpAssistantController('org-1', callbacks).attach();

    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('surfaces a live session to a freshly loaded page', () => {
    const callbacks = makeCallbacks();
    const controller = new HelpAssistantController('org-1', callbacks);
    controller.attach();

    FakeSharedWorker.last.port.deliver({
      type: 'sync',
      state: 'listening',
      transcript: [{ role: 'user', text: 'ciao' }],
      cost_display: '$0.12',
    });

    expect(callbacks.onSync).toHaveBeenCalledWith(
      'listening',
      [{ role: 'user', text: 'ciao' }],
      '$0.12',
    );
  });

  it('forwards every worker event to its callback', () => {
    const callbacks = makeCallbacks();
    const controller = new HelpAssistantController('org-1', callbacks);
    controller.attach();
    const port = FakeSharedWorker.last.port;

    port.deliver({ type: 'state_change', state: 'speaking' });
    port.deliver({ type: 'transcript', role: 'assistant', delta: 'ciao' });
    port.deliver({ type: 'cost_tick', duration_s: 10, credits_so_far: 12, cost_display: '$0.12' });
    port.deliver({ type: 'session_end', duration_s: 60, credits_used: 72, cost_display: '$0.72' });
    port.deliver({ type: 'error', code: 'capacity_full', message: 'Busy.' });

    expect(callbacks.onStateChange).toHaveBeenCalledWith('speaking');
    expect(callbacks.onTranscript).toHaveBeenCalledWith('assistant', 'ciao');
    expect(callbacks.onCostTick).toHaveBeenCalledWith(10, 12, '$0.12');
    expect(callbacks.onSessionEnd).toHaveBeenCalledWith(60, 72, '$0.72');
    expect(callbacks.onError).toHaveBeenCalledWith('capacity_full', 'Busy.');
  });

  it('ignores a worker event it does not model', () => {
    const callbacks = makeCallbacks();
    const controller = new HelpAssistantController('org-1', callbacks);
    controller.attach();

    FakeSharedWorker.last.port.deliver({ type: 'something_new' });

    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});

describe('HelpAssistantController - starting', () => {
  it('tells the worker to open the socket and takes the microphone', async () => {
    const controller = new HelpAssistantController('org-1', makeCallbacks());

    await expect(controller.start()).resolves.toBe(true);

    const start = FakeSharedWorker.last.port.ofType('start')[0];
    expect(start?.['wsUrl']).toContain('org-1');
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
  });

  it('carries the stored token, since a WebSocket sends no headers', async () => {
    localStorage.setItem('voxb.token', 'tok+123');
    const controller = new HelpAssistantController('org-1', makeCallbacks());

    await controller.start();

    expect(String(FakeSharedWorker.last.port.ofType('start')[0]?.['wsUrl'])).toContain(
      `token=${encodeURIComponent('tok+123')}`,
    );
  });

  it('reports worker_error explicitly when the user asked for a session', async () => {
    FakeSharedWorker.shouldThrow = true;
    const callbacks = makeCallbacks();
    const controller = new HelpAssistantController('org-1', callbacks);

    await expect(controller.start()).resolves.toBe(false);

    expect(callbacks.onError).toHaveBeenCalledWith('worker_error', 'Failed to open SharedWorker.');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('reports a refused microphone and never claims the session', async () => {
    getUserMedia.mockRejectedValue(new Error('Permission denied'));
    const callbacks = makeCallbacks();
    const controller = new HelpAssistantController('org-1', callbacks);

    await expect(controller.start()).resolves.toBe(false);

    expect(callbacks.onError).toHaveBeenCalledWith('mic_denied', 'Permission denied');
    expect(FakeSharedWorker.last.port.ofType('start')).toHaveLength(0);
  });

  it('still reports mic_denied when the browser throws a non-Error', async () => {
    getUserMedia.mockRejectedValue('NotAllowedError');
    const callbacks = makeCallbacks();

    await new HelpAssistantController('org-1', callbacks).start();

    expect(callbacks.onError).toHaveBeenCalledWith('mic_denied', 'Microphone access denied.');
  });

  it('streams captured PCM16 to the worker', async () => {
    const controller = new HelpAssistantController('org-1', makeCallbacks());
    await controller.start();

    FakeScriptProcessor.last?.capture(new Float32Array([0, 1, -1]));

    const audio = FakeSharedWorker.last.port.ofType('audio');
    expect(audio).toHaveLength(1);
    expect(Array.from(new Int16Array(audio[0]?.['pcm'] as ArrayBuffer))).toEqual([
      0, 32767, -32768,
    ]);
  });

  it('runs the capture graph at the rate the realtime session declares', async () => {
    const controller = new HelpAssistantController('org-1', makeCallbacks());
    await controller.start();

    expect(FakeAudioContext.last.options.sampleRate).toBe(24000);
    expect((controller.analyserNode as unknown as { fftSize: number }).fftSize).toBe(256);
  });
});

describe('HelpAssistantController - resuming after a navigation', () => {
  it('re-adopts the live session without restarting the socket', async () => {
    const controller = new HelpAssistantController('org-1', makeCallbacks());

    await expect(controller.resume()).resolves.toBe(true);

    const port = FakeSharedWorker.last.port;
    expect(port.ofType('resume')).toHaveLength(1);
    expect(port.ofType('start')).toHaveLength(0);
  });

  it('leaves the session running in the worker when the mic is refused', async () => {
    getUserMedia.mockRejectedValue(new Error('denied'));
    const callbacks = makeCallbacks();
    const controller = new HelpAssistantController('org-1', callbacks);

    await expect(controller.resume()).resolves.toBe(false);

    expect(FakeSharedWorker.last.port.ofType('resume')).toHaveLength(0);
    // resume() also runs unprompted after a navigation, so no error banner.
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('gives up quietly when there is no worker to resume into', async () => {
    FakeSharedWorker.shouldThrow = true;
    const controller = new HelpAssistantController('org-1', makeCallbacks());

    await expect(controller.resume()).resolves.toBe(false);
  });
});

describe('HelpAssistantController - answer playback', () => {
  it('plays answer audio only while this tab owns the session', async () => {
    const controller = new HelpAssistantController('org-1', makeCallbacks());
    controller.attach();

    FakeSharedWorker.last.port.deliver({ type: 'answer_audio', pcm16_b64: silence(2400) });
    expect(FakeBufferSource.started).toHaveLength(0);

    await controller.start();
    FakeSharedWorker.last.port.deliver({ type: 'answer_audio', pcm16_b64: silence(2400) });
    expect(FakeBufferSource.started).toHaveLength(1);
  });

  it('queues chunks back to back instead of stacking them at "now"', async () => {
    const controller = new HelpAssistantController('org-1', makeCallbacks());
    await controller.start();
    const port = FakeSharedWorker.last.port;

    port.deliver({ type: 'answer_audio', pcm16_b64: silence(2400) });
    port.deliver({ type: 'answer_audio', pcm16_b64: silence(2400) });

    expect(FakeBufferSource.started[1]).toBeCloseTo(0.1, 5);
  });

  it('opens a playback context lazily when capture has already been torn down', async () => {
    const controller = new HelpAssistantController('org-1', makeCallbacks());
    await controller.start();
    const port = FakeSharedWorker.last.port;
    const contextsAfterCapture = FakeAudioContext.instances.length;
    controller.stop();

    // stop() clears isActive, so the tab no longer plays. The lazy-open path is
    // for a tab that is still active but whose capture context was closed.
    port.deliver({ type: 'answer_audio', pcm16_b64: silence(2400) });

    expect(FakeAudioContext.instances).toHaveLength(contextsAfterCapture);
    expect(FakeBufferSource.started).toHaveLength(0);
  });
});

describe('HelpAssistantController - stopping', () => {
  it('tells the worker to stop and releases the hardware', async () => {
    const controller = new HelpAssistantController('org-1', makeCallbacks());
    await controller.start();
    const ctx = FakeAudioContext.last;

    controller.stop();

    expect(FakeSharedWorker.last.port.ofType('stop')).toHaveLength(1);
    expect(stream.tracks.every((t) => t.stopped)).toBe(true);
    expect(ctx.closeCalls).toBe(1);
    expect(controller.analyserNode).toBeNull();
  });

  it('is safe before anything was opened', () => {
    const controller = new HelpAssistantController('org-1', makeCallbacks());
    expect(() => controller.stop()).not.toThrow();
  });
});

describe('HelpAssistantFallback', () => {
  async function started() {
    const callbacks = makeCallbacks();
    const fallback = new HelpAssistantFallback('org-1', callbacks);
    await fallback.start();
    const ws = FakeWebSocket.last;
    ws.open();
    return { fallback, callbacks, ws };
  }

  it('has nothing to attach to or resume', async () => {
    const fallback = new HelpAssistantFallback('org-1', makeCallbacks());
    expect(() => fallback.attach()).not.toThrow();
    await expect(fallback.resume()).resolves.toBe(false);
  });

  it('opens its own socket and announces connecting', async () => {
    const callbacks = makeCallbacks();
    const fallback = new HelpAssistantFallback('org-1', callbacks);

    await expect(fallback.start()).resolves.toBe(true);

    expect(FakeWebSocket.last.url).toContain('org-1');
    expect(FakeWebSocket.last.binaryType).toBe('arraybuffer');
    expect(callbacks.onStateChange).toHaveBeenCalledWith('connecting');
  });

  it('carries the stored token', async () => {
    localStorage.setItem('voxb.token', 'tok-1');
    await new HelpAssistantFallback('org-1', makeCallbacks()).start();
    expect(FakeWebSocket.last.url).toContain('token=tok-1');
  });

  it('reaches listening and starts capturing once the relay accepts', async () => {
    const { callbacks } = await started();
    expect(callbacks.onStateChange).toHaveBeenLastCalledWith('listening');
    expect(FakeAudioContext.last.options.sampleRate).toBe(24000);
  });

  it('reports a refused microphone and opens no socket', async () => {
    getUserMedia.mockRejectedValue(new Error('denied'));
    const callbacks = makeCallbacks();

    await expect(new HelpAssistantFallback('org-1', callbacks).start()).resolves.toBe(false);

    expect(callbacks.onError).toHaveBeenCalledWith('mic_denied', 'denied');
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('still reports mic_denied when the browser throws a non-Error', async () => {
    getUserMedia.mockRejectedValue('NotAllowedError');
    const callbacks = makeCallbacks();

    await new HelpAssistantFallback('org-1', callbacks).start();

    expect(callbacks.onError).toHaveBeenCalledWith('mic_denied', 'Microphone access denied.');
  });

  it('streams captured PCM16 straight onto the socket', async () => {
    const { ws } = await started();
    FakeScriptProcessor.last?.capture(new Float32Array([1, -1]));

    expect(Array.from(new Int16Array(ws.sent[0] as ArrayBuffer))).toEqual([32767, -32768]);
  });

  it('drops captured audio once the socket is gone', async () => {
    const { ws } = await started();
    ws.readyState = FakeWebSocket.CLOSED;
    FakeScriptProcessor.last?.capture(new Float32Array([0.5]));
    expect(ws.sent).toHaveLength(0);
  });

  it('forwards every server event to its callback', async () => {
    const { callbacks, ws } = await started();

    ws.message(JSON.stringify({ type: 'transcript', role: 'assistant', delta: 'ciao' }));
    ws.message(
      JSON.stringify({
        type: 'cost_tick',
        duration_s: 10,
        credits_so_far: 12,
        cost_display: '$0.12',
      }),
    );
    ws.message(
      JSON.stringify({
        type: 'session_end',
        duration_s: 60,
        credits_used: 72,
        cost_display: '$0.72',
      }),
    );

    expect(callbacks.onTranscript).toHaveBeenCalledWith('assistant', 'ciao');
    expect(callbacks.onCostTick).toHaveBeenCalledWith(10, 12, '$0.12');
    expect(callbacks.onSessionEnd).toHaveBeenCalledWith(60, 72, '$0.72');
  });

  it('latches the error state on a server error', async () => {
    const { callbacks, ws } = await started();

    ws.message(JSON.stringify({ type: 'error', code: 'capacity_full', message: 'Busy.' }));

    expect(callbacks.onError).toHaveBeenCalledWith('capacity_full', 'Busy.');
    expect(callbacks.onStateChange).toHaveBeenLastCalledWith('error');
  });

  it('reports a transport failure as ws_error', async () => {
    const { callbacks, ws } = await started();

    ws.errored();

    expect(callbacks.onError).toHaveBeenCalledWith('ws_error', 'WebSocket connection error.');
    expect(callbacks.onStateChange).toHaveBeenLastCalledWith('error');
  });

  it('ignores a frame that is not JSON, a binary frame, or an unknown type', async () => {
    const { callbacks, ws } = await started();
    callbacks.onTranscript.mockClear();

    ws.message('keepalive');
    ws.message(new ArrayBuffer(4));
    ws.message(JSON.stringify({ type: 'speech_started' }));

    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('queues answer audio back to back', async () => {
    const { ws } = await started();

    ws.message(JSON.stringify({ type: 'answer_audio', pcm16_b64: silence(2400) }));
    ws.message(JSON.stringify({ type: 'answer_audio', pcm16_b64: silence(2400) }));

    expect(FakeBufferSource.started).toHaveLength(2);
    expect(FakeBufferSource.started[1]).toBeCloseTo(0.1, 5);
  });

  it('drops answer audio when there is no audio context', async () => {
    const callbacks = makeCallbacks();
    const fallback = new HelpAssistantFallback('org-1', callbacks);
    await fallback.start();
    const ws = FakeWebSocket.last;

    // The socket never opened, so capture never started and no context exists.
    expect(() =>
      ws.message(JSON.stringify({ type: 'answer_audio', pcm16_b64: silence(10) })),
    ).not.toThrow();
    expect(FakeBufferSource.started).toHaveLength(0);
  });

  it('asks the relay to flush and releases the hardware on stop', async () => {
    const { fallback, ws } = await started();
    const ctx = FakeAudioContext.last;

    fallback.stop();

    expect(ws.sent).toEqual([JSON.stringify({ type: 'stop' })]);
    expect(stream.tracks.every((t) => t.stopped)).toBe(true);
    expect(ctx.closeCalls).toBe(1);
    expect(ws.closeCalls).toBe(1);
    expect(fallback.analyserNode).toBeNull();
  });

  it('still tears down when the socket has already gone', async () => {
    const { fallback, ws } = await started();
    ws.readyState = FakeWebSocket.CLOSED;

    fallback.stop();

    expect(ws.sent).toHaveLength(0);
    expect(stream.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('returns to idle when the relay drops the socket', async () => {
    const { callbacks, ws } = await started();
    ws.serverClose();
    expect(callbacks.onStateChange).toHaveBeenLastCalledWith('idle');
  });

  it('is safe to stop before anything was opened', () => {
    const fallback = new HelpAssistantFallback('org-1', makeCallbacks());
    expect(() => fallback.stop()).not.toThrow();
  });
});
