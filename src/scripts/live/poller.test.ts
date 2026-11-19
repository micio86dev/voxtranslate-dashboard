import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPoller, nextDelay, type PollOutcome } from './poller';

describe('nextDelay', () => {
  const noJitter = () => 0.5; // 0.5 maps to a zero offset

  it('is the base interval while everything succeeds', () => {
    expect(nextDelay({ baseMs: 2000, failures: 0, maxMs: 30000, random: noJitter })).toBe(2000);
  });

  it('doubles per consecutive failure and stops at the ceiling', () => {
    const d = (failures: number) =>
      nextDelay({ baseMs: 2000, failures, maxMs: 30000, random: noJitter });
    expect(d(1)).toBe(4000);
    expect(d(2)).toBe(8000);
    expect(d(3)).toBe(16000);
    expect(d(4)).toBe(30000);
    expect(d(40)).toBe(30000);
  });

  it('spreads clients apart with jitter, within the stated fraction', () => {
    const lo = nextDelay({ baseMs: 1000, failures: 0, maxMs: 9000, jitter: 0.2, random: () => 0 });
    const hi = nextDelay({
      baseMs: 1000,
      failures: 0,
      maxMs: 9000,
      jitter: 0.2,
      random: () => 0.999999,
    });
    expect(lo).toBe(800);
    expect(hi).toBeGreaterThan(1190);
    expect(hi).toBeLessThanOrEqual(1200);
  });

  it('never returns less than 100 ms', () => {
    expect(nextDelay({ baseMs: 1, failures: 0, maxMs: 10, random: noJitter })).toBe(100);
  });
});

describe('createPoller', () => {
  let hidden = false;
  let visibility: (() => void) | null = null;

  const env = () => ({
    isHidden: () => hidden,
    onVisibilityChange: (cb: () => void) => {
      visibility = cb;
      return () => {
        visibility = null;
      };
    },
    random: () => 0.5,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    visibility = null;
  });
  afterEach(() => vi.useRealTimers());

  function make(outcomes: PollOutcome[], extra: Record<string, unknown> = {}) {
    const task = vi.fn(async () => outcomes.shift() ?? 'ok');
    const onUnauthorized = vi.fn();
    const poller = createPoller({
      task,
      intervalMs: 2000,
      maxBackoffMs: 16000,
      onUnauthorized,
      ...env(),
      ...extra,
    });
    return { task, onUnauthorized, poller };
  }

  it('runs at once, then on the interval', async () => {
    const { task, poller } = make([]);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('backs off after an error and recovers after a success', async () => {
    const { task, poller } = make(['error', 'error', 'ok']);
    poller.start();
    await vi.advanceTimersByTimeAsync(0); // run 1 -> error, next in 4000
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // run 2 -> error, next in 8000
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(7999);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); // run 3 -> ok, next in 2000
    expect(task).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledTimes(4);
    poller.stop();
  });

  it('stops for good on unauthorized and tells the page', async () => {
    const { task, onUnauthorized, poller } = make(['ok', 'unauthorized']);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(task).toHaveBeenCalledTimes(2);
    expect(poller.running()).toBe(false);
  });

  it('stops on a stop outcome without calling onUnauthorized', async () => {
    const { task, onUnauthorized, poller } = make(['stop']);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(task).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('treats a thrown task as an error, not a crash', async () => {
    const task = vi.fn(async () => {
      throw new Error('boom');
    });
    const poller = createPoller({ task, intervalMs: 1000, onUnauthorized: vi.fn(), ...env() });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000); // 1000 * 2^1
    expect(task).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('does not poll while the tab is hidden, and refreshes when it is shown again', async () => {
    const { task, poller } = make([]);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    hidden = true;
    await vi.advanceTimersByTimeAsync(10000);
    expect(task).toHaveBeenCalledTimes(1);

    hidden = false;
    visibility?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('a visibility event while hidden does nothing', async () => {
    const { task, poller } = make([]);
    hidden = true;
    poller.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(0);
    visibility?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(0);
    poller.stop();
  });

  it('never overlaps two runs of the task', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const task = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5000));
      inFlight--;
      return 'ok' as const;
    });
    const poller = createPoller({ task, intervalMs: 1000, onUnauthorized: vi.fn(), ...env() });
    poller.start();
    await vi.advanceTimersByTimeAsync(20000);
    expect(maxInFlight).toBe(1);
    poller.stop();
  });

  it('refreshNow runs immediately and resets the schedule; stop prevents further runs', async () => {
    const { task, poller } = make(['error']);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    poller.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2);
    poller.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(task).toHaveBeenCalledTimes(2);
    expect(visibility).toBeNull();
  });

  it('start twice does not double the schedule', async () => {
    const { task, poller } = make([]);
    poller.start();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('a restart while a run is in flight asks again as soon as it lands (filters changed)', async () => {
    const asked: number[] = [];
    let n = 0;
    const task = vi.fn(async () => {
      const mine = ++n;
      asked.push(mine);
      await new Promise((r) => setTimeout(r, 3000));
      return 'ok' as const;
    });
    const poller = createPoller({ task, intervalMs: 10_000, onUnauthorized: vi.fn(), ...env() });
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    poller.stop();
    poller.start(); // the page restarts it because a filter changed
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1); // still the first one in flight: never two at once
    await vi.advanceTimersByTimeAsync(2000); // the first lands...
    expect(task).toHaveBeenCalledTimes(2); // ...and the answer for the NEW filters is asked at once
    poller.stop();
  });

  it('a stale "stop" outcome does not end a loop that was restarted meanwhile', async () => {
    const outcomes: PollOutcome[] = ['stop', 'ok', 'ok'];
    const task = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 1000));
      return outcomes.shift() ?? 'ok';
    });
    const poller = createPoller({ task, intervalMs: 5000, onUnauthorized: vi.fn(), ...env() });
    poller.start();
    await vi.advanceTimersByTimeAsync(500);
    poller.stop();
    poller.start();
    await vi.advanceTimersByTimeAsync(600); // first lands with `stop`, which is now stale
    expect(poller.running()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000); // the rerun lands with `ok`
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('still stops on unauthorized even when a rerun was waiting', async () => {
    const onUnauthorized = vi.fn();
    const task = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 1000));
      return 'unauthorized' as const;
    });
    const poller = createPoller({ task, intervalMs: 5000, onUnauthorized, ...env() });
    poller.start();
    await vi.advanceTimersByTimeAsync(300);
    poller.refreshNow();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('defaults to the real document for visibility', async () => {
    const task = vi.fn(async () => 'ok' as const);
    const poller = createPoller({ task, intervalMs: 1000, onUnauthorized: vi.fn() });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    poller.stop();
  });
});
