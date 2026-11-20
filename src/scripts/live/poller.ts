/**
 * A polling loop for the Live Connect pages (sessions, usage, desk console).
 *
 * Three rules that a bare `setInterval` gets wrong:
 *  - it never runs while the tab is hidden (a background tab hammering the API helps no one),
 *    and it refreshes the moment the tab is shown again;
 *  - after an error it backs off exponentially, with jitter so a fleet of tabs does not retry
 *    in lockstep, and snaps back to the base interval on the first success;
 *  - it never overlaps two runs, and stops for good on a 401 (the page re-authenticates).
 *
 * The clock, the visibility source and the randomness are injectable so the rules are testable.
 */

/** What one run of the task reports. `stop` ends the loop quietly (nothing left to watch). */
export type PollOutcome = 'ok' | 'error' | 'unauthorized' | 'stop';

const MIN_DELAY_MS = 100;

export interface NextDelayInput {
  baseMs: number;
  /** Consecutive failed runs so far. */
  failures: number;
  maxMs: number;
  /** Fraction of the delay to spread over, either side (default 0.2). */
  jitter?: number;
  random?: () => number;
}

/** Milliseconds until the next run. */
export function nextDelay({
  baseMs,
  failures,
  maxMs,
  jitter = 0.2,
  random = Math.random,
}: NextDelayInput): number {
  const backed = Math.min(maxMs, baseMs * 2 ** Math.min(failures, 30));
  // random() in [0,1) maps to an offset in [-jitter, +jitter).
  const spread = backed * jitter * (random() * 2 - 1);
  const ms = Math.min(maxMs, backed + spread);
  return Math.max(MIN_DELAY_MS, Math.round(ms));
}

export interface PollerOptions {
  task: () => Promise<PollOutcome>;
  intervalMs: number;
  /** Ceiling of the error backoff (default 30 s). */
  maxBackoffMs?: number;
  /** Called once when the task reports `unauthorized`; the loop has already stopped. */
  onUnauthorized: () => void;
  isHidden?: () => boolean;
  /** Subscribe to "the tab was shown or hidden"; returns the unsubscribe. */
  onVisibilityChange?: (cb: () => void) => () => void;
  random?: () => number;
}

export interface Poller {
  start(): void;
  stop(): void;
  /** Run now (and reschedule from there). */
  refreshNow(): void;
  running(): boolean;
}

export function createPoller(opts: PollerOptions): Poller {
  const isHidden = opts.isHidden ?? (() => document.hidden);
  const subscribe =
    opts.onVisibilityChange ??
    ((cb: () => void) => {
      document.addEventListener('visibilitychange', cb);
      return () => document.removeEventListener('visibilitychange', cb);
    });
  const maxMs = opts.maxBackoffMs ?? 30_000;

  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  /** A run was asked for while one was in flight: the answer on its way may be for old filters. */
  let rerun = false;
  let failures = 0;
  let unsubscribe: (() => void) | null = null;

  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (): void => {
    clear();
    if (!active) return;
    // While hidden nothing is scheduled: the visibility listener restarts the loop.
    if (isHidden()) return;
    timer = setTimeout(
      () => void run(),
      nextDelay({ baseMs: opts.intervalMs, failures, maxMs, random: opts.random }),
    );
  };

  async function run(): Promise<void> {
    if (!active) return;
    if (inFlight) {
      rerun = true;
      return;
    }
    if (isHidden()) return;
    inFlight = true;
    let outcome: PollOutcome;
    try {
      outcome = await opts.task();
    } catch {
      outcome = 'error';
    }
    inFlight = false;
    if (!active) return;
    if (outcome === 'unauthorized') {
      stop();
      opts.onUnauthorized();
      return;
    }
    if (rerun) {
      // Whoever asked for a refresh wants an answer to THEIR question, not the one in flight:
      // ask again now and let this outcome (even a `stop`) go.
      rerun = false;
      failures = 0;
      void run();
      return;
    }
    if (outcome === 'stop') {
      stop();
      return;
    }
    failures = outcome === 'ok' ? 0 : failures + 1;
    schedule();
  }

  function start(): void {
    if (active) return;
    active = true;
    failures = 0;
    rerun = false;
    unsubscribe = subscribe(() => {
      if (!active || isHidden()) return;
      clear();
      void run();
    });
    void run();
  }

  function stop(): void {
    active = false;
    clear();
    unsubscribe?.();
    unsubscribe = null;
  }

  return {
    start,
    stop,
    refreshNow() {
      if (!active) return;
      clear();
      void run();
    },
    running: () => active,
  };
}
