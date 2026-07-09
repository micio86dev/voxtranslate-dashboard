/**
 * B2B Voice Assistant client module.
 *
 * Exports pure functions (state machine, URL builder, PCM16 converter, cost
 * formatter) and the `VoiceAssistant` class that manages the full lifecycle:
 * mic capture → WebSocket relay → streaming transcript → cost metering.
 *
 * The class is instantiated by insights.astro and is never a SharedWorker.
 * Each insights page gets exactly one instance per session.
 *
 * Data flow (ASCII):
 *
 *   Browser mic
 *     └─ AudioWorklet/ScriptProcessor ──► pcm16FromFloat32 ──► WS binary
 *                                                                   │
 *   OpenAI Realtime ◄──────────────────────────────────────────────┘
 *        │
 *        ├─ answer_audio (pcm16_b64) ──► AudioContext.decodeAudioData ──► speaker
 *        ├─ transcript {role, delta}  ──► transcript DOM area
 *        ├─ cost_tick                 ──► cost meter DOM
 *        └─ session_end               ──► cleanup + summary
 */

import { API_BASE } from '../lib/auth';
import { buildWsUrl } from '../lib/api';
export { buildWsUrl } from '../lib/api';

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export const enum VoiceAssistantState {
  Idle = 'idle',
  Connecting = 'connecting',
  Listening = 'listening',
  Speaking = 'speaking',
  Error = 'error',
}

type VoiceAssistantAction =
  | 'connect'
  | 'session_ready'
  | 'speech_started'
  | 'speech_stopped'
  | 'disconnect'
  | 'error'
  | 'reset'
  | string;

/**
 * Pure state transition function. Unknown actions on any state return the
 * current state unchanged (defensive).
 */
export function stateMachineTransition(
  state: VoiceAssistantState,
  action: VoiceAssistantAction,
): VoiceAssistantState {
  if (action === 'error') return VoiceAssistantState.Error;
  if (action === 'reset') return VoiceAssistantState.Idle;

  switch (state) {
    case VoiceAssistantState.Idle:
      if (action === 'connect') return VoiceAssistantState.Connecting;
      return VoiceAssistantState.Idle;

    case VoiceAssistantState.Connecting:
      if (action === 'session_ready') return VoiceAssistantState.Listening;
      return VoiceAssistantState.Connecting;

    case VoiceAssistantState.Listening:
      if (action === 'speech_started') return VoiceAssistantState.Speaking;
      if (action === 'disconnect') return VoiceAssistantState.Idle;
      return VoiceAssistantState.Listening;

    case VoiceAssistantState.Speaking:
      if (action === 'speech_stopped') return VoiceAssistantState.Listening;
      if (action === 'disconnect') return VoiceAssistantState.Idle;
      return VoiceAssistantState.Speaking;

    case VoiceAssistantState.Error:
      return VoiceAssistantState.Error;

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// WS URL builder — implementation lives in ../lib/api (buildWsUrl).
// Re-exported above so existing imports from this module continue to work.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PCM16 conversion
// ---------------------------------------------------------------------------

/**
 * Convert a Float32Array of audio samples (range −1..1) to a little-endian
 * PCM16 ArrayBuffer suitable for transmission to the OpenAI Realtime API.
 *
 * Values outside [−1, 1] are clipped.
 */
export function pcm16FromFloat32(float32: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    // Map to int16: +1.0 → 32767, -1.0 → -32768
    const sample = clamped < 0 ? clamped * 32768 : clamped * 32767;
    view.setInt16(i * 2, Math.round(sample), /* littleEndian */ true);
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Cost display formatter
// ---------------------------------------------------------------------------

/**
 * Format an integer credit amount as a euro display string.
 * Assumes 100 credits = €1 (matches the server's `format_cost_display`).
 */
export function formatCostDisplay(credits: number): string {
  return `€${(credits / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Typed inbound WS events (server → browser)
// ---------------------------------------------------------------------------

export type VoiceAssistantInboundEvent =
  | { type: 'answer_audio'; pcm16_b64: string }
  | { type: 'transcript'; role: 'user' | 'assistant'; delta: string }
  | { type: 'cost_tick'; duration_s: number; credits_so_far: number; cost_display: string }
  | { type: 'session_end'; duration_s: number; credits_used: number; cost_display: string }
  | { type: 'error'; code: string; message: string };

/** Outbound control event sent from the browser to the server relay. */
export type VoiceAssistantOutboundEvent = { type: 'stop' };

// ---------------------------------------------------------------------------
// DOM helpers (used by the class below)
// ---------------------------------------------------------------------------

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

// ---------------------------------------------------------------------------
// VoiceAssistant class
// ---------------------------------------------------------------------------

export interface VoiceAssistantCallbacks {
  /** Called whenever the state changes. */
  onStateChange: (state: VoiceAssistantState) => void;
  /** Called with each transcript delta (role + text chunk). */
  onTranscript: (role: 'user' | 'assistant', delta: string) => void;
  /** Called every 10s with the running cost. */
  onCostTick: (durationS: number, creditsSoFar: number, costDisplay: string) => void;
  /** Called when the session closes (server or user-initiated). */
  onSessionEnd: (durationS: number, creditsUsed: number, costDisplay: string) => void;
  /** Called on capacity_full / credits_exhausted / WS error. */
  onError: (code: string, message: string) => void;
}

export interface VoiceAssistantOptions {
  orgId: string;
  projectId?: string;
  memberId?: string;
}

/**
 * Manages one voice-assistant WebSocket session.
 *
 * Lifecycle:
 *   1. `start()` — opens mic, opens WS, starts streaming PCM16
 *   2. `stop()` — sends `{"type":"stop"}`, closes mic, waits for session_end
 *   3. The `session_end` event from the server triggers `onSessionEnd`
 *
 * Audio output (AI voice) is played via AudioContext.decodeAudioData on the
 * incoming pcm16_b64 chunks.
 */
export class VoiceAssistant {
  private state: VoiceAssistantState = VoiceAssistantState.Idle;
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrame: number | null = null;
  private readonly callbacks: VoiceAssistantCallbacks;
  private readonly opts: VoiceAssistantOptions;

  constructor(opts: VoiceAssistantOptions, callbacks: VoiceAssistantCallbacks) {
    this.opts = opts;
    this.callbacks = callbacks;
  }

  get currentState(): VoiceAssistantState {
    return this.state;
  }

  /** Open microphone + WebSocket and start the session. */
  async start(): Promise<void> {
    if (this.state !== VoiceAssistantState.Idle) return;
    this.transition('connect');

    try {
      // Request microphone access.
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      this.transition('error');
      this.callbacks.onError(
        'mic_denied',
        err instanceof Error ? err.message : 'Microphone access denied.',
      );
      return;
    }

    // Build WS URL and open connection.
    const url = buildWsUrl(API_BASE, this.opts.orgId, {
      project_id: this.opts.projectId,
      member_id: this.opts.memberId,
    });

    const token = localStorage.getItem('voxb.token');
    // The server uses JWT from the Authorization header but WS protocol
    // doesn't carry headers natively. We pass it as a query param.
    const wsUrl = token
      ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
      : url;

    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.addEventListener('open', () => {
      this.transition('session_ready');
      this.startAudioCapture();
    });

    this.ws.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') {
        this.handleServerEvent(ev.data);
      }
    });

    this.ws.addEventListener('close', () => {
      this.stopAudioCapture();
      if (this.state !== VoiceAssistantState.Idle && this.state !== VoiceAssistantState.Error) {
        this.transition('disconnect');
      }
    });

    this.ws.addEventListener('error', () => {
      this.stopAudioCapture();
      this.transition('error');
      this.callbacks.onError('ws_error', 'WebSocket connection error.');
    });
  }

  /** Send stop signal and close the mic. The server will flush and send session_end. */
  stop(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
    }
    this.stopAudioCapture();
    if (this.state !== VoiceAssistantState.Idle && this.state !== VoiceAssistantState.Error) {
      this.transition('disconnect');
    }
  }

  /** Return the AnalyserNode for waveform rendering by the UI layer. */
  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  // --- Private ---------------------------------------------------------------

  private transition(action: VoiceAssistantAction): void {
    const next = stateMachineTransition(this.state, action);
    if (next !== this.state) {
      this.state = next;
      this.callbacks.onStateChange(next);
    }
  }

  private startAudioCapture(): void {
    if (!this.stream) return;
    this.audioCtx = new AudioContext({ sampleRate: 16000 });
    const source = this.audioCtx.createMediaStreamSource(this.stream);

    // Waveform analyser (for the UI animation).
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);

    // ScriptProcessorNode captures raw PCM samples (deprecated but widely
    // supported; AudioWorklet requires HTTPS and a separate .js file which
    // is impractical for an inline Astro script).
    const bufSize = 4096;
    this.scriptProcessor = this.audioCtx.createScriptProcessor(bufSize, 1, 1);
    source.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioCtx.destination);

    this.scriptProcessor.addEventListener('audioprocess', (ev) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const channelData = ev.inputBuffer.getChannelData(0);
      const pcm16 = pcm16FromFloat32(channelData);
      this.ws.send(pcm16);
    });
  }

  private stopAudioCapture(): void {
    if (this.animFrame !== null) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    this.scriptProcessor?.disconnect();
    this.scriptProcessor = null;
    this.analyser?.disconnect();
    this.analyser = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }

  private handleServerEvent(raw: string): void {
    let ev: VoiceAssistantInboundEvent;
    try {
      ev = JSON.parse(raw) as VoiceAssistantInboundEvent;
    } catch {
      return;
    }

    switch (ev.type) {
      case 'answer_audio':
        this.playPcm16(ev.pcm16_b64);
        break;

      case 'transcript':
        this.callbacks.onTranscript(ev.role, ev.delta);
        break;

      case 'cost_tick':
        this.callbacks.onCostTick(ev.duration_s, ev.credits_so_far, ev.cost_display);
        break;

      case 'session_end':
        this.callbacks.onSessionEnd(ev.duration_s, ev.credits_used, ev.cost_display);
        this.ws?.close();
        this.transition('disconnect');
        break;

      case 'error':
        this.transition('error');
        this.callbacks.onError(ev.code, ev.message);
        this.ws?.close();
        break;
    }
  }

  private playPcm16(b64: string): void {
    if (!this.audioCtx) return;
    const pcm = base64ToArrayBuffer(b64);
    // The server sends raw PCM16 LE at 24kHz (OpenAI Realtime output rate).
    // We create a mono AudioBuffer at the context's native rate (16kHz) and
    // resample by just playing it — the output quality is adequate for voice.
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
    src.start();
  }
}
