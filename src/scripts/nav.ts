/**
 * Client-side navigation helpers for Astro's ClientRouter (view transitions).
 *
 * With ClientRouter the dashboard navigates WITHOUT full page reloads, so a page's
 * `<script>` (a bundled ES module) runs only ONCE — its top-level init would not
 * re-run when the user navigates back to that page. `onPage` fixes this: it runs
 * the page's init on every `astro:page-load` (which also fires on the initial
 * load), guarded by a page-unique element id so each page's handler is a no-op
 * while a different page is showing.
 *
 * `init` may return a cleanup function (sync or async-resolved); it runs on the
 * next `astro:before-swap`, i.e. when navigating AWAY from the page — use it to
 * stop things that would otherwise leak across navigation (a project Voice
 * Assistant's mic + WebSocket + AudioContext, a requestAnimationFrame loop, …).
 */
export type PageCleanup = void | (() => void);

export function onPage(guardId: string, init: () => PageCleanup | Promise<PageCleanup>): void {
  let cleanup: (() => void) | undefined;

  const run = (): void => {
    // astro:page-load fires for EVERY navigation; only init when this page's DOM
    // is actually present (its guard element exists in the swapped-in document).
    if (!document.getElementById(guardId)) return;
    void Promise.resolve(init()).then((c) => {
      if (typeof c === 'function') cleanup = c;
    });
  };

  const teardown = (): void => {
    if (cleanup) {
      try {
        cleanup();
      } catch {
        /* never let a page's cleanup break the navigation */
      }
      cleanup = undefined;
    }
  };

  document.addEventListener('astro:page-load', run);
  document.addEventListener('astro:before-swap', teardown);
}
