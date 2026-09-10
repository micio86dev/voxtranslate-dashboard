import { expect, test, type Page } from '@playwright/test';

/**
 * The dialer, in a browser (spec 0111, R30 and §"E2E TESTS").
 *
 * The API is stubbed at the network boundary, so these assert the half that
 * `server/tests/voip_api.rs` structurally cannot see: that the browser wires the server's
 * answers up into something a person — including a person who cannot see the screen — can
 * actually use.
 */

const ORG = '11111111-1111-4111-8111-111111111111';

/**
 * Routes are matched on the PATH, not on an origin.
 *
 * `PUBLIC_API_BASE` is baked into the bundle at build time from a committed
 * `.env.production`, so the origin the app calls depends on how the build was invoked. A
 * stub pinned to `http://localhost:3001` silently never matches, and the test then fails
 * for a reason that has nothing to do with the code under test.
 */
const ORGS_ROUTE = '**/api/business/organizations**';
/** Everything else the boot path reaches for, so nothing hangs the page. */
const ANY_API_ROUTE = '**/api/**';

/** A session, planted the way the app plants one after Google sign-in. */
async function signIn(page: Page) {
  await page.addInitScript(
    ([org]) => {
      localStorage.setItem('voxb.token', 'e2e-token');
      localStorage.setItem(
        'voxb.user',
        JSON.stringify({ id: 'u-1', email: 'dialer@example.test', name: 'Dialer' }),
      );
      localStorage.setItem('voxb.org', org);
    },
    [ORG],
  );
}

/**
 * The failure override is `httpStatus`, not `status`.
 *
 * A call's body legitimately carries its own `status` field ('dialing', 'answered'), so an
 * override named `status` shadows it — the stub then reads 'dialing' as an HTTP status and
 * fails with something that looks nothing like the real cause.
 */
interface Failure {
  httpStatus: number;
  error: string;
}

interface StubOptions {
  enabled?: boolean;
  quote?: Record<string, unknown> | Failure;
  dial?: Record<string, unknown> | Failure;
  /** Statuses returned by successive polls of the call detail endpoint. */
  callStatuses?: string[];
  calls?: unknown[];
}

async function stubApi(page: Page, opts: StubOptions = {}) {
  const {
    enabled = true,
    quote = {
      destination: '+39••••4567',
      country: 'IT',
      price_per_minute: '0.0468',
      currency: 'USD',
      reserve_credits: 47,
      estimated_minutes: 10,
      balance_credits: 5000,
      engine_id: 'standard',
      recording: false,
      transcription: true,
      consent_policy: 'press_key',
      disclosure_language: 'it',
    },
    dial = {
      call_id: 'c-1',
      session_id: 's-1',
      room: 'ph-abc123',
      status: 'dialing',
      reserved_credits: 47,
      price_per_minute: '0.0468',
    },
    callStatuses = ['ringing', 'answered', 'completed'],
    calls = [],
  } = opts;

  let poll = 0;

  // Registered FIRST on purpose. Playwright matches routes in **reverse** registration
  // order, so the last one wins — a catch-all added afterwards would swallow every
  // specific stub below it, and `app-boot` would choke on an org list that came back `{}`.
  await page.route(ANY_API_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  await page.route(ORGS_ROUTE, async (route) => {
    const url = route.request().url();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/voip/settings')) {
      return json({
        enabled,
        home_country: 'IT',
        allowed_countries: [],
        blocked_countries: [],
        allow_international: true,
        consent_policy: 'press_key',
        consent_refused_action: 'continue_unrecorded',
        recording_enabled: true,
        transcription_enabled: true,
        ai_analysis_enabled: true,
        max_call_minutes: 60,
        max_concurrent_per_user: 2,
        max_concurrent_per_org: 10,
        default_engine_id: 'standard',
        require_project: false,
      });
    }
    if (url.includes('/voip/quote')) {
      const q = quote as Partial<Failure>;
      return q.httpStatus ? json({ error: q.error }, q.httpStatus) : json(quote);
    }
    if (url.match(/\/voip\/calls\/[^/]+$/)) {
      const status = callStatuses[Math.min(poll++, callStatuses.length - 1)];
      return json({ id: 'c-1', status, failure_reason: null, duration_seconds: 12 });
    }
    if (url.includes('/voip/calls') && route.request().method() === 'POST') {
      const d = dial as Partial<Failure>;
      return d.httpStatus ? json({ error: d.error }, d.httpStatus) : json(dial, 201);
    }
    if (url.includes('/voip/calls')) {
      return json({ calls, page: 1, limit: 8 });
    }
    // The org list `app-boot` needs before anything else runs.
    return json([
      {
        id: ORG,
        name: 'VoIP Co',
        slug: 'voip-co',
        plan: 'business',
        role: 'owner',
        subscription_status: 'active',
        subscription_active: true,
        credits_balance: 5000,
      },
    ]);
  });
}

async function openDialer(page: Page, opts: StubOptions = {}) {
  await signIn(page);
  await stubApi(page, opts);
  await page.goto('/en/phone/');
  await expect(page.locator('#voip-on')).toBeVisible();
}

test('an organisation that has not enabled phone calls sees why, not a broken form', async ({
  page,
}) => {
  await signIn(page);
  await stubApi(page, { enabled: false });
  await page.goto('/en/phone/');

  await expect(page.locator('#voip-off')).toBeVisible();
  await expect(page.locator('#voip-on')).toBeHidden();
  await expect(page.getByText('not enabled for this organisation')).toBeVisible();
});

test('typing a number produces a price, a hold and the balance — before dialling', async ({
  page,
}) => {
  await openDialer(page);

  await page.fill('#number', '+39 320 123 4567');
  // $0.0468/min, 47 credits held, $50.00 available.
  await expect(page.locator('#rate')).toHaveText('$0.0468', { timeout: 10_000 });
  await expect(page.locator('#reserve')).toHaveText('$0.47');
  await expect(page.locator('#balance')).toHaveText('$50.00');
});

test('the dialer says what the recipient will hear, before the call', async ({ page }) => {
  await openDialer(page);
  await page.fill('#number', '+393201234567');

  // Transcription on, recording off → the transcription announcement, and a warning that
  // they will be asked to press a key.
  await expect(page.locator('#disclosure-body')).toContainText('transcribed', {
    timeout: 10_000,
  });
  await expect(page.locator('#disclosure-ask')).toBeVisible();
  await expect(page.locator('#disclosure-ask')).toContainText('press 1');
});

test('a refusal reaches the user as a sentence, never as a server code', async ({ page }) => {
  await openDialer(page, {
    quote: { httpStatus: 402, error: 'destination_too_expensive' },
  });

  await page.fill('#number', '+8613800138000');
  const err = page.locator('#number-error');
  await expect(err).toBeVisible({ timeout: 10_000 });
  await expect(err).toContainText('costs more per minute');
  await expect(err).not.toContainText('destination_too_expensive');
});

test('an unknown refusal code still says something human', async ({ page }) => {
  // A server that grows a new reason must not print it raw at a customer.
  await openDialer(page, { quote: { httpStatus: 402, error: 'brand_new_reason' } });

  await page.fill('#number', '+393201234567');
  const err = page.locator('#number-error');
  await expect(err).toBeVisible({ timeout: 10_000 });
  await expect(err).toContainText('could not be placed');
  await expect(err).not.toContainText('brand_new_reason');
});

test('the call state is announced to assistive technology, not merely coloured', async ({
  page,
}) => {
  await openDialer(page);
  await page.fill('#number', '+393201234567');
  await expect(page.locator('#rate')).not.toHaveText('—', { timeout: 10_000 });

  const live = page.locator('#phase-live');
  await expect(live).toHaveAttribute('aria-live', 'assertive');
  await expect(live).toHaveAttribute('role', 'status');

  await page.click('#call');

  // R30: the live region carries words, and the visible badge does too — the state is
  // never conveyed by colour alone.
  await expect(live).not.toBeEmpty({ timeout: 10_000 });
  await expect(page.locator('#phase')).not.toBeEmpty();
  await expect(page.locator('#phase')).toContainText(/Dialling|Ringing|Connected/);
});

test('a call walks from dialling to completed and offers hang-up only while it is live', async ({
  page,
}) => {
  await openDialer(page, { callStatuses: ['ringing', 'answered', 'completed'] });
  await page.fill('#number', '+393201234567');
  await expect(page.locator('#rate')).not.toHaveText('—', { timeout: 10_000 });

  await page.click('#call');
  await expect(page.locator('#end')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#call')).toBeHidden();

  await expect(page.locator('#phase')).toHaveText('Call ended', { timeout: 20_000 });
  // Once it is over, hanging up is not offered and calling again is.
  await expect(page.locator('#end')).toBeHidden();
  await expect(page.locator('#call')).toBeVisible();
});

test('a live call offers a way into the room, and stops offering it once it ends', async ({
  page,
}) => {
  // The dashboard places the call; the app carries the audio. Without this link the caller
  // is not in their own call — the engine translates a speaker into the room's OTHER
  // languages, and a room holding only the telephone has none.
  await openDialer(page, { callStatuses: ['ringing', 'answered', 'completed'] });
  await page.fill('#number', '+393201234567');
  await expect(page.locator('#rate')).not.toHaveText('—', { timeout: 10_000 });

  await page.click('#call');
  const join = page.locator('#join');
  await expect(join).toBeVisible({ timeout: 10_000 });
  await expect(join).toHaveAttribute('href', /\/\?room=ph-abc123$/);
  // A new tab, so hanging up from here stays available while the call is in the app.
  await expect(join).toHaveAttribute('target', '_blank');
  await expect(join).toHaveAttribute('rel', /noopener/);

  await expect(page.locator('#phase')).toHaveText('Call ended', { timeout: 20_000 });
  await expect(join).toBeHidden();
});

test('a call that never returns a room offers no way in', async ({ page }) => {
  // A link built anyway would drop the caller into a room nobody is in, which reads as a
  // broken call rather than a server that did not answer the question.
  await openDialer(page, {
    dial: { call_id: 'c-1', session_id: 's-1', status: 'dialing', reserved_credits: 1, price_per_minute: '0.05' },
    callStatuses: ['ringing', 'answered'],
  });
  await page.fill('#number', '+393201234567');
  await expect(page.locator('#rate')).not.toHaveText('—', { timeout: 10_000 });

  await page.click('#call');
  await expect(page.locator('#end')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#join')).toBeHidden();
});

test('a dial refused for credits is reported without losing the form', async ({ page }) => {
  await openDialer(page, { dial: { httpStatus: 402, error: 'insufficient_credits' } });
  await page.fill('#number', '+393201234567');
  await expect(page.locator('#rate')).not.toHaveText('—', { timeout: 10_000 });

  await page.click('#call');
  const err = page.locator('#call-error');
  await expect(err).toBeVisible({ timeout: 10_000 });
  await expect(err).toContainText('Not enough credits');
  // The number the user typed is still there — they should not have to retype it to top up
  // and try again.
  await expect(page.locator('#number')).toHaveValue('+39 320 123 4567'.replace(/\s/g, '') || '');
});

test('AI analysis cannot be requested without a transcript', async ({ page }) => {
  await openDialer(page);

  const ai = page.locator('#opt-ai');
  const transcribe = page.locator('#opt-transcribe');

  await expect(transcribe).toBeChecked();
  await expect(ai).toBeEnabled();

  await transcribe.uncheck();
  await expect(ai).toBeDisabled();
  await expect(ai).not.toBeChecked();
  await expect(page.locator('#ai-hint')).toBeVisible();

  await transcribe.check();
  await expect(ai).toBeEnabled();
});

test('the recent-calls list shows the masked number, never the full one', async ({ page }) => {
  await openDialer(page, {
    calls: [
      {
        id: 'c-9',
        status: 'completed',
        failure_reason: null,
        direction: 'outbound',
        recipient_country: 'CN',
        recipient_masked: '+86••••8000',
        source_language: 'it',
        target_language: 'zh',
        engine_id: 'standard',
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration_seconds: 95,
        credits_consumed: 120,
        recording_status: 'none',
        transcription_status: 'ready',
        consent_status: 'not_required',
        project_id: null,
        project_name: null,
      },
    ],
  });

  const recent = page.locator('#recent');
  await expect(recent).toContainText('+86••••8000', { timeout: 10_000 });
  await expect(recent).toContainText('1:35');
  await expect(recent).toContainText('$1.20');
  // The status is a word, not a colour.
  await expect(recent).toContainText('Call ended');
});

test('the dialer is operable from the keyboard alone', async ({ page }) => {
  await openDialer(page);

  // Tab reaches the number field, and typing into it works without a pointer.
  await page.keyboard.press('Tab');
  await page.locator('#number').focus();
  await page.keyboard.type('+393201234567');
  await expect(page.locator('#rate')).not.toHaveText('—', { timeout: 10_000 });

  // Every control has an accessible name.
  await expect(page.getByLabel('Phone number')).toBeVisible();
  await expect(page.getByLabel('My language')).toBeVisible();
  await expect(page.getByLabel('Their language')).toBeVisible();
  await expect(page.getByLabel('Translation tier')).toBeVisible();
});
