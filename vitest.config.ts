import { defineConfig } from 'vitest/config';

// Unit tests for the dashboard's browser-glue modules: the typed API client,
// auth/session helpers, i18n lookup, push opt-in, the inline chart renderers,
// and the shared page bootstrap + subscription banner. Browser APIs (fetch,
// localStorage, Notification, service worker) are mocked; the .astro pages
// themselves are exercised by the consumer app's e2e, not here.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      // Every TypeScript module under src/, not an allowlist. The list this
      // replaced named nine files, so a module with no tests simply did not exist
      // for the gate: `phone-dialer.ts` shipped with tests and was left out for a
      // whole release (spec 0112 D8), and `help-assistant.ts`, `voice-assistant.ts`,
      // `nav.ts` and the SharedWorker were never measured at all. `all` (the vitest
      // default) reports untouched files too, so a new untested module now shows up
      // as a gap instead of leaving the average alone.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage-unit',
      thresholds: { lines: 85, functions: 85 },
    },
  },
});
