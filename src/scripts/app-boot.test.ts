import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../lib/auth', () => ({
  getUser: vi.fn(() => ({ id: 'u1', email: 'a@b.co', name: 'Ann', avatar_url: null })),
  logout: vi.fn(),
  requireAuth: vi.fn(() => true),
}));
vi.mock('../lib/api', () => ({
  currentOrgId: vi.fn(() => null),
  listOrgs: vi.fn(),
  setCurrentOrgId: vi.fn(),
}));

import { boot } from './app-boot';
import { getUser, logout, requireAuth } from '../lib/auth';
import { currentOrgId, listOrgs, setCurrentOrgId, type OrgSummary } from '../lib/api';

const requireAuthMock = vi.mocked(requireAuth);
const logoutMock = vi.mocked(logout);
const listOrgsMock = vi.mocked(listOrgs);
const currentOrgIdMock = vi.mocked(currentOrgId);
const setCurrentOrgIdMock = vi.mocked(setCurrentOrgId);
vi.mocked(getUser);

function orgSummary(over: Partial<OrgSummary> = {}): OrgSummary {
  return {
    id: 'o1',
    name: 'Acme',
    slug: 'acme',
    plan: 'business',
    subscription_status: 'active',
    subscription_active: true,
    current_period_end: null,
    credits_balance: 100,
    role: 'owner',
    ...over,
  };
}

function stubLocation() {
  const loc = { href: '', pathname: '/en/dashboard/', search: '', reload: vi.fn() };
  Object.defineProperty(window, 'location', { value: loc, writable: true, configurable: true });
  return loc;
}

/** Build the org-scoped page chrome boot() expects to wire up. */
function pageChrome(opts: { main?: boolean; signout?: boolean; switcher?: boolean } = {}) {
  document.body.innerHTML = '';
  document.documentElement.lang = 'en';
  if (opts.main) document.body.appendChild(document.createElement('main'));
  if (opts.signout) {
    const b = document.createElement('button');
    b.id = 'signout';
    document.body.appendChild(b);
  }
  if (opts.switcher) {
    const sel = document.createElement('select');
    sel.id = 'org-switcher';
    document.body.appendChild(sel);
  }
  const banner = document.createElement('div');
  banner.id = 'sub-banner';
  document.body.appendChild(banner);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockReturnValue(true);
  currentOrgIdMock.mockReturnValue(null);
  stubLocation();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('boot', () => {
  it('returns null and does nothing when not authenticated', async () => {
    requireAuthMock.mockReturnValue(false);
    pageChrome();
    expect(await boot()).toBeNull();
    expect(listOrgsMock).not.toHaveBeenCalled();
  });

  it('logs out and returns null on a 401', async () => {
    pageChrome({ signout: true });
    listOrgsMock.mockResolvedValue({ ok: false, status: 401, data: null });
    expect(await boot()).toBeNull();
    expect(logoutMock).toHaveBeenCalledWith('/en/');
  });

  it('renders the boot-error card on a non-401 failure (does NOT bounce to onboarding)', async () => {
    pageChrome({ main: true });
    listOrgsMock.mockResolvedValue({ ok: false, status: 0, data: null });
    const loc = stubLocation();
    expect(await boot()).toBeNull();
    // a retry card is shown in <main>, and we did not redirect to onboarding
    expect(document.querySelector('main button')?.textContent).toBe('Retry');
    expect(loc.href).toBe('');
  });

  it('redirects to onboarding when the user has zero orgs', async () => {
    pageChrome();
    listOrgsMock.mockResolvedValue({ ok: true, status: 200, data: [] });
    const loc = stubLocation();
    expect(await boot()).toBeNull();
    expect(loc.href).toBe('/en/onboarding/');
  });

  it('picks the first org and persists it when none is selected', async () => {
    pageChrome({ switcher: true });
    const orgs = [orgSummary({ id: 'oA', name: 'A' }), orgSummary({ id: 'oB', name: 'B' })];
    listOrgsMock.mockResolvedValue({ ok: true, status: 200, data: orgs });
    const ctx = await boot();
    expect(ctx?.activeOrg.id).toBe('oA');
    expect(setCurrentOrgIdMock).toHaveBeenCalledWith('oA');
    expect(ctx?.lang).toBe('en');
    expect(ctx?.orgs).toHaveLength(2);
  });

  it('honours a persisted org when it still exists', async () => {
    currentOrgIdMock.mockReturnValue('oB');
    pageChrome({ switcher: true });
    const orgs = [orgSummary({ id: 'oA' }), orgSummary({ id: 'oB' })];
    listOrgsMock.mockResolvedValue({ ok: true, status: 200, data: orgs });
    const ctx = await boot();
    expect(ctx?.activeOrg.id).toBe('oB');
    // already valid → no need to persist a fallback
    expect(setCurrentOrgIdMock).not.toHaveBeenCalled();
  });

  it('falls back to the first org when the persisted id is stale', async () => {
    currentOrgIdMock.mockReturnValue('gone');
    pageChrome({ switcher: true });
    const orgs = [orgSummary({ id: 'oA' })];
    listOrgsMock.mockResolvedValue({ ok: true, status: 200, data: orgs });
    const ctx = await boot();
    expect(ctx?.activeOrg.id).toBe('oA');
    expect(setCurrentOrgIdMock).toHaveBeenCalledWith('oA');
  });

  it('populates + shows the org switcher with 2+ orgs and reloads on change', async () => {
    pageChrome({ switcher: true });
    const orgs = [orgSummary({ id: 'oA', name: 'A & Co' }), orgSummary({ id: 'oB', name: 'B' })];
    listOrgsMock.mockResolvedValue({ ok: true, status: 200, data: orgs });
    const loc = stubLocation();
    await boot();
    const sw = document.getElementById('org-switcher') as HTMLSelectElement;
    expect(sw.options).toHaveLength(2);
    expect(sw.hidden).toBe(false);
    // option label is HTML-escaped
    expect(sw.innerHTML).toContain('A &amp; Co');
    // switching persists + reloads
    sw.value = 'oB';
    sw.dispatchEvent(new Event('change'));
    expect(setCurrentOrgIdMock).toHaveBeenCalledWith('oB');
    expect(loc.reload).toHaveBeenCalled();
  });

  it('hides the switcher when there is only one org', async () => {
    pageChrome({ switcher: true });
    listOrgsMock.mockResolvedValue({ ok: true, status: 200, data: [orgSummary({ id: 'oA' })] });
    await boot();
    expect((document.getElementById('org-switcher') as HTMLSelectElement).hidden).toBe(true);
  });

  it('wires the sign-out button', async () => {
    pageChrome({ signout: true });
    listOrgsMock.mockResolvedValue({ ok: true, status: 200, data: [orgSummary()] });
    await boot();
    document.getElementById('signout')!.dispatchEvent(new MouseEvent('click'));
    expect(logoutMock).toHaveBeenCalledWith('/en/');
  });

  it('defaults the page language to "en" when the html lang is empty', async () => {
    pageChrome();
    document.documentElement.lang = '';
    listOrgsMock.mockResolvedValue({ ok: true, status: 200, data: [orgSummary()] });
    const ctx = await boot();
    expect(ctx?.lang).toBe('en');
  });
});
