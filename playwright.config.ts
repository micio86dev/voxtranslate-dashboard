import { defineConfig } from '@playwright/test';

/**
 * Browser tests for the dashboard (spec 0111, §"E2E TESTS").
 *
 * The API is stubbed at the network boundary with `page.route`, so these need **no
 * backend, no database and no telephony provider**, and run in seconds.
 *
 * That split is deliberate rather than a shortcut. The server-side end-to-end behaviour —
 * the policy gate, credit holds, webhook idempotency, tenancy — is covered by
 * `server/tests/voip_api.rs`, which runs a real Axum server against a real Postgres. What
 * that cannot see is whether the browser wires any of it up: whether a refusal reaches the
 * user as a localised sentence, whether the call state is *announced* rather than merely
 * coloured, whether the disclosure preview matches what the recipient will actually hear.
 * Those are what these specs assert.
 *
 * Run:
 *   npm run build && npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  webServer: process.env.E2E_BASE
    ? undefined
    : {
        // NOT `astro preview`: it daemonizes, so the command returns immediately and
        // Playwright reads that as "the web server exited early" and aborts the whole run.
        // The call app's config carries the same note for the same reason.
        //
        // The build is a directory of flat files with `trailingSlash: 'always'`, so any
        // static server that resolves a directory to its index.html will do — and one that
        // stays in the foreground is the entire point.
        command: 'python3 -m http.server 4322 --bind 127.0.0.1 --directory dist',
        // 127.0.0.1, not localhost: the call app's e2e note applies here too — on a
        // machine where something else holds ::1 on the port, `localhost` resolves to IPv6
        // first and the readiness probe reads the wrong server.
        url: 'http://127.0.0.1:4322',
        reuseExistingServer: true,
        timeout: 120_000,
      },
  use: {
    baseURL: process.env.E2E_BASE || 'http://127.0.0.1:4322',
    // The dashboard has no video; a trace on failure is worth far more than screenshots.
    trace: 'retain-on-failure',
  },
});
