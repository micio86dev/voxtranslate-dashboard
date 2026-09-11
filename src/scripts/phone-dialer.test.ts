import { describe, expect, it } from 'vitest';
import {
  announcement,
  canHangUp,
  canJoin,
  disclosureSummaryKey,
  estimateCost,
  formatCredits,
  formatDuration,
  hasReasonCopy,
  isMicLive,
  isTerminal,
  joinUrl,
  looksDialable,
  normaliseDestination,
  numberProblem,
  phaseFromStatus,
  phaseProgress,
  refusalKey,
  willAskConsent,
  type CallPhase,
} from './phone-dialer';

describe('phaseFromStatus', () => {
  it('maps every status the server can persist', () => {
    expect(phaseFromStatus('created')).toBe('preparing');
    expect(phaseFromStatus('dialing')).toBe('dialing');
    expect(phaseFromStatus('ringing')).toBe('ringing');
    expect(phaseFromStatus('answered')).toBe('connected');
    expect(phaseFromStatus('bridged')).toBe('connected');
    expect(phaseFromStatus('ending')).toBe('ending');
    expect(phaseFromStatus('completed')).toBe('completed');
    expect(phaseFromStatus('failed')).toBe('failed');
  });

  it('never draws a live call for a status it cannot read', () => {
    // A live call is one the user believes they can speak into and are being charged
    // for. Guessing "connected" from an unknown status is the worst possible guess.
    for (const junk of ['in_progress', '', null, undefined, 'CONNECTED']) {
      expect(phaseFromStatus(junk)).toBe('failed');
    }
  });
});

describe('call controls follow the phase', () => {
  it('offers hang-up exactly while there is something to hang up', () => {
    const live: CallPhase[] = ['dialing', 'ringing', 'connected', 'reconnecting'];
    const dead: CallPhase[] = ['idle', 'preparing', 'ending', 'completed', 'failed'];
    for (const p of live) expect(canHangUp(p)).toBe(true);
    for (const p of dead) expect(canHangUp(p)).toBe(false);
  });

  it('says the microphone is live only when the far end can actually hear it', () => {
    // The mute indicator hangs off this. Showing "live" while ringing would tell someone
    // their private remarks are being transmitted when they are not — and, worse, the
    // reverse mistake would tell them they are safe when they are not.
    expect(isMicLive('connected')).toBe(true);
    expect(isMicLive('reconnecting')).toBe(true);
    for (const p of [
      'idle',
      'preparing',
      'dialing',
      'ringing',
      'ending',
      'completed',
      'failed',
    ] as CallPhase[]) {
      expect(isMicLive(p)).toBe(false);
    }
  });

  it('knows which phases are over', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('connected')).toBe(false);
  });
});

describe('normaliseDestination', () => {
  it('accepts the punctuation people type', () => {
    for (const raw of ['+39 320 1234567', '+39-320-1234567', '+39 (320) 123.4567']) {
      expect(normaliseDestination(raw)).toBe('+393201234567');
    }
  });

  it('keeps at most the leading plus', () => {
    expect(normaliseDestination('00393201234567')).toBe('00393201234567');
    expect(normaliseDestination('393201234567')).toBe('393201234567');
    expect(normaliseDestination('  ')).toBe('');
    expect(normaliseDestination('')).toBe('');
  });

  it('drops letters instead of encoding them', () => {
    // Vanity numbers are not dialable internationally, and silently mapping letters to
    // digits would dial something the user did not type.
    expect(normaliseDestination('+39320CALL')).toBe('+39320');
  });
});

describe('looksDialable', () => {
  it('is a keystroke filter, not a validator', () => {
    expect(looksDialable('+393201234567')).toBe(true);
    expect(looksDialable('+8613800138000')).toBe(true);
    // Too short to be worth asking the server about.
    expect(looksDialable('+3932')).toBe(false);
    expect(looksDialable('')).toBe(false);
    // Too long for E.164.
    expect(looksDialable('+3932012345678901')).toBe(false);
    // A leading zero is never a country code.
    expect(looksDialable('0393201234567')).toBe(false);
  });
});

describe('money formatting', () => {
  it('renders credits as the currency amount they are', () => {
    expect(formatCredits(250)).toBe('2.50');
    expect(formatCredits(1)).toBe('0.01');
    expect(formatCredits(0)).toBe('0.00');
    expect(formatCredits(Number.NaN)).toBe('0.00');
  });

  it('rounds an estimate UP, never down', () => {
    // The one direction a price estimate must not be wrong in: a figure lower than what
    // is actually charged is a complaint, not a rounding difference.
    expect(estimateCost('0.0468', 10)).toBe('0.47');
    expect(estimateCost('0.05', 10)).toBe('0.50');
    expect(estimateCost(0.0333, 3)).toBe('0.10');
    expect(estimateCost('0', 10)).toBe('0.00');
  });

  it('refuses to invent a number from nonsense', () => {
    expect(estimateCost('abc', 10)).toBe('0.00');
    expect(estimateCost('0.05', 0)).toBe('0.00');
    expect(estimateCost('0.05', -3)).toBe('0.00');
    expect(estimateCost('-1', 10)).toBe('0.00');
  });
});

describe('formatDuration', () => {
  it('reads as a call timer', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(95)).toBe('1:35');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('shows a dash rather than a zero for a call that never connected', () => {
    // "0:00" reads as a call that happened and lasted no time. That is a different fact
    // from "there is no duration", and the difference shows up next to a charge.
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
  });
});

describe('refusal copy', () => {
  it('localises every reason the server can send', () => {
    expect(refusalKey('insufficient_credits')).toBe('phone.reason.insufficient_credits');
    expect(refusalKey('eu_processing_unavailable')).toBe('phone.reason.eu_processing_unavailable');
    expect(refusalKey('number_too_short')).toBe('phone.reason.number_too_short');
  });

  it('never prints a raw server code at a customer', () => {
    expect(refusalKey('something_new_from_the_server')).toBe('phone.reason.generic');
    expect(refusalKey(null)).toBe('phone.reason.generic');
    expect(refusalKey('')).toBe('phone.reason.generic');
  });

  it('still distinguishes an unknown reason, so missing copy is findable', () => {
    expect(hasReasonCopy('busy')).toBe(true);
    expect(hasReasonCopy('something_new_from_the_server')).toBe(false);
  });
});

describe('announcement (R30)', () => {
  const t = (k: string) => k;

  it('announces a change once and only once', () => {
    // A screen reader repeating "ringing" on every poll is worse than saying nothing.
    expect(announcement(null, 'dialing', t)).toBe('phase.dialing');
    expect(announcement('dialing', 'dialing', t)).toBeNull();
    expect(announcement('dialing', 'ringing', t)).toBe('phase.ringing');
  });

  it('announces every phase a user can land in', () => {
    const phases: CallPhase[] = [
      'preparing',
      'dialing',
      'ringing',
      'connected',
      'reconnecting',
      'ending',
      'completed',
      'failed',
    ];
    for (const p of phases) {
      expect(announcement('idle', p, t)).toBe(`phase.${p}`);
    }
  });
});

describe('phaseProgress', () => {
  it('advances monotonically through a normal call', () => {
    const order: CallPhase[] = [
      'preparing',
      'dialing',
      'ringing',
      'connected',
      'ending',
      'completed',
    ];
    let last = -1;
    for (const p of order) {
      const now = phaseProgress(p);
      expect(now).toBeGreaterThan(last);
      last = now;
    }
    expect(last).toBe(1);
  });

  it('does not rewind while reconnecting', () => {
    // The call is still up. A progress bar jumping backwards reads as "we lost it".
    expect(phaseProgress('reconnecting')).toBe(phaseProgress('connected'));
  });

  it('is complete for a failed call too', () => {
    expect(phaseProgress('failed')).toBe(1);
    expect(phaseProgress('idle')).toBe(0);
  });
});

describe('disclosure preview', () => {
  it('tells the user what the recipient will hear, before the call', () => {
    expect(
      disclosureSummaryKey({ recording: true, transcription: true, consent_policy: 'press_key' }),
    ).toBe('phone.disclosure.both');
    expect(
      disclosureSummaryKey({ recording: true, transcription: false, consent_policy: 'press_key' }),
    ).toBe('phone.disclosure.recording');
    expect(
      disclosureSummaryKey({ recording: false, transcription: true, consent_policy: 'press_key' }),
    ).toBe('phone.disclosure.transcription');
    expect(
      disclosureSummaryKey({ recording: false, transcription: false, consent_policy: 'press_key' }),
    ).toBe('phone.disclosure.translationOnly');
  });

  it('warns that the recipient will be asked, but only when they will be', () => {
    // Asking someone to press 1 to allow a recording that is not happening is theatre,
    // and the dialer must not promise it either.
    expect(
      willAskConsent({ recording: true, transcription: false, consent_policy: 'press_key' }),
    ).toBe(true);
    expect(
      willAskConsent({ recording: true, transcription: false, consent_policy: 'verbal' }),
    ).toBe(true);
    expect(
      willAskConsent({ recording: true, transcription: false, consent_policy: 'notice_only' }),
    ).toBe(false);
    expect(
      willAskConsent({ recording: false, transcription: false, consent_policy: 'press_key' }),
    ).toBe(false);
  });
});

describe('joining the room the call happens in', () => {
  it('builds the app deep link the client already understands', () => {
    expect(joinUrl('https://app.voxtranslate.app', 'ph-abc123')).toBe(
      'https://app.voxtranslate.app/?room=ph-abc123',
    );
  });

  it('tolerates a trailing slash on the configured base', () => {
    expect(joinUrl('https://app.voxtranslate.app///', 'ph-abc123')).toBe(
      'https://app.voxtranslate.app/?room=ph-abc123',
    );
  });

  it('returns nothing rather than a link into an empty room', () => {
    // A call that has ended carries no room. A link built anyway would drop the caller
    // into a room nobody is in, which reads as a broken call rather than a finished one.
    expect(joinUrl('https://app.voxtranslate.app', null)).toBeNull();
    expect(joinUrl('https://app.voxtranslate.app', '')).toBeNull();
  });

  it('refuses a room name the app would reject', () => {
    // Mirrors the client's own `parseRoomParam` charset. Validating here as well means a
    // malformed value produces no link instead of one that silently fails to join.
    expect(joinUrl('https://app.voxtranslate.app', 'ph abc')).toBeNull();
    expect(joinUrl('https://app.voxtranslate.app', '../../etc')).toBeNull();
    expect(joinUrl('https://app.voxtranslate.app', 'a'.repeat(65))).toBeNull();
  });

  it('offers the action only while the call is live', () => {
    expect(canJoin('connected', 'ph-abc')).toBe(true);
    expect(canJoin('ringing', 'ph-abc')).toBe(true);
    expect(canJoin('completed', 'ph-abc')).toBe(false);
    expect(canJoin('failed', 'ph-abc')).toBe(false);
    expect(canJoin('connected', null)).toBe(false);
  });
});

describe('numberProblem', () => {
  it('names the same problem the server would name', () => {
    // The server already ships copy for each of these codes (`phone.reason.number_*`),
    // so saying which rule the number broke costs no new translation and tells the user
    // what to change. "Invalid number" tells them nothing.
    expect(numberProblem('')).toBe('number_empty');
    expect(numberProblem('   ')).toBe('number_empty');
    expect(numberProblem('nope')).toBe('number_non_numeric');
    expect(numberProblem('0320 123 4567')).toBe('number_leading_zero');
    expect(numberProblem('+39 320')).toBe('number_too_short');
    expect(numberProblem('+3912345678901234567')).toBe('number_too_long');
  });

  it('passes a dialable number', () => {
    expect(numberProblem('+39 320 123 4567')).toBeNull();
    expect(numberProblem('+8613800138000')).toBeNull();
  });

  it('agrees with looksDialable, which is the same rule asked as a question', () => {
    for (const raw of ['', 'nope', '0320123456', '+39320', '+39 320 123 4567', '+8613800138000']) {
      expect(looksDialable(raw)).toBe(numberProblem(raw) === null);
    }
  });
});
