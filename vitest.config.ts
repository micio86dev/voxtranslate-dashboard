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
      include: [
        'src/lib/api.ts',
        'src/lib/auth.ts',
        'src/lib/charts.ts',
        'src/lib/i18n.ts',
        'src/lib/push.ts',
        'src/scripts/app-boot.ts',
        // The dialer's logic modules. `phone-dialer.ts` shipped with tests but was never
        // in this list, so the 85% gate never saw it (spec 0112 D8).
        'src/scripts/phone-catalogue.ts',
        'src/scripts/phone-dialer.ts',
        'src/scripts/sub-banner.ts',
      ],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage-unit',
      thresholds: { lines: 85, functions: 85 },
    },
  },
});
