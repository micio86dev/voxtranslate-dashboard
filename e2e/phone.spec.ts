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
/** The two shared, unauthenticated catalogues the dialer fills its selects from. */
const ENGINES_ROUTE = '**/api/engines**';
const LANGUAGES_ROUTE = '**/api/languages**';

const ENGINES = [
  {
    id: 'standard',
    display_name: 'Standard',
    tier: 'standard',
    description: '',
    rate_per_minute: 0.0045,
    input_languages: ['en', 'it', 'zh'],
    output_languages: ['en', 'it', 'zh'],
  },
];

const LANGUAGES = {
  regions: ['Europe', 'Asia'],
  languages: [
    { code: 'en', native: 'English', english: 'English', region: 'Europe', rtl: false, flag: 'GB' },
    {
      code: 'it',
      native: 'Italiano',
      english: 'Italian',
      region: 'Europe',
      rtl: false,
      flag: 'IT',
    },
    { code: 'zh', native: 'Zhongwen', english: 'Chinese', region: 'Asia', rtl: false, flag: 'CN' },
  ],
};

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
  /** The `/video-invite` response. A `Failure` here proves video stays an enhancement. */
  videoInvite?: Record<string, unknown> | Failure;
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
    videoInvite = {
      url: 'https://api.test/api/voip/video/tok.sig',
      expires_at: '2026-01-01T00:15:00Z',
    },
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
    if (url.includes('/voip/contacts/lookup')) {
      return json({ error: 'not found' }, 404);
    }
    if (url.match(/\/voip\/contacts\/[^/?]+$/) && route.request().method() === 'GET') {
      return json({
        id: 'k-1',
        name: 'Wei Zhang',
        company: 'Shenzhen Optics',
        role: null,
        notes: null,
        tags: ['supplier'],
        email: null,
        numbers: [
          {
            id: 'n-1',
            e164: '+8613800138000',
            label: 'Mobile',
            language: 'zh',
            country: 'CN',
            is_primary: true,
          },
        ],
        projects: [],
      });
    }
    if (url.includes('/voip/contacts')) {
      if (route.request().method() === 'POST') return json({ id: 'k-2' }, 201);
      return json({
        contacts: [
          {
            id: 'k-1',
            name: 'Wei Zhang',
            company: 'Shenzhen Optics',
            role: null,
            notes: null,
            tags: ['supplier'],
            email: null,
          },
        ],
        page: 1,
        limit: 50,
      });
    }
    if (url.includes('/voip/analytics')) {
      return json({
        days: 30,
        totals: {
          calls: 12,
          inbound: 5,
          outbound: 7,
          answered: 10,
          missed: 2,
          seconds: 1800,
          credits: 640,
        },
        by_country: [{ label: 'CN', calls: 7, credits: 400 }],
        by_language: [{ label: 'it → zh', calls: 7, credits: 400 }],
        by_tier: [{ label: 'standard', calls: 12, credits: 640 }],
        by_project: [{ label: '—', calls: 12, credits: 640 }],
        calls_by_day: [{ day: '2026-09-01', calls: 12 }],
        telephony_credits_spent: 820,
      });
    }
    if (url.includes('/routing')) {
      if (route.request().method() === 'PUT') return route.fulfill({ status: 204, body: '' });
      return json({
        ring_mode: 'owners',
        ring_user_ids: [],
        ring_team_id: null,
        ring_seconds: 25,
        no_answer_action: 'voicemail',
        forward_to: null,
        stranger_language: null,
      });
    }
    if (url.includes('/voip/numbers/search')) {
      return json({
        offers: [
          {
            e164: '+390212340001',
            country: 'IT',
            kind: 'local',
            monthly: '1.620000',
            setup: '1.200000',
            currency: 'USD',
            regulatory_requirement: null,
          },
          {
            e164: '+390212340002',
            country: 'IT',
            kind: 'local',
            monthly: '1.620000',
            setup: '1.200000',
            currency: 'USD',
            regulatory_requirement: 'A local address in this country is required.',
          },
        ],
      });
    }
    if (url.match(/\/voip\/numbers\/[^/]+$/) && route.request().method() === 'DELETE') {
      return route.fulfill({ status: 204, body: '' });
    }
    if (url.includes('/voip/numbers') && route.request().method() === 'POST') {
      return json(
        {
          id: 'n-9',
          e164: '+390212340001',
          status: 'active',
          monthly: '1.620000',
          setup: '1.200000',
        },
        201,
      );
    }
    if (url.includes('/voip/numbers')) {
      return json({
        numbers: [
          {
            id: 'n-1',
            e164: '+390212345678',
            country: 'IT',
            label: 'Milan Office',
            is_default: true,
            inbound_enabled: false,
            outbound_enabled: true,
            verification_status: 'verified',
          },
          {
            id: 'n-2',
            e164: '+34911234567',
            country: 'ES',
            label: 'Sales Spain',
            is_default: false,
            inbound_enabled: false,
            outbound_enabled: true,
            verification_status: 'pending',
          },
        ],
      });
    }
    if (url.includes('/voip/quote')) {
      const q = quote as Partial<Failure>;
      return q.httpStatus ? json({ error: q.error }, q.httpStatus) : json(quote);
    }
    // Before the generic call-detail match, which would otherwise swallow it.
    if (url.includes('/video-invite')) {
      const v = videoInvite as Partial<Failure>;
      return v.httpStatus ? json({ error: v.error }, v.httpStatus) : json(videoInvite);
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
    if (url.includes('/members')) {
      return json([
        { user_id: 'u-1', name: 'Dialer', email: 'dialer@example.test', role: 'owner' },
      ]);
    }
    if (url.includes('/teams')) {
      return json([{ id: 't-1', name: 'Sales' }]);
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

  // Registered after the catch-all, so these win: Playwright matches in reverse
  // registration order. Without them `**/api/**` answers `{}` and the dialer's selects
  // stay empty — which is now a refusal, not a silently empty language.
  await page.route(ENGINES_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ engines: ENGINES }),
    }),
  );
  await page.route(LANGUAGES_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(LANGUAGES),
    }),
  );
}

async function openDialer(page: Page, opts: StubOptions = {}) {
  await signIn(page);
  await stubApi(page, opts);
  await page.goto('/en/phone/');
  await expect(page.locator('#voip-on')).toBeVisible();
  // The catalogues arrive after boot, and the dialer is not usable until they have.
  await expect(page.locator('#tier option')).toHaveCount(ENGINES.length);
  // The caller's language defaults to their dashboard locale. The recipient's is not
  // guessable from anything the product knows, so every test that dials chooses one —
  // exactly as a user must.
  await page.selectOption('#their-lang', 'zh');
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
    dial: {
      call_id: 'c-1',
      session_id: 's-1',
      status: 'dialing',
      reserved_credits: 1,
      price_per_minute: '0.05',
    },
    callStatuses: ['ringing', 'answered'],
  });
  await page.fill('#number', '+393201234567');
  await expect(page.locator('#rate')).not.toHaveText('—', { timeout: 10_000 });

  await page.click('#call');
  await expect(page.locator('#end')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#join')).toBeHidden();
});

test('a live call can offer the recipient a video link, and it is not the room code', async ({
  page,
}) => {
  // D9. The recipient is on a telephone, so the upgrade is a link the caller passes on.
  // It carries a signed ticket rather than the room, because an invitation gets forwarded
  // and a room code has no expiry.
  await openDialer(page, { callStatuses: ['ringing', 'answered', 'completed'] });
  await page.fill('#number', '+393201234567');
  await expect(page.locator('#rate')).not.toHaveText('—', { timeout: 10_000 });

  await page.click('#call');
  const video = page.locator('#video');
  await expect(video).toBeVisible({ timeout: 10_000 });
  await video.click();

  const url = page.locator('#video-url');
  await expect(url).toBeVisible();
  await expect(url).toHaveValue(/\/api\/voip\/video\//);
  await expect(url).not.toHaveValue(/ph-abc123/);

  // Withdrawn once the call is over, along with the link minted for it.
  await expect(page.locator('#phase')).toHaveText('Call ended', { timeout: 20_000 });
  await expect(video).toBeHidden();
  await expect(page.locator('#video-box')).toBeHidden();
});

test('a video upgrade that fails leaves the call alone', async ({ page }) => {
  // The rule D9 states outright: video is an enhancement, never a dependency.
  await openDialer(page, {
    callStatuses: ['ringing', 'answered', 'answered'],
    videoInvite: { httpStatus: 404, error: 'not_found' },
  });
  await page.fill('#number', '+393201234567');
  await expect(page.locator('#rate')).not.toHaveText('—', { timeout: 10_000 });

  await page.click('#call');
  await expect(page.locator('#video')).toBeVisible({ timeout: 10_000 });
  await page.click('#video');

  await expect(page.locator('#video-status')).toContainText('not available');
  // The call is untouched: still live, still hang-up-able.
  await expect(page.locator('#end')).toBeVisible();
  await expect(page.locator('#call-error')).toBeHidden();
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

// ---- spec 0112: the selects, and what the browser now refuses to send -------

test('the language, tier and caller-id selects are filled from the catalogues', async ({
  page,
}) => {
  // They shipped in 1.50.0 declared in markup and never populated, so the dialer could
  // not express the one thing the product is for: which language each side speaks.
  await openDialer(page);

  await expect(page.locator('#tier option')).toHaveCount(1);
  await expect(page.locator('#tier')).toContainText('Standard');

  // Named the way the call app names them, grouped by the catalogue's region order.
  await expect(page.locator('#their-lang optgroup')).toHaveCount(2);
  await expect(page.locator('#their-lang')).toContainText('Italiano');
  await expect(page.locator('#their-lang')).toContainText('Chinese');

  // The caller's own language defaults to their dashboard locale.
  await expect(page.locator('#my-lang')).toHaveValue('en');

  // Only the verified, outbound-enabled number is offered: the server refuses the rest,
  // so offering one would produce a refusal after the user had already chosen it.
  await expect(page.locator('#caller-id')).toContainText('Milan Office');
  await expect(page.locator('#caller-id')).not.toContainText('Sales Spain');
});

test('a dial with no recipient language is refused here, and nothing is sent', async ({ page }) => {
  const dialAttempts: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/voip/calls')) dialAttempts.push(req.url());
  });

  await openDialer(page);
  // Undo the choice `openDialer` makes, to reproduce what a user sees on arrival.
  await page.selectOption('#their-lang', '');
  await page.fill('#number', '+39 320 123 4567');
  await page.click('#call');

  await expect(page.locator('#call-error')).toBeVisible();
  await expect(page.locator('#call-error')).toHaveText(/language/i);
  // Focus lands on the control that needs fixing, so the fix is reachable without hunting.
  await expect(page.locator('#their-lang')).toBeFocused();
  // The point of the exercise: the request never left the browser.
  expect(dialAttempts).toEqual([]);
});

test('an unparseable number is reported before any language problem', async ({ page }) => {
  // The number is what the user typed first and what the server checks first. Reporting a
  // language problem on a number that cannot be dialled sends them to the wrong field.
  await openDialer(page);
  await page.selectOption('#their-lang', '');
  await page.fill('#number', 'nope');
  await page.click('#call');

  await expect(page.locator('#number-error')).toBeVisible();
  await expect(page.locator('#number')).toBeFocused();
  await expect(page.locator('#call-error')).toBeHidden();
});

test('a refusal for credits offers a way to buy some', async ({ page }) => {
  await openDialer(page, {
    dial: { httpStatus: 402, error: 'insufficient_credits' },
  });
  await page.fill('#number', '+39 320 123 4567');
  await page.click('#call');

  await expect(page.locator('#call-error')).toBeVisible();
  const cta = page.locator('#call-error-cta');
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute('href', '/en/credits/#plans');
});

test('the settings page exists and round-trips what an admin saves', async ({ page }) => {
  // The dialer has linked here since 1.50.0 and the link 404'd.
  let saved: Record<string, unknown> | null = null;
  await signIn(page);
  await stubApi(page);
  await page.route('**/voip/settings', async (route) => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...saved, enabled: true }),
      });
    }
    return route.fallback();
  });

  await page.goto('/en/phone/settings/');
  await expect(page.locator('#settings-form')).toBeVisible();
  await expect(page.locator('#home-country')).toHaveValue('IT');

  await page.fill('#blocked', 'RU, BY');
  await page.click('#save');

  await expect(page.locator('#saved')).toBeVisible();
  expect(saved).toBeTruthy();
  expect(saved!.blocked_countries).toEqual(['RU', 'BY']);
});

test('the call detail page shows what was charged and never our margin', async ({ page }) => {
  await signIn(page);
  await stubApi(page);
  await page.route('**/voip/calls/c-9', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'c-9',
        session_id: 's-9',
        status: 'completed',
        failure_reason: null,
        direction: 'outbound',
        recipient_e164: '+8613800138000',
        recipient_country: 'CN',
        source_language: 'it',
        target_language: 'zh',
        engine_id: 'standard',
        started_at: '2026-09-01T10:00:00Z',
        ended_at: '2026-09-01T10:01:35Z',
        duration_seconds: 95,
        credits_consumed: 120,
        quoted_price_per_min: '0.0468',
        cost_status: 'final',
        recording_status: 'none',
        transcription_status: 'ready',
        consent_status: 'granted',
        project_id: null,
      }),
    }),
  );

  await page.goto('/en/phone/detail/?id=c-9');
  await expect(page.locator('#recipient')).toHaveText('+8613800138000');
  await expect(page.locator('#credits')).toHaveText('$1.20');
  await expect(page.locator('#consent')).toHaveText(/consent given/i);

  // The conversation is linked, not re-implemented: history/detail already renders the
  // transcript, its translation, the recording and the exports for this session.
  await expect(page.locator('#open-transcript')).toHaveAttribute(
    'href',
    '/en/history/detail/?session=s-9',
  );

  // R6: our cost and our margin are not in the page, under any name.
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/gross margin/i);
  expect(body).not.toMatch(/provider cost/i);
});

test('the quote is asked for the tier and destination actually selected', async ({ page }) => {
  // The shipped dialer quoted with only the destination and the capture flags, so the
  // figure was always priced on the DEFAULT engine: you could change the tier and watch
  // the price not move. The server also could not run the project or caller-id checks it
  // runs on dial, because it had not been told about them.
  const quoteBodies: Record<string, unknown>[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/voip/quote')) {
      quoteBodies.push(req.postDataJSON());
    }
  });

  await openDialer(page);
  await page.fill('#number', '+39 320 123 4567');
  await expect(page.locator('#rate')).not.toHaveText('—');

  const last = quoteBodies[quoteBodies.length - 1];
  expect(last.engine_id).toBe('standard');
  expect(last.target_language).toBe('zh');
  expect(last.caller_id).toBe('+390212345678');
});

test('a refusal the server now names is shown by name, not as "something went wrong"', async ({
  page,
}) => {
  // `project_required` crossed the boundary as English `text/plain` until spec 0112.
  // The dashboard could not parse it, so it rendered the generic message for a problem
  // with an obvious fix.
  await openDialer(page, {
    dial: { httpStatus: 400, error: 'project_required' },
  });
  await page.fill('#number', '+39 320 123 4567');
  await page.click('#call');

  await expect(page.locator('#call-error')).toBeVisible();
  await expect(page.locator('#call-error')).toHaveText(/project/i);
});

test('every link in the phone section carries its trailing slash and resolves', async ({
  page,
}) => {
  // `trailingSlash: 'always'`. The dialer built its settings link by hand — the only href
  // in the repo not going through `localizePath`, which appends the slash unconditionally
  // — so it 404'd in dev and cost a redirect hop in production.
  await openDialer(page);

  const hrefs = await page
    .locator('nav[aria-label] a[href^="/en/phone"]')
    .evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? ''));
  expect(hrefs.length).toBeGreaterThanOrEqual(3);
  for (const href of hrefs) {
    expect(href, `${href} must end in a slash`).toMatch(/\/$/);
  }
  expect(hrefs).toContain('/en/phone/settings/');
  expect(hrefs).toContain('/en/phone/calls/');
});

test('a failed history request is not reported as an empty history', async ({ page }) => {
  // Telling a customer they have made no calls because a request failed is a support
  // ticket. The dialer's recent list already got this right; the history page did not.
  await signIn(page);
  await stubApi(page);
  await page.route('**/voip/calls?**', (route) => route.fulfill({ status: 500, body: '{}' }));

  await page.goto('/en/phone/calls/');
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#empty')).not.toHaveText(/no calls/i);
});

// ---- contacts (spec 0114) --------------------------------------------------

test('choosing a contact fills the number and the language that number speaks', async ({
  page,
}) => {
  // The whole reason the language lives on the NUMBER rather than on the person: with it
  // the dialer stops asking, eighty-four options at a time, what language someone speaks.
  await openDialer(page);
  // Undo `openDialer`'s choice so the preselection is what sets it.
  await page.selectOption('#their-lang', '');

  await page.selectOption('#contact', 'k-1');

  await expect(page.locator('#number')).toHaveValue('+8613800138000');
  await expect(page.locator('#their-lang')).toHaveValue('zh');
});

test('the address book lists people and opens one for editing', async ({ page }) => {
  await signIn(page);
  await stubApi(page);
  await page.goto('/en/phone/contacts/');

  await expect(page.locator('#rows')).toContainText('Wei Zhang');
  await expect(page.locator('#rows')).toContainText('Shenzhen Optics');
  await expect(page.locator('#editor')).toBeHidden();

  await page.getByRole('button', { name: /Wei Zhang/ }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#c-name')).toHaveValue('Wei Zhang');
  // The number row carries its own language select, set to what that number speaks.
  await expect(page.locator('#numbers [data-field="language"]')).toHaveValue('zh');
});

test('a refused number says which rule it broke', async ({ page }) => {
  // `number_already_known` is a stable code with copy in five locales, not English prose
  // in a text/plain body.
  await signIn(page);
  await stubApi(page);
  await page.route('**/voip/contacts', async (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'number_already_known' }),
      });
    }
    return route.fallback();
  });

  await page.goto('/en/phone/contacts/');
  await page.click('#new-contact');
  await page.fill('#c-name', 'Duplicate');
  await page.fill('#numbers [data-field="e164"]', '+8613800138000');
  await page.click('#save');

  await expect(page.locator('#form-error')).toBeVisible();
  await expect(page.locator('#form-error')).toHaveText(/already holds that number/i);
});

test('a finished call to a stranger offers to keep the number', async ({ page }) => {
  await signIn(page);
  await stubApi(page);
  await page.route('**/voip/calls/c-9', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'c-9',
        session_id: 's-9',
        status: 'completed',
        failure_reason: null,
        direction: 'outbound',
        recipient_e164: '+34911234567',
        recipient_country: 'ES',
        source_language: 'en',
        target_language: 'es',
        engine_id: 'standard',
        started_at: '2026-09-01T10:00:00Z',
        ended_at: '2026-09-01T10:01:35Z',
        duration_seconds: 95,
        credits_consumed: 120,
        quoted_price_per_min: '0.0468',
        cost_status: 'final',
        recording_status: 'none',
        transcription_status: 'none',
        consent_status: 'granted',
        project_id: null,
        contact_id: null,
        contact_name: null,
      }),
    }),
  );

  await page.goto('/en/phone/detail/?id=c-9');
  await expect(page.locator('#save-contact')).toBeVisible();
  await page.fill('#save-name', 'Someone New');
  await page.click('#save-form button[type="submit"]');
  await expect(page.locator('#save-done')).toBeVisible();
});

test('a call to somebody already known offers nothing, and names them', async ({ page }) => {
  await signIn(page);
  await stubApi(page);
  await page.route('**/voip/calls/c-8', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'c-8',
        session_id: 's-8',
        status: 'completed',
        failure_reason: null,
        direction: 'outbound',
        recipient_e164: '+8613800138000',
        recipient_country: 'CN',
        source_language: 'it',
        target_language: 'zh',
        engine_id: 'standard',
        started_at: '2026-09-01T10:00:00Z',
        ended_at: null,
        duration_seconds: 95,
        credits_consumed: 120,
        quoted_price_per_min: '0.0468',
        cost_status: 'final',
        recording_status: 'none',
        transcription_status: 'none',
        consent_status: 'granted',
        project_id: null,
        contact_id: 'k-1',
        contact_name: 'Wei Zhang',
      }),
    }),
  );

  await page.goto('/en/phone/detail/?id=c-8');
  await expect(page.locator('#contact-name')).toHaveText('Wei Zhang');
  await expect(page.locator('#save-contact')).toBeHidden();
});

// ---- numbers (spec 0115) ---------------------------------------------------

test('a search shows both prices before anything is bought', async ({ page }) => {
  // A monthly charge nobody was shown is the surprise this line exists to prevent.
  await signIn(page);
  await stubApi(page);
  await page.goto('/en/phone/numbers/');

  await page.click('#find-form button[type="submit"]');
  const offers = page.locator('#offers li');
  await expect(offers).toHaveCount(2);
  await expect(offers.first()).toContainText('$1.62');
  await expect(offers.first()).toContainText('per month');
  await expect(offers.first()).toContainText('$1.20');
  await expect(offers.first()).toContainText('one-off');

  // A number a regulator has not cleared says so rather than being quietly omitted.
  await expect(offers.nth(1)).toContainText(/paperwork required/i);
});

test('buying carries a key, and the same button cannot buy twice', async ({ page }) => {
  const keys: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/voip\/numbers$/.test(new URL(req.url()).pathname)) {
      keys.push(req.postDataJSON().purchase_key);
    }
  });

  await signIn(page);
  await stubApi(page);
  await page.goto('/en/phone/numbers/');
  await page.click('#find-form button[type="submit"]');

  const buy = page.locator('#offers li').first().getByRole('button', { name: 'Buy' });
  await buy.click();
  await expect(page.locator('#bought')).toBeVisible();

  expect(keys).toHaveLength(1);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
});

test('a provider that cannot sell numbers says so, in the reader language', async ({ page }) => {
  await signIn(page);
  await stubApi(page);
  await page.route('**/voip/numbers/search**', (route) =>
    route.fulfill({
      status: 501,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'numbers_unsupported' }),
    }),
  );

  await page.goto('/en/phone/numbers/');
  await page.click('#find-form button[type="submit"]');
  await expect(page.locator('#numbers-error')).toBeVisible();
  await expect(page.locator('#numbers-error')).toHaveText(/cannot buy numbers/i);
});

test('releasing asks first, because there is no getting it back', async ({ page }) => {
  await signIn(page);
  await stubApi(page);

  // Refuse the confirmation: nothing must be released.
  await page.addInitScript(() => {
    window.confirm = () => false;
  });
  let released = 0;
  page.on('request', (req) => {
    if (req.method() === 'DELETE' && req.url().includes('/voip/numbers/')) released += 1;
  });

  await page.goto('/en/phone/numbers/');
  await page.locator('#owned li').first().getByRole('button', { name: 'Release' }).click();
  await page.waitForTimeout(200);
  expect(released).toBe(0);
});

// ---- inbound routing (spec 0116) -------------------------------------------

test('routing opens showing what will actually happen, not a blank form', async ({ page }) => {
  // An unconfigured number returns the DEFAULTS rather than a 404, so an admin can see
  // that it already rings the owners and takes a message.
  await signIn(page);
  await stubApi(page);
  await page.goto('/en/phone/numbers/');

  await page
    .locator('#owned li')
    .first()
    .getByRole('button', { name: /When somebody calls/ })
    .click();
  await expect(page.locator('#routing-panel')).toBeVisible();
  await expect(page.locator('#ring-mode')).toHaveValue('owners');
  await expect(page.locator('#no-answer')).toHaveValue('voicemail');
  await expect(page.locator('#ring-seconds')).toHaveValue('25');

  // Progressive disclosure: the fields a mode does not use are not shown.
  await expect(page.locator('#ring-users-box')).toBeHidden();
  await expect(page.locator('#forward-box')).toBeHidden();
});

test('choosing a forward reveals where it forwards to', async ({ page }) => {
  // A forward with nowhere to forward to is a call that dies silently at the moment it
  // matters most. The server refuses it; the form asks for it.
  await signIn(page);
  await stubApi(page);
  await page.goto('/en/phone/numbers/');
  await page
    .locator('#owned li')
    .first()
    .getByRole('button', { name: /When somebody calls/ })
    .click();

  await page.selectOption('#no-answer', 'forward');
  await expect(page.locator('#forward-box')).toBeVisible();

  await page.selectOption('#ring-mode', 'team');
  await expect(page.locator('#ring-team-box')).toBeVisible();
  await expect(page.locator('#ring-users-box')).toBeHidden();
});

test('saving routing sends what was chosen', async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  page.on('request', (req) => {
    if (req.method() === 'PUT' && req.url().includes('/routing')) saved.push(req.postDataJSON());
  });

  await signIn(page);
  await stubApi(page);
  await page.goto('/en/phone/numbers/');
  await page
    .locator('#owned li')
    .first()
    .getByRole('button', { name: /When somebody calls/ })
    .click();

  await page.selectOption('#ring-mode', 'users');
  await page.locator('#ring-users input').first().check();
  await page.fill('#ring-seconds', '40');
  await page.click('#routing-form button[type="submit"]');

  await expect(page.locator('#routing-saved')).toBeVisible();
  expect(saved).toHaveLength(1);
  expect(saved[0].ring_mode).toBe('users');
  expect(saved[0].ring_user_ids).toEqual(['u-1']);
  expect(saved[0].ring_seconds).toBe(40);
});

// ---- telephony analytics (spec 0117) ---------------------------------------

test('the analytics page answers what the telephone did and cost', async ({ page }) => {
  await signIn(page);
  await stubApi(page);
  await page.goto('/en/phone/analytics/');

  await expect(page.locator('#k-calls')).toHaveText('12');
  await expect(page.locator('#k-in')).toHaveText('5');
  await expect(page.locator('#k-out')).toHaveText('7');
  await expect(page.locator('#k-missed')).toHaveText('2');
  // Seconds on the wire, minutes on the screen.
  await expect(page.locator('#k-minutes')).toHaveText('30');
  // From the LEDGER — what was paid, including numbers — not the sum of the call meters.
  await expect(page.locator('#k-spent')).toHaveText('$8.20');

  await expect(page.locator('#by-country')).toContainText('CN');
  await expect(page.locator('#by-language')).toContainText('it → zh');

  // Spec 0112 R6 applies to every surface, not only to the call record.
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/gross margin/i);
  expect(body).not.toMatch(/provider cost/i);
});
