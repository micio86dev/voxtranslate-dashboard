import { expect, test, type Page } from '@playwright/test';

/**
 * Self-service number-order regulatory requirements panel (spec 0119).
 *
 * A separate spec from `phone.spec.ts` on purpose: this panel has its own multi-step
 * flow (fill -> upload -> submit -> review -> resolve) with its own API surface, and
 * keeping it apart avoids growing the already-large dialer spec further. The API is
 * stubbed at the network boundary with `page.route`, exactly as `phone.spec.ts` does.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const ORGS_ROUTE = '**/api/business/organizations**';
const ANY_API_ROUTE = '**/api/**';

async function signIn(page: Page) {
  await page.addInitScript(
    ([org]) => {
      localStorage.setItem('voxb.token', 'e2e-token');
      localStorage.setItem(
        'voxb.user',
        JSON.stringify({ id: 'u-1', email: 'admin@example.test', name: 'Admin' }),
      );
      localStorage.setItem('voxb.org', org);
    },
    [ORG],
  );
}

interface RequirementsFixture {
  status: string;
  status_reason: string | null;
  reused?: boolean;
}

const TEXTUAL_REQUIREMENT = {
  id: 'req-name',
  name: 'Business name',
  description: 'The legal name of your organisation',
  example: 'Acme Inc',
  kind: 'textual',
};

const ADDRESS_REQUIREMENT = {
  id: 'req-address',
  name: 'Registered address',
  description: 'Your registered business address',
  example: '',
  kind: 'address',
};

const DOCUMENT_REQUIREMENT = {
  id: 'req-doc',
  name: 'Proof of address',
  description: 'A recent utility bill or bank statement',
  example: '',
  kind: 'document',
};

/** One number, its requirements view, and every route the panel needs, wired the same
 *  way `phone.spec.ts`'s `stubApi` wires the rest of the phone section. */
async function stubApi(
  page: Page,
  opts: {
    numberStatus?: string;
    requirements?: RequirementsFixture;
    submitFailure?: { status: number; error: string };
  } = {},
) {
  const { numberStatus = 'pending_regulatory', requirements, submitFailure } = opts;

  let view = {
    status: requirements?.status ?? numberStatus,
    status_reason: requirements?.status_reason ?? null,
    group: { status: 'pending', reused: requirements?.reused ?? false },
    requirements: [
      { ...TEXTUAL_REQUIREMENT },
      { ...ADDRESS_REQUIREMENT },
      { ...DOCUMENT_REQUIREMENT },
    ],
  };

  await page.route(ANY_API_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  await page.route(ORGS_ROUTE, async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/voip/settings')) {
      return json({
        enabled: true,
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

    if (url.includes('/requirements/documents')) {
      const doc = view.requirements.find((r) => r.kind === 'document')!;
      (doc as { document?: { av_scan_status: string } }).document = { av_scan_status: 'pending' };
      return json({ requirement_id: doc.id, document: { av_scan_status: 'pending' } }, 201);
    }
    if (url.includes('/requirements/submit')) {
      if (submitFailure) return json({ error: submitFailure.error }, submitFailure.status);
      view = { ...view, status: 'regulatory_review', status_reason: null };
      return json({ status: 'regulatory_review' }, 202);
    }
    if (url.includes('/requirements/refresh')) {
      return json({ status: view.status, status_reason: view.status_reason });
    }
    if (url.match(/\/requirements$/) && method === 'PUT') {
      const body = route.request().postDataJSON() as {
        values: { requirement_id: string; value: unknown }[];
      };
      view = {
        ...view,
        requirements: view.requirements.map((r) => {
          const v = body.values.find((x) => x.requirement_id === r.id);
          return v ? { ...r, value: v.value } : r;
        }),
      };
      return json(view);
    }
    if (url.match(/\/requirements$/)) {
      return json(view);
    }

    if (url.match(/\/voip\/numbers\/[^/]+$/) === null && url.includes('/voip/numbers')) {
      return json({
        numbers: [
          {
            id: 'n-1',
            e164: '+390212345678',
            country: 'IT',
            label: 'Milan Office',
            is_default: true,
            inbound_enabled: false,
            outbound_enabled: false,
            verification_status: 'verified',
            status: numberStatus,
          },
        ],
      });
    }

    if (url.includes('/members')) {
      return json([{ user_id: 'u-1', name: 'Admin', email: 'admin@example.test', role: 'owner' }]);
    }
    if (url.includes('/teams')) {
      return json([]);
    }

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

  // Registered after the catch-all, so it wins: Playwright matches routes in reverse
  // registration order. The numbers page always loads the shared language catalogue
  // (for the routing panel's "stranger language" select) — without a real shape here,
  // the page throws on an unconditional `.map()` before it ever gets to the owned list.
  await page.route('**/api/languages**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        regions: ['Europe'],
        languages: [
          {
            code: 'en',
            native: 'English',
            english: 'English',
            region: 'Europe',
            rtl: false,
            flag: 'GB',
          },
        ],
      }),
    }),
  );
}

async function openPanel(page: Page) {
  await page.goto('/en/phone/numbers/');
  await page
    .locator('#owned li')
    .first()
    .getByRole('button', { name: /requirements/i })
    .click();
  await expect(page.locator('#requirements-panel')).toBeVisible();
}

test('a number needing paperwork shows a CTA that opens the requirements panel', async ({
  page,
}) => {
  await signIn(page);
  await stubApi(page, { numberStatus: 'pending_regulatory' });
  await page.goto('/en/phone/numbers/');

  const cta = page
    .locator('#owned li')
    .first()
    .getByRole('button', { name: /requirements/i });
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page.locator('#requirements-panel')).toBeVisible();
  await expect(page.locator('#requirements-list [data-requirement]')).toHaveCount(3);
});

test('filling text and address, uploading a document, then submitting moves the order into review', async ({
  page,
}) => {
  // Regression coverage for R3-upload-wipes-unsaved-input: the upload's own refetch used
  // to rebuild every field from the server's (still-unsaved) view, silently discarding
  // the name/address typed before the upload — so `submit` would PUT them as empty. This
  // asserts the PUT body it actually sends still carries what was typed, not blanks.
  const putBodies: Record<string, unknown>[] = [];
  await signIn(page);
  await stubApi(page, { numberStatus: 'pending_regulatory' });
  page.on('request', (req) => {
    if (req.method() === 'PUT' && /\/requirements$/.test(new URL(req.url()).pathname)) {
      putBodies.push(req.postDataJSON());
    }
  });
  await openPanel(page);

  await page.fill('[data-requirement-id="req-name"] [data-field="value"]', 'Acme Inc');
  const addr = page.locator('[data-requirement-id="req-address"]');
  await addr.locator('[data-field="first_name"]').fill('Ada');
  await addr.locator('[data-field="last_name"]').fill('Lovelace');
  await addr.locator('[data-field="business_name"]').fill('Acme Inc');
  await addr.locator('[data-field="street_address"]').fill('1 Main St');
  await addr.locator('[data-field="locality"]').fill('Rome');
  await addr.locator('[data-field="postal_code"]').fill('00100');
  await addr.locator('[data-field="country_code"]').fill('IT');

  await page.locator('[data-requirement-id="req-doc"] [data-field="file"]').setInputFiles({
    name: 'proof.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });
  // Wait for the upload's own refetch to finish and repaint the field list BEFORE
  // submitting — otherwise this test could race ahead of the very re-render it exists to
  // check survives correctly.
  await expect(
    page.locator('[data-requirement-id="req-doc"] [data-field-status]'),
  ).not.toHaveText('');

  await page.click('#requirements-submit');
  await expect(page.locator('#requirements-review-banner')).toBeVisible();

  expect(putBodies).toHaveLength(1);
  const values = putBodies[0].values as { requirement_id: string; value: unknown }[];
  expect(values.find((v) => v.requirement_id === 'req-name')?.value).toBe('Acme Inc');
  expect(values.find((v) => v.requirement_id === 'req-address')?.value).toMatchObject({
    first_name: 'Ada',
    last_name: 'Lovelace',
    business_name: 'Acme Inc',
    street_address: '1 Main St',
    locality: 'Rome',
    postal_code: '00100',
    country_code: 'IT',
  });
});

test('a rejected order explains the reason and offers to fix and resubmit', async ({ page }) => {
  await signIn(page);
  await stubApi(page, {
    numberStatus: 'regulatory_rejected',
    requirements: {
      status: 'regulatory_rejected',
      status_reason: 'The uploaded ID document is illegible.',
    },
  });
  await openPanel(page);

  await expect(page.locator('#requirements-rejected')).toBeVisible();
  await expect(page.locator('#requirements-reject-reason')).toHaveText(
    'The uploaded ID document is illegible.',
  );
  // The form is still editable — a rejection is fixable, not final.
  await expect(page.locator('#requirements-form')).toBeVisible();
  await expect(page.locator('#requirements-submit')).toBeEnabled();
});

test('reused approved documents are announced, not silently applied', async ({ page }) => {
  await signIn(page);
  await stubApi(page, {
    numberStatus: 'pending_regulatory',
    requirements: { status: 'pending_regulatory', status_reason: null, reused: true },
  });
  await openPanel(page);

  await expect(page.locator('#requirements-reused')).toBeVisible();
});

test('an oversize file is refused before any upload request reaches the server', async ({
  page,
}) => {
  let uploadCalls = 0;
  await signIn(page);
  await stubApi(page, { numberStatus: 'pending_regulatory' });
  page.on('request', (req) => {
    if (req.url().includes('/requirements/documents')) uploadCalls += 1;
  });
  await openPanel(page);

  const big = Buffer.alloc(11 * 1024 * 1024, 1);
  await page
    .locator('[data-requirement-id="req-doc"] [data-field="file"]')
    .setInputFiles({ name: 'proof.pdf', mimeType: 'application/pdf', buffer: big });

  await expect(page.locator('#requirements-error')).toBeVisible();
  await expect(page.locator('#requirements-error')).toHaveText(/large/i);
  expect(uploadCalls).toBe(0);
});

test('a wrong file type is refused client-side, by name, before any upload request', async ({
  page,
}) => {
  let uploadCalls = 0;
  await signIn(page);
  await stubApi(page, { numberStatus: 'pending_regulatory' });
  page.on('request', (req) => {
    if (req.url().includes('/requirements/documents')) uploadCalls += 1;
  });
  await openPanel(page);

  await page
    .locator('[data-requirement-id="req-doc"] [data-field="file"]')
    .setInputFiles({ name: 'archive.zip', mimeType: 'application/zip', buffer: Buffer.from('PK') });

  await expect(page.locator('#requirements-error')).toBeVisible();
  expect(uploadCalls).toBe(0);
});

test('a server refusal on submit is shown by name, not as a silent failure', async ({ page }) => {
  await signIn(page);
  await stubApi(page, {
    numberStatus: 'pending_regulatory',
    submitFailure: { status: 409, error: 'requirements_incomplete' },
  });
  await openPanel(page);

  await page.click('#requirements-submit');
  await expect(page.locator('#requirements-error')).toBeVisible();
  // Never enters review off a refused submission.
  await expect(page.locator('#requirements-review-banner')).toBeHidden();
});

test('manually refreshing while in review re-asks the server for the current status', async ({
  page,
}) => {
  let refreshCalls = 0;
  await signIn(page);
  await stubApi(page, {
    numberStatus: 'regulatory_review',
    requirements: { status: 'regulatory_review', status_reason: null },
  });
  await page.route('**/requirements/refresh', (route) => {
    refreshCalls += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'regulatory_review', status_reason: null }),
    });
  });
  await openPanel(page);

  await expect(page.locator('#requirements-review-banner')).toBeVisible();
  await page.click('#requirements-refresh');
  await expect.poll(() => refreshCalls).toBeGreaterThan(0);
});
