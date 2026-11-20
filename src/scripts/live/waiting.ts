/** Desk console: who is waiting, and what is new since the last poll. */
import type { WaitingGuest } from '../../lib/api';
import { formatDuration } from '../phone-dialer';

export interface WaitingDiff {
  /** Customers not seen on an earlier poll. */
  fresh: WaitingGuest[];
  /** Every session id waiting now: pass it back as `seen` on the next poll. */
  ids: Set<string>;
}

/**
 * `baseline` marks the very first load: whoever is already waiting when the page opens is not
 * "someone who just started waiting", so it raises no cue.
 */
export function diffWaiting(
  seen: Set<string>,
  current: WaitingGuest[],
  baseline = false,
): WaitingDiff {
  const ids = new Set(current.map((g) => g.session_id));
  const fresh = baseline ? [] : current.filter((g) => !seen.has(g.session_id));
  return { fresh, ids };
}

/** `75` → `1:15`; a negative or missing wait is a dash. */
export function formatWaited(seconds: number): string {
  return formatDuration(seconds);
}
