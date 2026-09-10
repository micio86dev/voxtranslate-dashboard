/**
 * Dialer logic for translated phone calls (spec 0111, R30).
 *
 * Everything here is pure and framework-free, so the parts that decide what a user is
 * told — the call phase, the price, the refusal reason, the screen-reader announcement —
 * are unit-tested rather than eyeballed in a browser.
 *
 * The accessibility rule this module exists to enforce: **a call's state must be
 * announced, not merely coloured**. A dialer where "connected" is a green dot is unusable
 * without sight, and a phone call is exactly the feature where that matters most.
 */

/** What the UI shows. Derived from the server's status, never invented client-side. */
export type CallPhase =
  | 'idle'
  | 'preparing'
  | 'dialing'
  | 'ringing'
  | 'connected'
  | 'reconnecting'
  | 'ending'
  | 'completed'
  | 'failed';

/**
 * Map a persisted server status onto a display phase.
 *
 * An unrecognised status becomes `failed`, not `connected`: a UI that cannot read the
 * state must not draw a live call, because a live call is one the user believes they are
 * being charged for and can speak into.
 */
export function phaseFromStatus(status: string | null | undefined): CallPhase {
  switch (status) {
    case 'created':
      return 'preparing';
    case 'dialing':
      return 'dialing';
    case 'ringing':
      return 'ringing';
    case 'answered':
    case 'bridged':
      return 'connected';
    case 'ending':
      return 'ending';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'failed';
  }
}

export function isTerminal(phase: CallPhase): boolean {
  return phase === 'completed' || phase === 'failed';
}

/** Whether the hang-up control should be offered. */
export function canHangUp(phase: CallPhase): boolean {
  return (
    phase === 'dialing' || phase === 'ringing' || phase === 'connected' || phase === 'reconnecting'
  );
}

/** Whether the microphone is live, i.e. whether the far end can hear the user. */
export function isMicLive(phase: CallPhase): boolean {
  return phase === 'connected' || phase === 'reconnecting';
}

/**
 * Strip the punctuation people type, keeping a single leading `+`.
 *
 * A convenience only — the SERVER validates. Duplicating the full E.164 rules here would
 * guarantee the two drift apart, and the one that matters is the one that spends money.
 */
export function normaliseDestination(raw: string): string {
  const trimmed = (raw ?? '').trim();
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^0-9]/g, '');
  return digits ? `${plus ? '+' : ''}${digits}` : '';
}

/**
 * A cheap "is this worth asking the server about" check, so the dialer does not fire a
 * quote on every keystroke of a half-typed number.
 */
export function looksDialable(raw: string): boolean {
  const digits = normaliseDestination(raw).replace(/^\+/, '');
  return digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0');
}

/** Credits (integers, 1 = $0.01) as a currency amount. */
export function formatCredits(credits: number): string {
  if (!Number.isFinite(credits)) return '0.00';
  return (Math.trunc(credits) / 100).toFixed(2);
}

/**
 * Cost of `minutes` at `pricePerMinute`, for display.
 *
 * Rounded UP to the cent, matching how the server settles: showing a number lower than
 * what will be charged is the one direction a price estimate must never be wrong in.
 */
export function estimateCost(pricePerMinute: string | number, minutes: number): string {
  const rate = typeof pricePerMinute === 'number' ? pricePerMinute : Number(pricePerMinute);
  if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(minutes) || minutes <= 0) {
    return '0.00';
  }
  // Work in cents and ceil, so the displayed figure is never under the settled one.
  return (Math.ceil(rate * minutes * 100) / 100).toFixed(2);
}

/** `95` → `1:35`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/**
 * Translation key for a server refusal code.
 *
 * The server sends stable machine-readable codes precisely so the UI can localise them.
 * An unknown code falls back to a generic message rather than printing the raw code at a
 * customer — but it is still distinguishable in `hasReasonCopy`, so a new server reason
 * shows up as missing copy rather than as silence.
 */
export function refusalKey(code: string | null | undefined): string {
  return hasReasonCopy(code) ? `phone.reason.${code}` : 'phone.reason.generic';
}

const KNOWN_REASONS = new Set([
  'busy',
  'rejected',
  'no_answer',
  'unallocated_number',
  'destination_not_allowed',
  'destination_too_expensive',
  'rate_unavailable',
  'insufficient_credits',
  'credits_exhausted',
  'eu_processing_unavailable',
  'concurrency_limit',
  'max_duration_reached',
  'media_lost',
  'provider_unavailable',
  'consent_declined',
  'unmapped',
  'number_empty',
  'number_non_numeric',
  'number_too_short',
  'number_too_long',
  'number_leading_zero',
  'number_unknown_country',
  'voip_misconfigured',
  'storage_error',
]);

export function hasReasonCopy(code: string | null | undefined): boolean {
  return !!code && KNOWN_REASONS.has(code);
}

/**
 * What an assistive technology should say when the phase changes.
 *
 * Returns `null` when nothing changed, so an `aria-live` region is not re-announced on
 * every poll — a screen reader repeating "ringing" four times a second is worse than
 * saying nothing.
 */
export function announcement(
  previous: CallPhase | null,
  next: CallPhase,
  t: (key: string) => string,
): string | null {
  if (previous === next) return null;
  return t(`phase.${next}`);
}

/** Phases in the order they normally occur, for a progress indicator. */
export const PHASE_ORDER: CallPhase[] = [
  'preparing',
  'dialing',
  'ringing',
  'connected',
  'ending',
  'completed',
];

/**
 * How far through the call we are, 0..1, for a progress indicator that is **also**
 * labelled — never colour alone.
 */
export function phaseProgress(phase: CallPhase): number {
  if (phase === 'failed') return 1;
  if (phase === 'reconnecting') return phaseProgress('connected');
  const i = PHASE_ORDER.indexOf(phase);
  if (i < 0) return 0;
  return (i + 1) / PHASE_ORDER.length;
}

/**
 * Whether the recipient will hear a disclosure announcement, and what it will say — the
 * dialer shows this **before** the call so the user is not surprised by three seconds of
 * speech at the far end.
 */
export function disclosureSummaryKey(quote: {
  recording: boolean;
  transcription: boolean;
  consent_policy: string;
}): string {
  if (quote.recording && quote.transcription) return 'phone.disclosure.both';
  if (quote.recording) return 'phone.disclosure.recording';
  if (quote.transcription) return 'phone.disclosure.transcription';
  return 'phone.disclosure.translationOnly';
}

/** Whether the recipient will be asked to press a key before capture starts. */
export function willAskConsent(quote: {
  recording: boolean;
  transcription: boolean;
  consent_policy: string;
}): boolean {
  if (!quote.recording && !quote.transcription) return false;
  return quote.consent_policy === 'press_key' || quote.consent_policy === 'verbal';
}

/**
 * The URL the caller opens to actually be *in* the call.
 *
 * A translated phone call is a room with a telephone in it. The dashboard places the call
 * and shows what it costs; it does not carry audio — microphone capture, the translated
 * playback and the subtitle stream all live in the app, which has done this for every
 * other kind of call since the beginning. Duplicating that stack here to save one tab
 * would mean two implementations of the hardest part of the product.
 *
 * Without this link the call is a telephone talking to an empty room: the engine
 * translates a speaker into the room's *other* languages, and a room containing only the
 * phone has none — so nothing is translated in either direction and both parties hear
 * silence.
 *
 * Returns `null` when there is no room to join (a call that has already ended, or a server
 * that did not return one), so a caller is never handed a link into an empty room.
 */
export function joinUrl(appBase: string, room: string | null | undefined): string | null {
  const code = (room ?? '').trim().toLowerCase();
  // The app's own `parseRoomParam` charset. Validating here too means a malformed value
  // produces no link rather than a link that silently fails to join.
  if (!/^[a-z0-9_-]{1,64}$/.test(code)) return null;
  const base = appBase.trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/?room=${encodeURIComponent(code)}`;
}

/**
 * Whether the "join the call" action should be offered.
 *
 * Only while the call is live. Offering it after the call is over sends someone into a
 * room nobody is in, and offering it before the recipient has answered would have the
 * caller sitting in an empty room listening to nothing.
 */
export function canJoin(phase: CallPhase, room: string | null | undefined): boolean {
  if (isTerminal(phase)) return false;
  return joinUrl('https://x', room) !== null;
}
