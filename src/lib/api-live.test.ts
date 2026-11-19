import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';

const BASE = 'http://localhost:3001';
const ORG = 'org-1';
const L = `/api/business/organizations/${ORG}/live`;

function mockFetch(opts: { status?: number; json?: unknown } = {}) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    json: async () => opts.json ?? {},
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function last(fn: ReturnType<typeof vi.fn>) {
  const [url, init] = fn.mock.calls[fn.mock.calls.length - 1] as [string, RequestInit];
  return {
    url,
    method: init.method,
    body: init.body ? JSON.parse(init.body as string) : undefined,
    path: url.replace(BASE, ''),
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('live sessions', () => {
  it('lists with no filters as a bare path', async () => {
    const f = mockFetch({ json: { sessions: [], total: 0, limit: 25, offset: 0 } });
    await api.listLiveSessions(ORG);
    expect(last(f)).toMatchObject({ method: 'GET', path: `${L}/sessions` });
  });

  it('sends every filter the server understands, and only those that are set', async () => {
    const f = mockFetch();
    await api.listLiveSessions(ORG, {
      status: 'active',
      project_id: 'p1',
      desk_id: 'd1',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      limit: 50,
      offset: 100,
    });
    const url = new URL(last(f).url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'active',
      project_id: 'p1',
      desk_id: 'd1',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      limit: '50',
      offset: '100',
    });
    await api.listLiveSessions(ORG, { status: 'ended' });
    expect(last(f).path).toBe(`${L}/sessions?status=ended`);
  });

  it('opens one session, asking for a translation language when given', async () => {
    const f = mockFetch();
    await api.getLiveSession(ORG, 's 1');
    expect(last(f).path).toBe(`${L}/sessions/s%201`);
    await api.getLiveSession(ORG, 's1', 'it');
    expect(last(f).path).toBe(`${L}/sessions/s1?lang=it`);
  });

  it('deletes with DELETE on the session path', async () => {
    const f = mockFetch({ json: { erased: true } });
    const r = await api.deleteLiveSession(ORG, 's1');
    expect(last(f)).toMatchObject({ method: 'DELETE', path: `${L}/sessions/s1` });
    expect(r.ok).toBe(true);
  });

  it('keeps the 409 (still open) visible to the caller', async () => {
    mockFetch({ status: 409, json: { code: 'session_active', message: 'End it first' } });
    const r = await api.deleteLiveSession(ORG, 's1');
    expect(r.status).toBe(409);
    expect(api.liveErrorKey(r)).toBe('live.error.session_active');
  });
});

describe('live usage', () => {
  it('asks for group and range', async () => {
    const f = mockFetch();
    await api.getLiveUsage(ORG, { group: 'day', from: 'a', to: 'b' });
    expect(Object.fromEntries(new URL(last(f).url).searchParams)).toEqual({
      group: 'day',
      from: 'a',
      to: 'b',
    });
    await api.getLiveUsage(ORG);
    expect(last(f).path).toBe(`${L}/usage`);
  });

  it('surfaces bad_range and bad_group', async () => {
    mockFetch({ status: 400, json: { code: 'bad_range', message: 'x' } });
    expect(api.liveErrorKey(await api.getLiveUsage(ORG))).toBe('live.error.bad_range');
    mockFetch({ status: 400, json: { code: 'bad_group', message: 'x' } });
    expect(api.liveErrorKey(await api.getLiveUsage(ORG))).toBe('live.error.bad_group');
  });
});

describe('live desks', () => {
  const input = {
    name: 'Front',
    location_label: 'Milan',
    default_lang: 'it',
    languages: ['en'],
    project_id: 'p1',
  };

  it('lists, creates, patches and reads the qr on the documented paths', async () => {
    const f = mockFetch({ json: { desks: [] } });
    await api.listLiveDesks(ORG);
    expect(last(f)).toMatchObject({ method: 'GET', path: `${L}/desks` });
    await api.createLiveDesk(ORG, input);
    expect(last(f)).toMatchObject({ method: 'POST', path: `${L}/desks`, body: input });
    await api.updateLiveDesk(ORG, 'd1', { name: 'Back' });
    expect(last(f)).toMatchObject({
      method: 'PATCH',
      path: `${L}/desks/d1`,
      body: { name: 'Back' },
    });
    await api.getLiveDeskQr(ORG, 'd1');
    expect(last(f)).toMatchObject({ method: 'GET', path: `${L}/desks/d1/qr` });
  });

  it('revoke and regenerate are POSTs', async () => {
    const f = mockFetch();
    await api.revokeLiveDesk(ORG, 'd1');
    expect(last(f)).toMatchObject({ method: 'POST', path: `${L}/desks/d1/revoke` });
    await api.regenerateLiveDesk(ORG, 'd1');
    expect(last(f)).toMatchObject({ method: 'POST', path: `${L}/desks/d1/regenerate` });
  });

  it('drops the printable URL the server returns on create and regenerate', async () => {
    mockFetch({ status: 201, json: { id: 'd1', name: 'Front', qr_url: 'https://x/secret' } });
    const created = await api.createLiveDesk(ORG, input);
    expect(JSON.stringify(created)).not.toContain('secret');
    expect(created.data?.id).toBe('d1');

    mockFetch({ json: { id: 'd1', qr_url: 'https://x/secret', waiting_closed: 2 } });
    const regenerated = await api.regenerateLiveDesk(ORG, 'd1');
    expect(JSON.stringify(regenerated)).not.toContain('secret');
    expect(regenerated.data?.waiting_closed).toBe(2);
  });

  it('a failed create has no data to strip and still reports the code', async () => {
    mockFetch({ status: 404, json: { code: 'project_not_found', message: 'x' } });
    const r = await api.createLiveDesk(ORG, input);
    expect(r.ok).toBe(false);
    expect(api.liveErrorKey(r)).toBe('live.error.project_not_found');
  });
});

describe('desk console', () => {
  it('reads my desks and the waiting list of one desk (not org-scoped paths)', async () => {
    const f = mockFetch({ json: { desks: [] } });
    await api.listMyLiveDesks();
    expect(last(f)).toMatchObject({ method: 'GET', path: '/api/live/my-desks' });
    await api.getLiveDeskWaiting('d 1');
    expect(last(f)).toMatchObject({ method: 'GET', path: '/api/live/desks/d%201/waiting' });
  });
});

describe('searchTranscripts with Live Connect filters', () => {
  it('sends kind, lang, range and session_id when set', async () => {
    const f = mockFetch({ json: { results: [] } });
    await api.searchTranscripts(ORG, {
      q: 'refund',
      kind: 'live_connect',
      lang: 'it',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      session_id: 's1',
    });
    expect(Object.fromEntries(new URL(last(f).url).searchParams)).toEqual({
      q: 'refund',
      kind: 'live_connect',
      lang: 'it',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      session_id: 's1',
    });
  });

  it('sends exactly what it sent before when no new filter is set', async () => {
    const f = mockFetch({ json: { results: [] } });
    await api.searchTranscripts(ORG, { q: 'pricing', project_id: 'p1', limit: 25 });
    expect(Object.fromEntries(new URL(last(f).url).searchParams)).toEqual({
      q: 'pricing',
      project_id: 'p1',
      limit: '25',
    });
  });
});

describe('liveErrorKey', () => {
  const key = (status: number, data?: unknown) => api.liveErrorKey({ status, data });

  it('prefers the stable code over the status', () => {
    for (const code of [
      'project_not_found',
      'name_required',
      'bad_lang',
      'bad_status',
      'bad_range',
      'bad_group',
      'session_not_found',
      'desk_not_found',
      'insufficient_credits',
      'subscription_required',
      'session_active',
    ]) {
      expect(key(400, { code, message: 'English' })).toBe(`live.error.${code}`);
    }
    expect(key(402, { code: 'subscription_required' })).toBe('live.error.subscription_required');
  });

  it('falls back to the status for plain-text refusals (no JSON body)', () => {
    expect(key(0)).toBe('live.error.network');
    expect(key(401)).toBe('live.error.unauthorized');
    expect(key(402)).toBe('live.error.insufficient_credits');
    expect(key(403, null)).toBe('live.error.forbidden');
    expect(key(404, null)).toBe('live.error.notFound');
    expect(key(429)).toBe('live.error.rate_limited');
    expect(key(500)).toBe('live.error.generic');
  });

  it('never trusts an unknown code', () => {
    expect(key(400, { code: 'drop table', message: 'x' })).toBe('live.error.generic');
    expect(key(404, { code: 42 })).toBe('live.error.notFound');
  });
});
