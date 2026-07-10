/**
 * Help Assistant page controller.
 *
 * Responsibilities (page-side only):
 *   - Detect SharedWorker support; fall back to direct VoiceAssistant-class
 *     shape for Safari / iOS (where SharedWorker is unavailable).
 *   - Open microphone via navigator.mediaDevices.getUserMedia.
 *   - Run AudioContext + ScriptProcessorNode for PCM16 capture.
 *   - Forward PCM16 binary frames to the SharedWorker via port.postMessage.
 *   - Play answer_audio (PCM16 chunks from AI) ONLY when this is the active port.
 *   - Wire all DOM callbacks (waveform canvas, transcript, cost ticker).
 *
 * The SharedWorker owns the WS connection and all text buffers.
 * The page owns all audio hardware and DOM manipulation.
 *
 * Pure exported functions (unit-tested in help-assistant.test.ts):
 *   detectSharedWorkerSupport  — returns false on Safari / iOS / jsdom
 *   buildHaFullWsUrl           — appends ?token= to the base WS URL
 *   handleWorkerMessage        — pure dispatcher from worker events to callbacks
 */

import { helpAssistantWsUrl } from '../lib/api';
import { pcm16FromFloat32, stateMachineTransition, formatCostDisplay } from './voice-assistant';
import type { VoiceAssistantState } from './voice-assistant';

export type { VoiceAssistantState };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HaTranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
}

export type HaWorkerInboundMessage =
  | { type: 'state_change'; state: string }
  | { type: 'transcript'; role: 'user' | 'assistant'; delta: string }
  | { type: 'cost_tick'; duration_s: number; credits_so_far: number; cost_display: string }
  | { type: 'session_end'; duration_s: number; credits_used: number; cost_display: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'sync'; state: string; transcript: HaTranscriptEntry[]; cost_display: string };

/** Callbacks wired to DOM update functions by the page script. */
export interface HaCallbacks {
  onStateChange: (state: string) => void;
  onTranscript: (role: string, delta: string) => void;
  onCostTick: (durationS: number, creditsSoFar: number, costDisplay: string) => void;
  onSessionEnd: (durationS: number, creditsUsed: number, costDisplay: string) => void;
  onError: (code: string, message: string) => void;
  onSync: (state: string, transcript: HaTranscriptEntry[], costDisplay: string) => void;
}

// ---------------------------------------------------------------------------
// Pure exported functions (unit-testable, no DOM / audio / WS deps)
// ---------------------------------------------------------------------------

/**
 * Detect whether the current environment supports SharedWorker.
 * Returns false on Safari, iOS, and jsdom (Vitest).
 */
export function detectSharedWorkerSupport(): boolean {
  return typeof SharedWorker !== 'undefined';
}

/**
 * Append ?token= (or &token=) to a WebSocket URL.
 * Returns the URL unchanged when token is null.
 */
export function buildHaFullWsUrl(baseWsUrl: string, token: string | null): string {
  if (!token) return baseWsUrl;
  const separator = baseWsUrl.includes('?') ? '&' : '?';
  return `${baseWsUrl}${separator}token=${encodeURIComponent(token)}`;
}

/**
 * Pure dispatcher: maps an inbound worker message to the appropriate callback.
 * Does not touch the DOM or any mutable state — all side effects are in the
 * callbacks supplied by the caller.
 *
 * Events not listed here (e.g. answer_audio) are handled separately by the
 * page because they require AudioContext — which is not passed into this fn.
 */
export function handleWorkerMessage(msg: HaWorkerInboundMessage, cb: HaCallbacks): void {
  switch (msg.type) {
    case 'state_change':
      cb.onStateChange(msg.state);
      break;
    case 'transcript':
      cb.onTranscript(msg.role, msg.delta);
      break;
    case 'cost_tick':
      cb.onCostTick(msg.duration_s, msg.credits_so_far, msg.cost_display);
      break;
    case 'session_end':
      cb.onSessionEnd(msg.duration_s, msg.credits_used, msg.cost_display);
      break;
    case 'error':
      cb.onError(msg.code, msg.message);
      break;
    case 'sync':
      cb.onSync(msg.state, msg.transcript, msg.cost_display);
      break;
    // answer_audio is intentionally not dispatched here; handled by HelpAssistantController.
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// HelpAssistantController (SharedWorker path)
// ---------------------------------------------------------------------------

/**
 * Manages the page-side of a help assistant session via a SharedWorker.
 *
 * One instance per page (BaseLayout). On pages where the user clicks the help
 * button this controller:
 *   1. Opens a SharedWorker for the current origin
 *   2. Sends 'start' with the pre-built WS URL (including ?token=)
 *   3. Opens the mic and streams PCM16 binary frames to the worker
 *   4. Receives worker events and forwards them to DOM callbacks
 *   5. Plays answer_audio ONLY on this page (active port)
 */
export class HelpAssistantController {
  private port: MessagePort | null = null;
  private audioCtx: AudioContext | null = null;
  /** Playback cursor so answer_audio chunks queue back-to-back instead of
   *  overlapping. Reset whenever a fresh AudioContext is opened. */
  private nextPlayTime = 0;
  private stream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private isActive = false; // becomes true after we send 'start'
  private readonly orgId: string;
  private readonly callbacks: HaCallbacks;

  constructor(orgId: string, callbacks: HaCallbacks) {
    this.orgId = orgId;
    this.callbacks = callbacks;
  }

  /**
   * Connect to the SharedWorker and start the session.
   * Returns false if the worker or mic could not be opened.
   */
  async start(): Promise<boolean> {
    const token = localStorage.getItem('voxb.token');
    const baseUrl = helpAssistantWsUrl(this.orgId);
    const wsUrl = buildHaFullWsUrl(baseUrl, token);

    // Open SharedWorker
    let worker: SharedWorker;
    try {
      worker = new SharedWorker(new URL('../workers/help-assistant.worker.ts', import.meta.url), {
        type: 'module',
        name: 'ha-worker',
      });
    } catch {
      this.callbacks.onError('worker_error', 'Failed to open SharedWorker.');
      return false;
    }

    this.port = worker.port;

    this.port.addEventListener('message', (ev: MessageEvent) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = ev.data as any;

      if (raw.type === 'answer_audio' && this.isActive) {
        // Only this page plays audio (active port)
        this.playPcm16(raw.pcm16_b64 as string);
        return;
      }

      handleWorkerMessage(raw as HaWorkerInboundMessage, this.callbacks);
    });

    this.port.start();

    // Request mic
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      this.callbacks.onError(
        'mic_denied',
        err instanceof Error ? err.message : 'Microphone access denied.',
      );
      return false;
    }

    // Tell the worker to open the WS — this makes us the active port
    this.port.postMessage({ type: 'start', wsUrl });
    this.isActive = true;

    // Start audio capture
    this.startAudioCapture();
    return true;
  }

  /** Stop the session. */
  stop(): void {
    if (this.port) {
      this.port.postMessage({ type: 'stop' });
    }
    this.stopAudioCapture();
    this.isActive = false;
  }

  /** Return the AnalyserNode for waveform rendering. */
  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  // --- Private ---------------------------------------------------------------

  private startAudioCapture(): void {
    if (!this.stream || !this.port) return;
    this.audioCtx = new AudioContext({ sampleRate: 16000 });
    this.nextPlayTime = 0;
    const source = this.audioCtx.createMediaStreamSource(this.stream);

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);

    const bufSize = 4096;
    this.scriptProcessor = this.audioCtx.createScriptProcessor(bufSize, 1, 1);
    source.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioCtx.destination);

    const port = this.port;
    this.scriptProcessor.addEventListener('audioprocess', (ev) => {
      const channelData = ev.inputBuffer.getChannelData(0);
      const pcm16 = pcm16FromFloat32(channelData);
      port.postMessage({ type: 'audio', pcm: pcm16 }, [pcm16]);
    });
  }

  private stopAudioCapture(): void {
    this.scriptProcessor?.disconnect();
    this.scriptProcessor = null;
    this.analyser?.disconnect();
    this.analyser = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }

  private playPcm16(b64: string): void {
    if (!this.audioCtx) {
      // Playback AudioContext opened lazily (e.g., this tab was passive and
      // became active after the capture context was closed)
      this.audioCtx = new AudioContext();
      this.nextPlayTime = 0;
    }
    const bin = atob(b64);
    const pcm = new ArrayBuffer(bin.length);
    const view = new Uint8Array(pcm);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
    const int16 = new Int16Array(pcm);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    const audioBuf = this.audioCtx.createBuffer(1, float32.length, 24000);
    audioBuf.copyToChannel(float32, 0);
    const src = this.audioCtx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(this.audioCtx.destination);
    // Queue sequentially so chunks don't all start at `now` and overlap.
    const startAt = Math.max(this.audioCtx.currentTime, this.nextPlayTime);
    src.start(startAt);
    this.nextPlayTime = startAt + audioBuf.duration;
  }
}

// ---------------------------------------------------------------------------
// HelpAssistantFallback (Safari / iOS — no SharedWorker)
// ---------------------------------------------------------------------------

/**
 * Fallback controller for browsers without SharedWorker support.
 * Uses a direct WebSocket connection with the same VoiceAssistant-class shape.
 * Each page gets its own WS session (no cross-tab sharing).
 */
export class HelpAssistantFallback {
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  /** Playback cursor so answer_audio chunks queue back-to-back instead of
   *  overlapping. Reset whenever a fresh AudioContext is opened. */
  private nextPlayTime = 0;
  private stream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private state = 'idle';
  private readonly orgId: string;
  private readonly callbacks: HaCallbacks;

  constructor(orgId: string, callbacks: HaCallbacks) {
    this.orgId = orgId;
    this.callbacks = callbacks;
  }

  async start(): Promise<boolean> {
    const token = localStorage.getItem('voxb.token');
    const baseUrl = helpAssistantWsUrl(this.orgId);
    const wsUrl = buildHaFullWsUrl(baseUrl, token);

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      this.callbacks.onError(
        'mic_denied',
        err instanceof Error ? err.message : 'Microphone access denied.',
      );
      return false;
    }

    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.addEventListener('open', () => {
      this.setAndEmitState(
        stateMachineTransition(this.state as VoiceAssistantState, 'session_ready'),
      );
      this.startAudioCapture();
    });

    this.ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        return;
      }
      this.handleServerMessage(msg);
    });

    this.ws.addEventListener('close', () => {
      this.stopAudioCapture();
      this.setAndEmitState(stateMachineTransition(this.state as VoiceAssistantState, 'disconnect'));
    });

    this.ws.addEventListener('error', () => {
      this.callbacks.onError('ws_error', 'WebSocket connection error.');
      this.setAndEmitState(stateMachineTransition(this.state as VoiceAssistantState, 'error'));
    });

    this.setAndEmitState(stateMachineTransition(this.state as VoiceAssistantState, 'connect'));
    return true;
  }

  stop(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
    }
    this.stopAudioCapture();
  }

  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  private setAndEmitState(next: string): void {
    if (next !== this.state) {
      this.state = next;
      this.callbacks.onStateChange(next);
    }
  }

  private startAudioCapture(): void {
    if (!this.stream || !this.ws) return;
    this.audioCtx = new AudioContext({ sampleRate: 16000 });
    this.nextPlayTime = 0;
    const source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);
    const bufSize = 4096;
    this.scriptProcessor = this.audioCtx.createScriptProcessor(bufSize, 1, 1);
    source.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioCtx.destination);
    const ws = this.ws;
    this.scriptProcessor.addEventListener('audioprocess', (ev) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const channelData = ev.inputBuffer.getChannelData(0);
      const pcm16 = pcm16FromFloat32(channelData);
      ws.send(pcm16);
    });
  }

  private stopAudioCapture(): void {
    this.scriptProcessor?.disconnect();
    this.scriptProcessor = null;
    this.analyser?.disconnect();
    this.analyser = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.ws?.close();
    this.ws = null;
  }

  private handleServerMessage(msg: Record<string, unknown>): void {
    const type = msg['type'] as string;
    switch (type) {
      case 'answer_audio':
        this.playPcm16(msg['pcm16_b64'] as string);
        break;
      case 'transcript':
        this.callbacks.onTranscript(msg['role'] as string, msg['delta'] as string);
        break;
      case 'cost_tick':
        this.callbacks.onCostTick(
          msg['duration_s'] as number,
          msg['credits_so_far'] as number,
          msg['cost_display'] as string,
        );
        break;
      case 'session_end':
        this.callbacks.onSessionEnd(
          msg['duration_s'] as number,
          msg['credits_used'] as number,
          msg['cost_display'] as string,
        );
        break;
      case 'error':
        this.callbacks.onError(msg['code'] as string, msg['message'] as string);
        this.setAndEmitState(stateMachineTransition(this.state as VoiceAssistantState, 'error'));
        break;
      default:
        break;
    }
  }

  private playPcm16(b64: string): void {
    if (!this.audioCtx) return;
    const bin = atob(b64);
    const pcm = new ArrayBuffer(bin.length);
    const view = new Uint8Array(pcm);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
    const int16 = new Int16Array(pcm);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    const audioBuf = this.audioCtx.createBuffer(1, float32.length, 24000);
    audioBuf.copyToChannel(float32, 0);
    const src = this.audioCtx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(this.audioCtx.destination);
    // Queue sequentially so chunks don't all start at `now` and overlap.
    const startAt = Math.max(this.audioCtx.currentTime, this.nextPlayTime);
    src.start(startAt);
    this.nextPlayTime = startAt + audioBuf.duration;
  }
}

// ---------------------------------------------------------------------------
// Factory: create the right controller for the current browser
// ---------------------------------------------------------------------------

/**
 * Create either a SharedWorker-backed controller or the direct-WS fallback,
 * depending on browser support. The caller uses the same interface either way.
 */
export function createHelpAssistant(
  orgId: string,
  callbacks: HaCallbacks,
): HelpAssistantController | HelpAssistantFallback {
  if (detectSharedWorkerSupport()) {
    return new HelpAssistantController(orgId, callbacks);
  }
  return new HelpAssistantFallback(orgId, callbacks);
}

// Re-export for consumers that only need the cost formatter
export { formatCostDisplay };
