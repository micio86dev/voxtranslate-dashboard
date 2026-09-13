// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onPage } from './nav';

/** Fire the Astro ClientRouter events `onPage` listens to. */
const pageLoad = () => document.dispatchEvent(new Event('astro:page-load'));
const beforeSwap = () => document.dispatchEvent(new Event('astro:before-swap'));

/** Put this page's guard element into the swapped-in document. */
function mountGuard(id: string): void {
  const el = document.createElement('div');
  el.id = id;
  document.body.append(el);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('onPage', () => {
  it('runs the page init on the initial page-load', async () => {
    const init = vi.fn();
    onPage('guard', init);
    mountGuard('guard');

    pageLoad();
    await Promise.resolve();

    expect(init).toHaveBeenCalledTimes(1);
  });

  it('does nothing while a different page is showing', async () => {
    const init = vi.fn();
    onPage('guard', init);
    mountGuard('some-other-page');

    pageLoad();
    await Promise.resolve();

    expect(init).not.toHaveBeenCalled();
  });

  it('re-runs the init when the user navigates back to the page', async () => {
    // The whole reason this helper exists: with ClientRouter a page's bundled module
    // executes once, so top-level init would never run again.
    const init = vi.fn();
    onPage('guard', init);
    mountGuard('guard');

    pageLoad();
    await Promise.resolve();
    beforeSwap();
    pageLoad();
    await Promise.resolve();

    expect(init).toHaveBeenCalledTimes(2);
  });

  it('runs the returned cleanup when navigating away', async () => {
    const cleanup = vi.fn();
    onPage('guard', () => cleanup);
    mountGuard('guard');

    pageLoad();
    await Promise.resolve();
    expect(cleanup).not.toHaveBeenCalled();

    beforeSwap();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('awaits an async init before holding on to its cleanup', async () => {
    const cleanup = vi.fn();
    onPage('guard', async () => cleanup);
    mountGuard('guard');

    pageLoad();
    beforeSwap(); // too early — the init has not resolved yet
    expect(cleanup).not.toHaveBeenCalled();

    await Promise.resolve();
    await Promise.resolve();
    beforeSwap();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('runs a cleanup once, not on every subsequent navigation', async () => {
    const cleanup = vi.fn();
    onPage('guard', () => cleanup);
    mountGuard('guard');

    pageLoad();
    await Promise.resolve();
    beforeSwap();
    beforeSwap();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('accepts an init that returns nothing to clean up', async () => {
    onPage('guard', () => undefined);
    mountGuard('guard');

    pageLoad();
    await Promise.resolve();

    expect(() => beforeSwap()).not.toThrow();
  });

  it('never lets a throwing cleanup break the navigation', async () => {
    const next = vi.fn();
    onPage('guard', () => () => {
      throw new Error('cleanup exploded');
    });
    onPage('other', next);
    mountGuard('guard');
    mountGuard('other');

    pageLoad();
    await Promise.resolve();

    expect(() => beforeSwap()).not.toThrow();
    pageLoad();
    await Promise.resolve();
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('replaces the stored cleanup on each re-entry so nothing leaks across navigations', async () => {
    // A project's Voice Assistant holds a mic, a WebSocket and an AudioContext; the
    // SECOND visit's teardown must release the SECOND visit's resources.
    const cleanups = [vi.fn(), vi.fn()];
    let visit = 0;
    onPage('guard', () => cleanups[visit++] as () => void);
    mountGuard('guard');

    pageLoad();
    await Promise.resolve();
    beforeSwap();
    pageLoad();
    await Promise.resolve();
    beforeSwap();

    expect(cleanups[0]).toHaveBeenCalledTimes(1);
    expect(cleanups[1]).toHaveBeenCalledTimes(1);
  });

  it('keeps each page independent when several register handlers', async () => {
    const a = vi.fn();
    const b = vi.fn();
    onPage('page-a', a);
    onPage('page-b', b);
    mountGuard('page-b');

    pageLoad();
    await Promise.resolve();

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});
