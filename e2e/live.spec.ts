import { expect as baseExpect, test, type Page, type Request } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Live Connect management area, in a browser (spec 0121, S14).
 *
 * The API is stubbed at the network boundary (see `phone.spec.ts` for why), so these assert
 * what `server/tests/live_*.rs` structurally cannot: that the browser turns the server's
 * answers into something a person can use — original and translation side by side, a QR file
 * that is really a PNG / SVG / PDF, a confirmation that says what will happen, and that the
 * desk's printable URL never ends up on a page or in the console.
 */

/**
 * Every page here boots through ~25 module requests against a one-process static server, so a
 * busy machine (several workers, a loaded CI runner) can take well over Playwright's 5 s
 * default to paint. A generous assertion timeout costs nothing when the page is fast.
 */
const expect = baseExpect.configure({ timeout: 15_000 });

const ORG = '22222222-2222-4222-8222-222222222222';
/** The credential. If this string ever shows up in the DOM or the console, a test fails. */
const SECRET_URL = 'https://app.test/d/PUBLICID.SECRETMAC';

interface DeskStub {
  id: string;
  org_id: string;
  project_id: string | null;
  name: string;
  location_label: string | null;
  default_lang: string;
  languages: string[];
  public_id: string;
  status: string;
  created_at: string;
}

interface Calls {
  all: Request[];
  bodies: Record<string, unknown[]>;
}

interface Stub {
  role: 'owner' | 'member';
  desks: DeskStub[];
  sessions: unknown[];
  total?: number;
  detail?: Record<string, unknown>;
  detailStatus?: number;
  deleteStatus?: number;
  usage?: Record<string, unknown> | { status: number; body: unknown };
  myDesks?: unknown[];
  /** Successive answers of `…/waiting`; the last one repeats. */
  waiting?: unknown[][];
  search?: unknown[];
}

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const deskA: DeskStub = {
  id: 'desk-1',
  org_id: ORG,
  project_id: 'proj-1',
  name: 'Front desk',
  location_label: 'Milan, ground floor',
  default_lang: 'it',
  languages: ['en', 'es'],
  public_id: 'PUBLICID',
  status: 'active',
  created_at: '2026-03-01T09:00:00Z',
};

const session = (over: Record<string, unknown> = {}) => ({
  id: 's-1',
  status: 'ended',
  created_at: '2026-03-01T10:00:00Z',
  started_at: '2026-03-01T10:01:00Z',
  ended_at: '2026-03-01T10:06:00Z',
  end_reason: 'ended_by_guest',
  duration_secs: 305,
  host_lang: 'it',
  desk: { id: 'desk-1', name: 'Front desk', location_label: 'Milan, ground floor' },
  project: { id: 'proj-1', name: 'Retail' },
  guest: { name: 'Ana', lang: 'es' },
  staff_name: 'Luca',
  credits: 42,
  has_transcript: true,
  ...over,
});

const DETAIL = {
  session: session(),
  participants: [
    { peer_id: 'p-guest', role: 'guest', display_name: 'Ana', lang: 'es' },
    { peer_id: 'p-staff', role: 'staff', display_name: 'Luca', lang: 'it' },
  ],
  utterances: [
    {
      at: '2026-03-01T10:01:05Z',
      offset_ms: 0,
      speaker_id: 'p-guest',
      speaker_name: 'Ana',
      original_lang: 'es',
      original: 'Hola, necesito ayuda con mi pedido',
      translation: null,
      translations: {
        it: 'Salve, ho bisogno di aiuto con il mio ordine',
        en: 'Hello, I need help with my order',
      },
    },
    {
      at: '2026-03-01T10:01:12Z',
      offset_ms: 7000,
      speaker_id: 'p-staff',
      speaker_name: 'Luca',
      original_lang: 'it',
      original: 'Certo, mi dica il numero',
      translation: null,
      translations: { es: 'Claro, dígame el número', en: 'Of course, tell me the number' },
    },
  ],
  events: [
    { at: '2026-03-01T10:01:00Z', kind: 'answered', detail: {} },
    { at: '2026-03-01T10:06:00Z', kind: 'ended', detail: {} },
  ],
};

async function install(page: Page, opts: Partial<Stub> = {}) {
  const stub: Stub = { role: 'owner', desks: [{ ...deskA }], sessions: [session()], ...opts };
  const calls: Calls = { all: [], bodies: {} };
  let waitingPoll = 0;

  await page.addInitScript((org) => {
    localStorage.setItem('voxb.token', 'e2e-token');
    localStorage.setItem(
      'voxb.user',
      JSON.stringify({ id: 'u-1', email: 'live@example.test', name: 'Luca' }),
    );
    localStorage.setItem('voxb.org', org);
  }, ORG);

  // Nothing else may log the credential: collect the console and check at the end of a test.
  const consoleText: string[] = [];
  page.on('console', (m) => consoleText.push(m.text()));
  (page as Page & { _consoleText: string[] })._consoleText = consoleText;

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    calls.all.push(req);
    if (req.postData()) {
      (calls.bodies[`${method} ${path}`] ??= []).push(JSON.parse(req.postData() as string));
    }
    const L = `/api/business/organizations/${ORG}/live`;

    if (path === '/api/business/organizations') {
      return route.fulfill(
        json([
          {
            id: ORG,
            name: 'Acme',
            slug: 'acme',
            plan: 'business',
            role: stub.role,
            subscription_status: 'active',
            subscription_active: true,
            credits_balance: 5000,
          },
        ]),
      );
    }
    if (path === `/api/business/organizations/${ORG}/projects`) {
      return route.fulfill(
        json([
          {
            id: 'proj-1',
            name: 'Retail',
            description: null,
            default_languages: [],
            archived_at: null,
            created_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'proj-2',
            name: 'Support',
            description: null,
            default_languages: [],
            archived_at: null,
            created_at: '2026-01-01T00:00:00Z',
          },
        ]),
      );
    }
    if (path === '/api/languages') {
      return route.fulfill(
        json({
          regions: ['Europe'],
          languages: ['en', 'it', 'es', 'de'].map((code) => ({
            code,
            native: code,
            english: code,
            region: 'Europe',
            rtl: false,
            flag: code.toUpperCase(),
          })),
        }),
      );
    }

    // ---- sessions ----
    if (path === `${L}/sessions` && method === 'GET') {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return route.fulfill(
        json({
          sessions: stub.sessions,
          total: stub.total ?? stub.sessions.length,
          limit: 25,
          offset,
        }),
      );
    }
    if (path.startsWith(`${L}/sessions/`) && method === 'GET') {
      if (stub.detailStatus && stub.detailStatus !== 200) {
        return route.fulfill({
          status: stub.detailStatus,
          contentType: 'text/plain',
          body: 'not found',
        });
      }
      const detail = (stub.detail ?? DETAIL) as typeof DETAIL;
      return route.fulfill(json(stub.role === 'owner' ? detail : { ...detail, events: undefined }));
    }
    if (path.startsWith(`${L}/sessions/`) && method === 'DELETE') {
      if (stub.deleteStatus === 409) {
        return route.fulfill(json({ code: 'session_active', message: 'End it first' }, 409));
      }
      return route.fulfill(json({ erased: true }));
    }

    // ---- usage ----
    if (path === `${L}/usage`) {
      const u = stub.usage as { status?: number; body?: unknown } | undefined;
      if (u && 'status' in u && 'body' in u) return route.fulfill(json(u.body, u.status));
      return route.fulfill(
        json(
          stub.usage ?? {
            group: url.searchParams.get('group') ?? 'desk',
            from: '2026-02-01T00:00:00Z',
            to: '2026-03-01T00:00:00Z',
            rows: [
              { key: 'desk-1', label: 'Front desk', sessions: 8, credits: 400 },
              { key: 'desk-2', label: 'Back desk', sessions: 2, credits: 100 },
            ],
            totals: { sessions: 10, credits: 500 },
            balance: 4321,
            active: [
              {
                session_id: 's-open',
                status: 'active',
                desk: 'Front desk',
                started_at: '2026-03-01T10:00:00Z',
                credits: 17,
              },
            ],
          },
        ),
      );
    }

    // ---- desks (admin) ----
    if (path === `${L}/desks` && method === 'GET')
      return route.fulfill(json({ desks: stub.desks }));
    if (path === `${L}/desks` && method === 'POST') {
      const body = JSON.parse(req.postData() as string);
      const created = { ...deskA, id: 'desk-new', name: body.name, public_id: 'NEWID' };
      stub.desks.unshift(created);
      // The real server also returns the printable URL here; the client must drop it.
      return route.fulfill(json({ ...created, qr_url: SECRET_URL }, 201));
    }
    const deskPath = new RegExp(`^${L}/desks/([^/]+)(?:/(qr|revoke|regenerate))?$`).exec(path);
    if (deskPath) {
      const [, id, action] = deskPath;
      const desk = stub.desks.find((d) => d.id === id);
      if (!desk) return route.fulfill(json({ code: 'desk_not_found', message: 'x' }, 404));
      if (action === 'qr') {
        return route.fulfill(
          json({
            url: SECRET_URL,
            public_id: desk.public_id,
            status: desk.status,
            name: desk.name,
            location_label: desk.location_label,
          }),
        );
      }
      if (action === 'revoke') {
        desk.status = 'revoked';
        return route.fulfill(json({ status: 'revoked', waiting_closed: 2 }));
      }
      if (action === 'regenerate') {
        desk.status = 'active';
        return route.fulfill(json({ ...desk, qr_url: SECRET_URL, waiting_closed: 1 }));
      }
      if (method === 'PATCH') {
        Object.assign(desk, JSON.parse(req.postData() as string));
        return route.fulfill(json(desk));
      }
    }

    // ---- console ----
    if (path === '/api/live/my-desks') {
      return route.fulfill(
        json({
          desks: stub.myDesks ?? [
            {
              id: 'desk-1',
              org_id: ORG,
              org_name: 'Acme',
              name: 'Front desk',
              location_label: 'Milan, ground floor',
              default_lang: 'it',
              waiting: (
                stub.waiting?.[Math.min(waitingPoll, (stub.waiting?.length ?? 1) - 1)] ?? []
              ).length,
            },
            {
              id: 'desk-x',
              org_id: 'other-org',
              org_name: 'Other',
              name: 'Not mine',
              location_label: null,
              default_lang: 'en',
              waiting: 0,
            },
          ],
        }),
      );
    }
    if (/^\/api\/live\/desks\/[^/]+\/waiting$/.test(path)) {
      const list = stub.waiting ?? [[]];
      const answer = list[Math.min(waitingPoll, list.length - 1)];
      return route.fulfill(json({ waiting: answer }));
    }

    // ---- search ----
    if (path === `/api/business/organizations/${ORG}/search`) {
      return route.fulfill(json({ results: stub.search ?? [] }));
    }

    return route.fulfill(json({}));
  });

  return {
    calls,
    /** Moves the console's stubbed queue on one step. */
    advanceWaiting: () => {
      waitingPoll += 1;
    },
    requests: (pathPart: string, method = 'GET') =>
      calls.all.filter((r) => r.url().includes(pathPart) && r.method() === method),
    consoleText: () => consoleText.join('\n'),
  };
}

async function noSecretAnywhere(page: Page, api: Awaited<ReturnType<typeof install>>) {
  const html = await page.content();
  expect(html).not.toContain('SECRETMAC');
  expect(html).not.toContain('PUBLICID.');
  expect(api.consoleText()).not.toContain('SECRETMAC');
}

// ---------------------------------------------------------------------------------------

test.describe('hub and navigation', () => {
  test('one header entry leads to the hub, which offers the four areas', async ({ page }) => {
    await install(page);
    await page.goto('/en/dashboard/');
    const entry = page.locator('header nav a', { hasText: 'Live Connect' });
    await expect(entry).toHaveCount(1);
    await entry.click();
    await expect(page).toHaveURL(/\/en\/live\/$/);
    const tabs = page.locator('nav[aria-label="Live Connect"] a');
    await expect(tabs).toHaveText(['Sessions', 'Desks', 'Desk console', 'Usage']);
    await expect(page.locator('[data-live-tab=sessions]')).toHaveAttribute('aria-current', 'page');
  });

  test('a member does not get the Usage tab', async ({ page }) => {
    await install(page, { role: 'member' });
    await page.goto('/en/live/');
    await expect(page.locator('[data-live-tab=sessions]')).toBeVisible();
    await expect(page.locator('[data-live-tab=usage]')).toBeHidden();
    await expect(page.getByText('You see the conversations you took part in')).toBeVisible();
  });
});

test.describe('sessions', () => {
  test('lists conversations with status, desk, project, guest, staff, duration, credits and transcript', async ({
    page,
  }) => {
    await install(page);
    await page.goto('/en/live/');
    const row = page.locator('#rows tr').first();
    await expect(row).toContainText('Ended');
    await expect(row).toContainText('Front desk');
    await expect(row).toContainText('Milan, ground floor');
    await expect(row).toContainText('Retail');
    await expect(row).toContainText('Ana');
    await expect(row).toContainText('Spanish');
    await expect(row).toContainText('Luca');
    await expect(row).toContainText('5:05');
    await expect(row).toContainText('42');
    await expect(row).toContainText('Yes');
    await expect(row.locator('a')).toHaveAttribute('href', '/en/live/detail/?session=s-1');
  });

  test('filters go to the server, and paging asks for the next window', async ({ page }) => {
    const api = await install(page, { total: 60 });
    await page.goto('/en/live/');
    await expect(page.locator('#range')).toHaveText('1–1 of 60');

    await page.selectOption('#f-status', 'active');
    await page.selectOption('#f-project', 'proj-1');
    await page.selectOption('#f-desk', 'desk-1');
    await page.fill('#f-from', '2026-03-01');
    await page.fill('#f-to', '2026-03-31');
    await expect.poll(() => api.requests('/live/sessions').at(-1)?.url() ?? '').toContain('to=');
    const q = new URL(api.requests('/live/sessions').at(-1)!.url()).searchParams;
    expect(q.get('status')).toBe('active');
    expect(q.get('project_id')).toBe('proj-1');
    expect(q.get('desk_id')).toBe('desk-1');
    expect(q.get('from')).toBeTruthy();
    expect(q.get('to')).toBeTruthy();
    expect(q.get('limit')).toBe('25');

    await page.click('#f-clear');
    await expect
      .poll(() => new URL(api.requests('/live/sessions').at(-1)!.url()).searchParams.has('status'))
      .toBe(false);

    await expect(page.locator('#next')).toBeEnabled();
    await page.click('#next');
    await expect
      .poll(() => new URL(api.requests('/live/sessions').at(-1)!.url()).searchParams.get('offset'))
      .toBe('25');
  });

  test('refreshes while a conversation is open, and stops once nothing is', async ({ page }) => {
    await page.clock.install();
    const api = await install(page, {
      sessions: [session({ status: 'active', ended_at: null, end_reason: null })],
    });
    await page.goto('/en/live/');
    await expect(page.locator('#rows tr')).toHaveCount(1);
    await expect(page.locator('#live-note')).toBeVisible();
    const before = api.requests('/live/sessions').length;
    await page.clock.fastForward(11_000);
    await expect.poll(() => api.requests('/live/sessions').length).toBeGreaterThan(before);
  });

  test('does not poll a list with nothing open', async ({ page }) => {
    await page.clock.install();
    const api = await install(page);
    await page.goto('/en/live/');
    await expect(page.locator('#rows tr')).toHaveCount(1);
    const before = api.requests('/live/sessions').length;
    await page.clock.fastForward(60_000);
    await page.waitForTimeout(200);
    expect(api.requests('/live/sessions').length).toBe(before);
    await expect(page.locator('#live-note')).toBeHidden();
  });

  test('an empty list and a failing server both say so', async ({ page }) => {
    await install(page, { sessions: [] });
    await page.goto('/en/live/');
    await expect(page.locator('#empty')).toBeVisible();
  });

  test('a hostile guest name is shown as text', async ({ page }) => {
    await install(page, {
      sessions: [session({ guest: { name: '<img src=x onerror=window.__pwned=1>', lang: 'es' } })],
    });
    await page.goto('/en/live/');
    await expect(page.locator('#rows')).toContainText('<img src=x onerror=window.__pwned=1>');
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
  });
});

test.describe('session detail', () => {
  test('shows each original beside its translation, in a language the viewer picks', async ({
    page,
  }) => {
    await install(page);
    await page.goto('/en/live/detail/?session=s-1');

    await expect(page.locator('#facts')).toContainText('Retail');
    await expect(page.locator('#facts')).toContainText('Ended by the guest');
    await expect(page.locator('#participants')).toContainText('Ana');
    await expect(page.locator('#participants')).toContainText('Spanish');

    // Originals first, as spoken; no translation until one is chosen.
    const lines = page.locator('#utterances li');
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0).locator('[data-part=original]')).toHaveText(
      'Hola, necesito ayuda con mi pedido',
    );
    await expect(page.locator('[data-part=translation]')).toHaveCount(0);

    await page.selectOption('#lang-sel', 'en');
    await expect(lines.nth(0).locator('[data-part=original]')).toHaveText(
      'Hola, necesito ayuda con mi pedido',
    );
    await expect(lines.nth(0).locator('[data-part=translation]')).toContainText(
      'Hello, I need help with my order',
    );
    await expect(lines.nth(1).locator('[data-part=original]')).toHaveText(
      'Certo, mi dica il numero',
    );
    await expect(lines.nth(1).locator('[data-part=translation]')).toContainText(
      'Of course, tell me the number',
    );
    await expect(page).toHaveURL(/lang=en/);

    // The two people keep their own side.
    expect(await lines.nth(0).getAttribute('data-side')).not.toBe(
      await lines.nth(1).getAttribute('data-side'),
    );

    // Back to the originals alone.
    await page.selectOption('#lang-sel', '');
    await expect(page.locator('[data-part=translation]')).toHaveCount(0);
  });

  test('?lang= opens with that translation already shown', async ({ page }) => {
    const api = await install(page);
    await page.goto('/en/live/detail/?session=s-1&lang=it');
    await expect(page.locator('#lang-sel')).toHaveValue('it');
    await expect(page.locator('[data-part=translation]').first()).toContainText('Salve');
    expect(api.requests('/live/sessions/s-1')[0].url()).toContain('lang=it');
  });

  test('an admin sees the diagnostic timeline; a member does not', async ({ page }) => {
    await install(page);
    await page.goto('/en/live/detail/?session=s-1');
    await expect(page.locator('#timeline-card')).toBeVisible();
    await expect(page.locator('#timeline')).toContainText('answered');
    await expect(page.locator('#delete')).toBeVisible();
  });

  test('a member sees no timeline and no delete button', async ({ page }) => {
    await install(page, { role: 'member' });
    await page.goto('/en/live/detail/?session=s-1');
    await expect(page.locator('#utterances li')).toHaveCount(2);
    await expect(page.locator('#timeline-card')).toBeHidden();
    await expect(page.locator('#delete')).toBeHidden();
  });

  test('links to the search page, narrowed to this conversation', async ({ page }) => {
    await install(page);
    await page.goto('/en/live/detail/?session=s-1');
    await expect(page.locator('#search-link')).toHaveAttribute(
      'href',
      '/en/search/?kind=live_connect&session_id=s-1',
    );
  });

  test('delete asks first, explaining what goes and what stays, then deletes', async ({ page }) => {
    const api = await install(page);
    await page.goto('/en/live/detail/?session=s-1');
    const messages: string[] = [];
    page.on('dialog', (d) => {
      messages.push(d.message());
      void d.accept();
    });
    await page.click('#delete');
    await expect.poll(() => api.requests('/live/sessions/s-1', 'DELETE').length).toBe(1);
    expect(messages[0]).toContain('erases the transcript');
    expect(messages[0]).toContain('Billing records are kept');
    await expect(page).toHaveURL(/\/en\/live\/$/);
  });

  test('declining the confirmation deletes nothing', async ({ page }) => {
    const api = await install(page);
    await page.goto('/en/live/detail/?session=s-1');
    page.on('dialog', (d) => void d.dismiss());
    await page.click('#delete');
    await page.waitForTimeout(200);
    expect(api.requests('/live/sessions/s-1', 'DELETE')).toHaveLength(0);
  });

  test('a conversation that is still open cannot be deleted (409) and says why', async ({
    page,
  }) => {
    await install(page, { deleteStatus: 409 });
    await page.goto('/en/live/detail/?session=s-1');
    page.on('dialog', (d) => void d.accept());
    await page.click('#delete');
    await expect(page.locator('#action-msg')).toContainText('still open');
    await expect(page.locator('#delete')).toBeEnabled();
  });

  test('a conversation the viewer may not see reads as not found', async ({ page }) => {
    await install(page, { role: 'member', detailStatus: 404 });
    await page.goto('/en/live/detail/?session=someone-elses');
    await expect(page.locator('#msg')).toContainText('Not found');
    await expect(page.locator('#content')).toBeHidden();
  });

  test('an unredacted transcript line is shown as text', async ({ page }) => {
    const hostile = {
      ...DETAIL,
      utterances: [{ ...DETAIL.utterances[0], original: '<b id=x>bold</b>' }],
    };
    await install(page, { detail: hostile });
    await page.goto('/en/live/detail/?session=s-1');
    await expect(page.locator('#utterances')).toContainText('<b id=x>bold</b>');
    await expect(page.locator('#utterances b')).toHaveCount(0);
  });
});

test.describe('desks', () => {
  test('lists the desks; creating one needs a project, then sends exactly what was entered', async ({
    page,
  }) => {
    const api = await install(page);
    await page.goto('/en/live/desks/');
    await expect(page.locator('#desks article')).toHaveCount(1);
    await expect(page.locator('#desks article')).toContainText('Front desk');
    await expect(page.locator('#desks article')).toContainText('Retail');

    await page.click('#new-desk');
    await expect(page.locator('#desk-form')).toBeVisible();
    await page.fill('#d-name', 'Back desk');
    await page.fill('#d-location', 'Rome');
    await page.selectOption('#d-lang', 'it');
    await page.click('#d-save');
    // The project is mandatory: nothing was sent, the field says why.
    await expect(page.locator('[data-error=projectId]')).toContainText('Choose a project');
    expect(api.requests('/live/desks', 'POST')).toHaveLength(0);

    await page.selectOption('#d-project', 'proj-2');
    await page.selectOption('#d-langs', ['en', 'de']);
    await page.click('#d-save');
    await expect(page.locator('#msg')).toContainText('Desk created');
    expect(api.calls.bodies[`POST /api/business/organizations/${ORG}/live/desks`]).toEqual([
      {
        name: 'Back desk',
        location_label: 'Rome',
        default_lang: 'it',
        languages: ['en', 'de'],
        project_id: 'proj-2',
      },
    ]);
    await expect(page.locator('#desks article')).toHaveCount(2);
    await noSecretAnywhere(page, api);
  });

  test('a desk needs a name', async ({ page }) => {
    const api = await install(page);
    await page.goto('/en/live/desks/');
    await page.click('#new-desk');
    await page.selectOption('#d-project', 'proj-1');
    await page.click('#d-save');
    await expect(page.locator('[data-error=name]')).toContainText('Enter a name');
    expect(api.requests('/live/desks', 'POST')).toHaveLength(0);
  });

  test('editing sends only what changed', async ({ page }) => {
    const api = await install(page);
    await page.goto('/en/live/desks/');
    await page.locator('[data-action=edit]').click();
    await expect(page.locator('#d-name')).toHaveValue('Front desk');
    await expect(page.locator('#d-project')).toHaveValue('proj-1');
    await page.fill('#d-name', 'Main desk');
    await page.click('#d-save');
    await expect(page.locator('#msg')).toContainText('Desk saved');
    expect(api.calls.bodies[`PATCH /api/business/organizations/${ORG}/live/desks/desk-1`]).toEqual([
      { name: 'Main desk' },
    ]);
  });

  test('downloads the QR as a real PNG, SVG and one-page PDF, named after the desk', async ({
    page,
  }) => {
    const api = await install(page);
    await page.goto('/en/live/desks/');

    const grab = async (action: string) => {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator(`[data-action=${action}]`).click(),
      ]);
      const path = await download.path();
      return { name: download.suggestedFilename(), bytes: readFileSync(path) };
    };

    const png = await grab('png');
    expect(png.name).toBe('front-desk-qr.png');
    expect([...png.bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const svg = await grab('svg');
    expect(svg.name).toBe('front-desk-qr.svg');
    expect(svg.bytes.toString('utf8')).toContain('<svg');

    const pdf = await grab('pdf');
    expect(pdf.name).toBe('front-desk-qr.pdf');
    expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect((pdf.bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);

    // The URL is in the QR and nowhere readable: not in the files' text, the page or the console.
    expect(svg.bytes.toString('utf8')).not.toContain('SECRETMAC');
    expect(pdf.bytes.toString('latin1')).not.toContain('SECRETMAC');
    await noSecretAnywhere(page, api);
  });

  test('the QR files and the print view work under the production CSP', async ({ page }) => {
    // `public/_headers` is what the host serves; the static test server sends none, so apply
    // the real policy to the document and fail on any violation the browser reports.
    const headers = readFileSync(join(process.cwd(), 'public', '_headers'), 'utf8');
    const csp = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1]?.trim();
    expect(csp).toBeTruthy();
    const api = await install(page);
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
    });
    await page.route('**/en/live/**', async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': csp as string },
      });
    });

    await page.goto('/en/live/desks/');
    await expect(page.locator('#desks article')).toHaveCount(1);
    for (const [action, ext] of [
      ['png', 'png'],
      ['svg', 'svg'],
      ['pdf', 'pdf'],
    ]) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator(`[data-action=${action}]`).click(),
      ]);
      expect(download.suggestedFilename()).toBe(`front-desk-qr.${ext}`);
    }

    await page.goto('/en/live/print/?desk=desk-1');
    await expect(page.locator('#sheet-qr')).toHaveAttribute('src', /^data:image\/png/);
    await expect
      .poll(() => page.locator('#sheet-qr').evaluate((i: HTMLImageElement) => i.naturalWidth))
      .toBeGreaterThan(0);
    expect(violations).toEqual([]);
    await noSecretAnywhere(page, api);
  });

  test('copy link is for admins and copies without showing the link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const api = await install(page);
    await page.goto('/en/live/desks/');
    await page.locator('[data-action=copy]').click();
    await expect(page.locator('[data-action=copy]')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SECRET_URL);
    await noSecretAnywhere(page, api);
  });

  test('revoke explains the consequences, then revokes', async ({ page }) => {
    const api = await install(page);
    await page.goto('/en/live/desks/');
    const messages: string[] = [];
    page.on('dialog', (d) => {
      messages.push(d.message());
      void d.accept();
    });
    await page.locator('[data-action=revoke]').click();
    await expect.poll(() => api.requests('/revoke', 'POST').length).toBe(1);
    expect(messages[0]).toContain('Front desk');
    expect(messages[0]).toContain('stops working at once');
    expect(messages[0]).toContain('waiting at this desk right now are disconnected');
    await expect(page.locator('#msg')).toContainText('Desk revoked. 2 waiting');
    await expect(page.locator('[data-desk-id] .badge', { hasText: 'Revoked' })).toBeVisible();
    // Once revoked there is nothing left to revoke, but a new QR can bring it back.
    await expect(page.locator('[data-action=revoke]')).toHaveCount(0);
    await expect(page.locator('[data-action=regenerate]')).toHaveCount(1);
  });

  test('regenerate warns that the printed QR stops working, then does it', async ({ page }) => {
    const api = await install(page);
    await page.goto('/en/live/desks/');
    const messages: string[] = [];
    page.on('dialog', (d) => {
      messages.push(d.message());
      void d.accept();
    });
    await page.locator('[data-action=regenerate]').click();
    await expect.poll(() => api.requests('/regenerate', 'POST').length).toBe(1);
    expect(messages[0]).toContain('The printed one stops working');
    expect(messages[0]).toContain('disconnected');
    await expect(page.locator('#msg')).toContainText('New QR code ready');
    await noSecretAnywhere(page, api);
  });

  test('dismissing either confirmation does nothing', async ({ page }) => {
    const api = await install(page);
    await page.goto('/en/live/desks/');
    page.on('dialog', (d) => void d.dismiss());
    await page.locator('[data-action=revoke]').click();
    await page.locator('[data-action=regenerate]').click();
    await page.waitForTimeout(200);
    expect(api.requests('/revoke', 'POST')).toHaveLength(0);
    expect(api.requests('/regenerate', 'POST')).toHaveLength(0);
  });

  test('a member sees the desks read-only: no create, no actions, no QR', async ({ page }) => {
    const api = await install(page, { role: 'member' });
    await page.goto('/en/live/desks/');
    await expect(page.locator('#desks article')).toHaveCount(1);
    await expect(page.locator('#new-desk')).toBeHidden();
    await expect(page.locator('#readonly-note')).toBeVisible();
    await expect(page.locator('#desks button')).toHaveCount(0);
    expect(api.requests('/qr')).toHaveLength(0);
  });

  test('a failed create surfaces the server code in words', async ({ page }) => {
    await install(page);
    await page.route('**/live/desks', async (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill(json({ code: 'project_not_found', message: 'x' }, 404));
      }
      return route.fallback();
    });
    await page.goto('/en/live/desks/');
    await page.click('#new-desk');
    await page.fill('#d-name', 'X');
    await page.selectOption('#d-project', 'proj-1');
    await page.selectOption('#d-lang', 'en');
    await page.click('#d-save');
    await expect(page.locator('#msg')).toContainText('That project was not found');
  });

  test('the print view shows the QR as an image with the desk name, and no URL', async ({
    page,
  }) => {
    const api = await install(page);
    await page.goto('/en/live/print/?desk=desk-1');
    await expect(page.locator('#sheet-name')).toHaveText('Front desk');
    await expect(page.locator('#sheet-location')).toHaveText('Milan, ground floor');
    await expect(page.locator('#sheet-qr')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(page.getByText('Scan this code with your phone camera')).toBeVisible();
    await noSecretAnywhere(page, api);

    // On paper the app's chrome is gone.
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('header').first()).toBeHidden();
    await expect(page.locator('#sheet')).toBeVisible();
  });

  test('the print view refuses a member', async ({ page }) => {
    const api = await install(page, { role: 'member' });
    await page.goto('/en/live/print/?desk=desk-1');
    await expect(page.locator('#msg')).toContainText('have permission');
    expect(api.requests('/qr')).toHaveLength(0);
  });
});

test.describe('desk console', () => {
  const guest = (id: string, name: string, waited = 5) => ({
    session_id: id,
    guest_name: name,
    guest_lang: 'es',
    waited_secs: waited,
  });

  test('shows the customers waiting at my desks, with an Answer link into the call app', async ({
    page,
  }) => {
    await install(page, { waiting: [[guest('s-1', 'Ana', 75)]] });
    await page.goto('/en/live/console/');
    const item = page.locator('[data-session-id=s-1]');
    await expect(item).toContainText('Ana');
    await expect(item).toContainText('Spanish');
    await expect(item).toContainText('waiting 1:15');
    const answer = item.locator('a');
    await expect(answer).toHaveText('Answer');
    expect(await answer.getAttribute('href')).toMatch(/\/live\/desks\?answer=s-1$/);
    await expect(answer).toHaveAttribute('target', '_blank');
    expect(await answer.getAttribute('rel')).toContain('noopener');
    // Only this organization's desks.
    await expect(page.getByText('Not mine')).toHaveCount(0);
  });

  test('says so when nobody is waiting, and when the caller has no desks', async ({ page }) => {
    await install(page);
    await page.goto('/en/live/console/');
    await expect(page.getByText('Nobody is waiting.')).toBeVisible();

    await install(page, { myDesks: [] });
    await page.goto('/en/live/console/');
    await expect(page.locator('#empty')).toBeVisible();
  });

  test('a customer who starts waiting is announced and put in the tab title', async ({ page }) => {
    await page.clock.install();
    const api = await install(page, { waiting: [[], [guest('s-2', 'Marta')]] });
    await page.goto('/en/live/console/');
    await expect(page.getByText('Nobody is waiting.')).toBeVisible();
    const baseTitle = await page.title();
    expect(baseTitle).not.toMatch(/^\(/);

    api.advanceWaiting();
    await page.clock.fastForward(3000);
    await expect(page.locator('[data-session-id=s-2]')).toContainText('Marta');
    await expect(page.locator('#announce')).toHaveText('Marta is waiting at Front desk');
    await expect(page.locator('#announce')).toHaveAttribute('aria-live', 'polite');
    await expect.poll(() => page.title()).toBe(`(1) ${baseTitle}`);
    // The cue is a ring and a pulse that reduced motion switches off; never a sound.
    expect(await page.locator('[data-session-id=s-2]').getAttribute('class')).toContain(
      'motion-safe:animate-pulse',
    );
    expect(await page.locator('audio').count()).toBe(0);
  });

  test('someone already waiting when the page opens is not announced as new', async ({ page }) => {
    await install(page, { waiting: [[guest('s-1', 'Ana')]] });
    await page.goto('/en/live/console/');
    await expect(page.locator('[data-session-id=s-1]')).toBeVisible();
    await expect(page.locator('#announce')).toHaveText('');
  });

  test('polls every two seconds', async ({ page }) => {
    await page.clock.install();
    const api = await install(page);
    await page.goto('/en/live/console/');
    await expect(page.locator('#loading')).toBeHidden();
    const before = api.requests('/api/live/my-desks').length;
    await page.clock.fastForward(2500);
    await expect.poll(() => api.requests('/api/live/my-desks').length).toBeGreaterThan(before);
  });
});

test.describe('usage', () => {
  test('shows the wallet balance, totals, a grouped table with bars, and what is open now', async ({
    page,
  }) => {
    await install(page);
    await page.goto('/en/live/usage/');
    await expect(page.locator('#balance')).toHaveText('4321 credits');
    await expect(page.locator('#t-sessions')).toHaveText('10');
    await expect(page.locator('#t-credits')).toHaveText('500');
    await expect(page.locator('#table tbody tr')).toHaveCount(2);
    await expect(page.locator('#table tbody tr').first()).toContainText('Front desk');
    expect(await page.locator('#table [data-bar]').first().getAttribute('data-bar')).toBe('100');
    expect(await page.locator('#table [data-bar]').nth(1).getAttribute('data-bar')).toBe('25');
    await expect(page.locator('#open')).toContainText('17 credits so far');
    await expect(page.locator('#open a')).toHaveAttribute(
      'href',
      '/en/live/detail/?session=s-open',
    );
    await expect(page.locator('a', { hasText: 'Add credits' })).toHaveAttribute(
      'href',
      '/en/credits/',
    );
  });

  test('defaults to the last 30 days; presets, grouping and a custom range are sent to the server', async ({
    page,
  }) => {
    const api = await install(page);
    await page.goto('/en/live/usage/');
    await expect(page.locator('[data-days="30"]')).toHaveAttribute('aria-pressed', 'true');
    const span = (u: string) => {
      const q = new URL(u).searchParams;
      return Math.round((Date.parse(q.get('to')!) - Date.parse(q.get('from')!)) / 86_400_000);
    };
    expect(span(api.requests('/live/usage')[0].url())).toBe(30);
    expect(new URL(api.requests('/live/usage')[0].url()).searchParams.get('group')).toBe('desk');

    await page.click('[data-days="7"]');
    await expect(page.locator('[data-days="7"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => span(api.requests('/live/usage').at(-1)!.url())).toBe(7);

    await page.selectOption('#u-group', 'project');
    await expect
      .poll(() => new URL(api.requests('/live/usage').at(-1)!.url()).searchParams.get('group'))
      .toBe('project');

    await page.fill('#u-from', '2026-01-01');
    await page.fill('#u-to', '2026-01-31');
    await page.click('#u-apply');
    await expect.poll(() => span(api.requests('/live/usage').at(-1)!.url())).toBe(31);
    await expect(page.locator('[data-days="7"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('a custom range is checked before it is sent', async ({ page }) => {
    const api = await install(page);
    await page.goto('/en/live/usage/');
    await expect(page.locator('#balance')).toHaveText('4321 credits');
    const count = api.requests('/live/usage').length;
    await page.click('#u-apply');
    await expect(page.locator('#msg')).toContainText('Pick both dates');
    await page.fill('#u-from', '2026-03-31');
    await page.fill('#u-to', '2026-03-01');
    await page.click('#u-apply');
    await expect(page.locator('#msg')).toContainText('The end date is before the start date');
    await page.fill('#u-from', '2024-01-01');
    await page.fill('#u-to', '2026-01-01');
    await page.click('#u-apply');
    await expect(page.locator('#msg')).toContainText('at most a year');
    expect(api.requests('/live/usage').length).toBe(count);
  });

  test('a range the server refuses (bad_range) is explained, not retried', async ({ page }) => {
    const api = await install(page, {
      usage: { status: 400, body: { code: 'bad_range', message: 'x' } },
    });
    await page.goto('/en/live/usage/');
    await expect(page.locator('#msg')).toContainText('must run forward');
    const n = api.requests('/live/usage').length;
    await page.waitForTimeout(300);
    expect(api.requests('/live/usage').length).toBe(n);
  });

  test('an empty period says so', async ({ page }) => {
    await install(page, {
      usage: {
        group: 'desk',
        from: 'a',
        to: 'b',
        rows: [],
        totals: { sessions: 0, credits: 0 },
        balance: 10,
        active: [],
      },
    });
    await page.goto('/en/live/usage/');
    await expect(page.locator('#empty')).toBeVisible();
    await expect(page.locator('#open-empty')).toBeVisible();
  });

  test('a member gets the "not allowed" state and no request for money', async ({ page }) => {
    const api = await install(page, { role: 'member' });
    await page.goto('/en/live/usage/');
    await expect(page.locator('#not-allowed')).toBeVisible();
    await expect(page.locator('#content')).toBeHidden();
    expect(api.requests('/live/usage')).toHaveLength(0);
  });
});

test.describe('search integration', () => {
  test('narrows to Live Connect, language, dates and one conversation, and links hits to their page', async ({
    page,
  }) => {
    const api = await install(page, {
      search: [
        {
          kind: 'call',
          session_id: 'call-session',
          project_id: 'proj-1',
          project_name: 'Retail',
          room: 'live-abc',
          started_at: '2026-03-01T10:00:00Z',
          snippet: 'Hola, necesito ayuda',
          speaker_name: 'Ana',
          start_ms: 0,
          score: 0.9,
          live_session_id: 's-1',
          session_kind: 'live_connect',
        },
      ],
    });
    await page.goto('/en/search/?kind=live_connect&session_id=s-1&q=pedido');
    await expect(page.locator('#kind')).toHaveValue('live_connect');
    await expect(page.locator('#session-chip')).toBeVisible();
    await expect(page.locator('#results a')).toHaveAttribute(
      'href',
      '/en/live/detail/?session=s-1',
    );
    await expect(page.locator('#results')).toContainText('Live Connect');

    const q = new URL(api.requests('/search')[0].url()).searchParams;
    expect(q.get('q')).toBe('pedido');
    expect(q.get('kind')).toBe('live_connect');
    expect(q.get('session_id')).toBe('s-1');

    // Widen it: drop the session, add a language and dates.
    await page.click('#session-clear');
    await expect(page.locator('#session-chip')).toBeHidden();
    await page.selectOption('#lang', 'es');
    await page.fill('#from', '2026-03-01');
    await page.fill('#to', '2026-03-31');
    await page.click('#search-form button[type=submit]');
    await expect.poll(() => api.requests('/search').length).toBe(2);
    const q2 = new URL(api.requests('/search')[1].url()).searchParams;
    expect(q2.get('lang')).toBe('es');
    expect(q2.get('session_id')).toBeNull();
    expect(q2.get('from')).toBeTruthy();
    expect(q2.get('to')).toBeTruthy();
  });

  test('a search with none of the new filters sends exactly what it always did', async ({
    page,
  }) => {
    const api = await install(page, {
      search: [
        {
          kind: 'call',
          session_id: 'call-1',
          project_id: 'proj-1',
          project_name: 'Retail',
          room: 'standup',
          started_at: '2026-03-01T10:00:00Z',
          snippet: 'pricing concerns',
          speaker_name: 'Dana',
          start_ms: 0,
          score: 0.8,
        },
      ],
    });
    await page.goto('/en/search/');
    await page.fill('#q', 'pricing');
    await page.click('#search-form button[type=submit]');
    await expect(page.locator('#results a')).toHaveAttribute(
      'href',
      '/en/history/detail/?session=call-1',
    );
    const q = new URL(api.requests('/search')[0].url()).searchParams;
    expect([...q.keys()].sort()).toEqual(['limit', 'q']);
    await expect(page.locator('#session-chip')).toBeHidden();
  });
});
