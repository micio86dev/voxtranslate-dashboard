import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as api from './api';

const BASE = 'http://localhost:3001';

/** Install a fetch mock returning a Response-like object. */
function mockFetch(
  opts: {
    ok?: boolean;
    status?: number;
    json?: unknown;
    jsonThrows?: boolean;
    blob?: Blob;
    rejects?: boolean;
  } = {},
) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (opts.rejects) throw new Error('network down');
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => {
        if (opts.jsonThrows) throw new Error('bad json');
        return opts.json ?? {};
      },
      blob: async () => opts.blob ?? new Blob(['data']),
    };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function lastCall(fn: ReturnType<typeof vi.fn>) {
  const [url, init] = fn.mock.calls[fn.mock.calls.length - 1] as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('request() core behaviour', () => {
  it('returns ok + parsed data on success', async () => {
    mockFetch({ ok: true, status: 200, json: [{ id: 'o1' }] });
    const res = await api.listOrgs();
    expect(res).toEqual({ ok: true, status: 200, data: [{ id: 'o1' }] });
  });

  it('surfaces a non-ok status with the body', async () => {
    mockFetch({ ok: false, status: 402, json: { error: 'no credits' } });
    const res = await api.getCredits('o1');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(402);
    expect(res.data).toEqual({ error: 'no credits' });
  });

  it('does not parse a 204 body', async () => {
    const fn = mockFetch({ ok: true, status: 204 });
    const res = await api.deleteProject('o1', 'p1');
    expect(res).toEqual({ ok: true, status: 204, data: null });
    // json() must not have been consulted on a 204 — assert via a spy-free path:
    expect(fn).toHaveBeenCalledOnce();
  });

  it('yields null data when the body is not JSON', async () => {
    mockFetch({ ok: true, status: 200, jsonThrows: true });
    const res = await api.listOrgs();
    expect(res).toEqual({ ok: true, status: 200, data: null });
  });

  it('returns a status-0 failure when fetch throws', async () => {
    mockFetch({ rejects: true });
    const res = await api.listOrgs();
    expect(res).toEqual({ ok: false, status: 0, data: null });
  });

  it('omits Content-Type on a bodyless request, sets it with a body', async () => {
    const fn = mockFetch();
    await api.listOrgs();
    expect((lastCall(fn).init.headers as Record<string, string>)['Content-Type']).toBeUndefined();

    await api.createOrg({ name: 'Acme', slug: 'acme' });
    expect((lastCall(fn).init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });

  it('attaches the bearer token when present', async () => {
    localStorage.setItem('voxb.token', 'jwt-xyz');
    const fn = mockFetch();
    await api.listOrgs();
    expect((lastCall(fn).init.headers as Record<string, string>).Authorization).toBe(
      'Bearer jwt-xyz',
    );
  });
});

// Every thin wrapper: assert method + URL (+ body where it carries one). This
// drives function + line coverage across the whole client surface.
type Row = {
  name: string;
  run: () => Promise<unknown>;
  method: string;
  path: string;
  body?: unknown;
};
const ROWS: Row[] = [
  {
    name: 'listOrgs',
    run: () => api.listOrgs(),
    method: 'GET',
    path: '/api/business/organizations',
  },
  {
    name: 'createOrg',
    run: () => api.createOrg({ name: 'Acme', slug: 'acme', plan: 'business' }),
    method: 'POST',
    path: '/api/business/organizations',
    body: { name: 'Acme', slug: 'acme', plan: 'business' },
  },
  {
    name: 'getOrg',
    run: () => api.getOrg('o1'),
    method: 'GET',
    path: '/api/business/organizations/o1',
  },
  {
    name: 'patchOrg',
    run: () => api.patchOrg('o1', { name: 'New' }),
    method: 'PATCH',
    path: '/api/business/organizations/o1',
    body: { name: 'New' },
  },
  {
    name: 'listMembers',
    run: () => api.listMembers('o1'),
    method: 'GET',
    path: '/api/business/organizations/o1/members',
  },
  {
    name: 'createInvite',
    run: () => api.createInvite('o1', { email: 'x@y.z', role: 'admin' }),
    method: 'POST',
    path: '/api/business/organizations/o1/invites',
    body: { email: 'x@y.z', role: 'admin' },
  },
  {
    name: 'getInvite',
    run: () => api.getInvite('tok en/+'),
    method: 'GET',
    path: `/api/business/invites/${encodeURIComponent('tok en/+')}`,
  },
  {
    name: 'acceptInvite',
    run: () => api.acceptInvite('t1'),
    method: 'POST',
    path: '/api/business/invites/t1/accept',
  },
  {
    name: 'removeMember',
    run: () => api.removeMember('o1', 'u1'),
    method: 'DELETE',
    path: '/api/business/organizations/o1/members/u1',
  },
  {
    name: 'changeMemberRole',
    run: () => api.changeMemberRole('o1', 'u1', 'admin'),
    method: 'PATCH',
    path: '/api/business/organizations/o1/members/u1',
    body: { role: 'admin' },
  },
  {
    name: 'listProjects',
    run: () => api.listProjects('o1'),
    method: 'GET',
    path: '/api/business/organizations/o1/projects',
  },
  {
    name: 'createProject',
    run: () => api.createProject('o1', { name: 'P', description: 'd', default_languages: ['en'] }),
    method: 'POST',
    path: '/api/business/organizations/o1/projects',
    body: { name: 'P', description: 'd', default_languages: ['en'] },
  },
  {
    name: 'getProject',
    run: () => api.getProject('o1', 'p1'),
    method: 'GET',
    path: '/api/business/organizations/o1/projects/p1',
  },
  {
    name: 'patchProject',
    run: () => api.patchProject('o1', 'p1', { name: 'Q' }),
    method: 'PATCH',
    path: '/api/business/organizations/o1/projects/p1',
    body: { name: 'Q' },
  },
  {
    name: 'deleteProject',
    run: () => api.deleteProject('o1', 'p1'),
    method: 'DELETE',
    path: '/api/business/organizations/o1/projects/p1',
  },
  {
    name: 'listVoiceMessages',
    run: () => api.listVoiceMessages('o1', 'p1'),
    method: 'GET',
    path: '/api/business/organizations/o1/projects/p1/voice-messages',
  },
  {
    name: 'voiceMessageAudioUrl',
    run: () => api.voiceMessageAudioUrl('o1', 'p1', 'vm1'),
    method: 'GET',
    path: '/api/business/organizations/o1/projects/p1/voice-messages/vm1/audio-url',
  },
  {
    name: 'getTranscript',
    run: () => api.getTranscript('s1'),
    method: 'GET',
    path: '/api/business/rooms/s1/transcript',
  },
  {
    name: 'translateTranscript',
    run: () => api.translateTranscript('s1', 'fr'),
    method: 'POST',
    path: '/api/business/rooms/s1/transcript/translate',
    body: { target_language: 'fr' },
  },
  {
    name: 'recordingUrl',
    run: () => api.recordingUrl('s1'),
    method: 'GET',
    path: '/api/business/rooms/s1/recording/url',
  },
  {
    name: 'getCredits',
    run: () => api.getCredits('o1'),
    method: 'GET',
    path: '/api/business/organizations/o1/credits',
  },
  {
    name: 'purchaseCredits',
    run: () => api.purchaseCredits('o1', 500),
    method: 'POST',
    path: '/api/business/organizations/o1/credits/purchase',
    body: { credits_amount: 500 },
  },
  {
    name: 'subscribe',
    run: () => api.subscribe('o1', 'business', 'month'),
    method: 'POST',
    path: '/api/business/organizations/o1/subscription',
    body: { plan: 'business', interval: 'month' },
  },
  {
    name: 'getSubscription',
    run: () => api.getSubscription('o1'),
    method: 'GET',
    path: '/api/business/organizations/o1/subscription',
  },
  {
    name: 'billingPortal',
    run: () => api.billingPortal('o1'),
    method: 'POST',
    path: '/api/business/organizations/o1/subscription/portal',
  },
  {
    name: 'listTeams',
    run: () => api.listTeams('o1'),
    method: 'GET',
    path: '/api/business/organizations/o1/teams',
  },
  {
    name: 'createTeam',
    run: () => api.createTeam('o1', 'Eng'),
    method: 'POST',
    path: '/api/business/organizations/o1/teams',
    body: { name: 'Eng' },
  },
  {
    name: 'renameTeam',
    run: () => api.renameTeam('o1', 't1', 'Ops'),
    method: 'PATCH',
    path: '/api/business/organizations/o1/teams/t1',
    body: { name: 'Ops' },
  },
  {
    name: 'deleteTeam',
    run: () => api.deleteTeam('o1', 't1'),
    method: 'DELETE',
    path: '/api/business/organizations/o1/teams/t1',
  },
  {
    name: 'listTeamMembers',
    run: () => api.listTeamMembers('o1', 't1'),
    method: 'GET',
    path: '/api/business/organizations/o1/teams/t1/members',
  },
  {
    name: 'addTeamMember',
    run: () => api.addTeamMember('o1', 't1', 'u1'),
    method: 'POST',
    path: '/api/business/organizations/o1/teams/t1/members',
    body: { user_id: 'u1' },
  },
  {
    name: 'removeTeamMember',
    run: () => api.removeTeamMember('o1', 't1', 'u1'),
    method: 'DELETE',
    path: '/api/business/organizations/o1/teams/t1/members/u1',
  },
  {
    name: 'setTeamMemberRole',
    run: () => api.setTeamMemberRole('o1', 't1', 'u1', 'lead'),
    method: 'PATCH',
    path: '/api/business/organizations/o1/teams/t1/members/u1',
    body: { role: 'lead' },
  },
  {
    name: 'generateInsight',
    run: () => api.generateInsight('o1', { mode: 'qa', question: 'why?' }),
    method: 'POST',
    path: '/api/business/organizations/o1/insights',
    body: { mode: 'qa', question: 'why?' },
  },
  {
    name: 'createMeeting',
    run: () => api.createMeeting('o1', { title: 'T', scheduled_at: '2026-07-01T10:00:00Z' }),
    method: 'POST',
    path: '/api/business/organizations/o1/meetings',
    body: { title: 'T', scheduled_at: '2026-07-01T10:00:00Z' },
  },
  {
    name: 'getMeeting',
    run: () => api.getMeeting('o1', 'm1'),
    method: 'GET',
    path: '/api/business/organizations/o1/meetings/m1',
  },
  {
    name: 'updateMeeting',
    run: () => api.updateMeeting('o1', 'm1', { title: 'T2', scheduled_at: '2026-07-02T10:00:00Z' }),
    method: 'PATCH',
    path: '/api/business/organizations/o1/meetings/m1',
  },
  {
    name: 'cancelMeeting',
    run: () => api.cancelMeeting('o1', 'm1'),
    method: 'POST',
    path: '/api/business/organizations/o1/meetings/m1/cancel',
  },
  {
    name: 'getVapidKey',
    run: () => api.getVapidKey(),
    method: 'GET',
    path: '/api/push/vapid-public-key',
  },
  {
    name: 'subscribePush',
    run: () => api.subscribePush({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }),
    method: 'POST',
    path: '/api/push/subscribe',
    body: { endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } },
  },
  {
    name: 'unsubscribePush',
    run: () => api.unsubscribePush('e'),
    method: 'DELETE',
    path: '/api/push/subscribe',
    body: { endpoint: 'e' },
  },
  {
    name: 'markNotificationRead',
    run: () => api.markNotificationRead('n1'),
    method: 'POST',
    path: '/api/notifications/n1/read',
  },
  {
    name: 'markAllNotificationsRead',
    run: () => api.markAllNotificationsRead(),
    method: 'POST',
    path: '/api/notifications/read-all',
  },
  {
    name: 'getNotifPreferences',
    run: () => api.getNotifPreferences(),
    method: 'GET',
    path: '/api/notifications/preferences',
  },
  {
    name: 'patchNotifPreferences',
    run: () => api.patchNotifPreferences({ timezone: 'UTC' }),
    method: 'PATCH',
    path: '/api/notifications/preferences',
    body: { timezone: 'UTC' },
  },
  {
    name: 'getStoryboard',
    run: () => api.getStoryboard('o1', 'p1'),
    method: 'GET',
    path: '/api/business/organizations/o1/projects/p1/storyboard',
  },
  {
    name: 'generateStoryboard',
    run: () => api.generateStoryboard('o1', 'p1', { lang: 'en' }),
    method: 'POST',
    path: '/api/business/organizations/o1/projects/p1/storyboard',
    body: { lang: 'en' },
  },
];

describe('endpoint wrappers', () => {
  for (const row of ROWS) {
    it(`${row.name} → ${row.method} ${row.path}`, async () => {
      const fn = mockFetch();
      await row.run();
      const c = lastCall(fn);
      expect(c.url).toBe(BASE + row.path);
      expect(c.init.method).toBe(row.method);
      if (row.body !== undefined) expect(c.body).toEqual(row.body);
    });
  }
});

describe('query-string builders', () => {
  it('listOrgRooms: bare vs fully-parameterised', async () => {
    const fn = mockFetch();
    await api.listOrgRooms('o1');
    expect(lastCall(fn).url).toBe(`${BASE}/api/business/organizations/o1/rooms`);

    await api.listOrgRooms('o1', {
      project_id: 'p1',
      page: 2,
      limit: 50,
      from: '2026-01-01',
      to: '2026-02-01',
      member_ids: 'u1,u2',
    });
    const url = lastCall(fn).url;
    expect(url).toContain('project_id=p1');
    expect(url).toContain('page=2');
    expect(url).toContain('limit=50');
    expect(url).toContain('from=2026-01-01');
    expect(url).toContain('to=2026-02-01');
    expect(url).toContain('member_ids=u1%2Cu2');
  });

  it('searchTranscripts: q only vs q+project+limit', async () => {
    const fn = mockFetch();
    await api.searchTranscripts('o1', { q: 'hello world' });
    expect(lastCall(fn).url).toContain('q=hello+world');

    await api.searchTranscripts('o1', { q: 'x', project_id: 'p1', limit: 5 });
    const url = lastCall(fn).url;
    expect(url).toContain('project_id=p1');
    expect(url).toContain('limit=5');
  });

  it("getTranscript: omits lang when unset, sends the reader's locale when given", async () => {
    // A call transcript is multilingual. `lang` is how the reader tells the server which
    // language to resolve every line into; without it the server falls back to the
    // language the reader used in that call, so the bare URL must stay clean.
    const fn = mockFetch();
    await api.getTranscript('s1');
    expect(lastCall(fn).url).toBe(`${BASE}/api/business/rooms/s1/transcript`);

    await api.getTranscript('s1', 'it');
    expect(lastCall(fn).url).toBe(`${BASE}/api/business/rooms/s1/transcript?lang=it`);
  });

  it('getTranscript: escapes a locale so it cannot forge query parameters', async () => {
    const fn = mockFetch();
    await api.getTranscript('s1', 'pt-BR&admin=1');
    expect(lastCall(fn).url).toContain('lang=pt-BR%26admin%3D1');
    expect(lastCall(fn).url).not.toContain('&admin=1');
  });

  it('listMeetings: bare vs from/to', async () => {
    const fn = mockFetch();
    await api.listMeetings('o1');
    expect(lastCall(fn).url).toBe(`${BASE}/api/business/organizations/o1/meetings`);
    await api.listMeetings('o1', { from: '2026-01-01', to: '2026-02-01' });
    expect(lastCall(fn).url).toContain('from=2026-01-01');
  });

  it('getAnalytics / getMemberAnalytics: default and explicit days', async () => {
    const fn = mockFetch();
    await api.getAnalytics('o1');
    expect(lastCall(fn).url).toContain('analytics?days=30');
    await api.getAnalytics('o1', 7);
    expect(lastCall(fn).url).toContain('days=7');
    await api.getMemberAnalytics('o1', 'u1');
    expect(lastCall(fn).url).toContain('/members/u1/analytics?days=30');
    await api.getMemberAnalytics('o1', 'u1', 90);
    expect(lastCall(fn).url).toContain('days=90');
  });

  it('listAudit: bare vs all filters', async () => {
    const fn = mockFetch();
    await api.listAudit('o1');
    expect(lastCall(fn).url).toBe(`${BASE}/api/business/organizations/o1/audit`);
    await api.listAudit('o1', {
      action: 'member.invited',
      from: '2026-01-01',
      to: '2026-02-01',
      q: 'ann',
      page: 3,
      limit: 25,
    });
    const url = lastCall(fn).url;
    expect(url).toContain('action=member.invited');
    expect(url).toContain('q=ann');
    expect(url).toContain('page=3');
  });

  it('listNotifications: bare vs unread+limit', async () => {
    const fn = mockFetch();
    await api.listNotifications();
    expect(lastCall(fn).url).toBe(`${BASE}/api/notifications`);
    await api.listNotifications({ unread: true, limit: 10 });
    const url = lastCall(fn).url;
    expect(url).toContain('unread=true');
    expect(url).toContain('limit=10');
  });
});

describe('uploadVoiceMessage', () => {
  const file = new File(['audio-bytes'], 'note.webm', { type: 'audio/webm' });

  it('POSTs multipart with the file + rounded duration, returns the created body', async () => {
    const fn = mockFetch({
      ok: true,
      status: 201,
      json: { id: 'vm1', translated: true, translate_blocked: null },
    });
    const res = await api.uploadVoiceMessage('o1', 'p1', file, 12.7);
    expect(res).toEqual({
      ok: true,
      status: 201,
      data: { id: 'vm1', translated: true, translate_blocked: null },
    });
    const init = fn.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get('duration_seconds')).toBe('13');
    expect(form.get('file')).toBeInstanceOf(File);
    // no JSON Content-Type — the browser sets the multipart boundary
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('omits duration when null and handles a 204', async () => {
    const fn = mockFetch({ ok: true, status: 204 });
    const res = await api.uploadVoiceMessage('o1', 'p1', file, null);
    expect(res).toEqual({ ok: true, status: 204, data: null });
    const form = (fn.mock.calls[0][1] as RequestInit).body as FormData;
    expect(form.get('duration_seconds')).toBeNull();
  });

  it('returns a status-0 failure when fetch throws', async () => {
    mockFetch({ rejects: true });
    const res = await api.uploadVoiceMessage('o1', 'p1', file, 1);
    expect(res).toEqual({ ok: false, status: 0, data: null });
  });
});

describe('downloadTranscript', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:url'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('fetches the export and triggers a download (txt)', async () => {
    const fn = mockFetch({ ok: true, blob: new Blob(['t']) });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const ok = await api.downloadTranscript('s1', 'txt');
    expect(ok).toBe(true);
    expect(lastCall(fn).url).toContain('/transcript/export?format=txt');
    expect(clickSpy).toHaveBeenCalled();
  });

  it('includes the language param for pdf', async () => {
    const fn = mockFetch({ ok: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await api.downloadTranscript('s1', 'pdf', 'fr');
    const url = lastCall(fn).url;
    expect(url).toContain('format=pdf');
    expect(url).toContain('language=fr');
  });

  it('returns false on a non-ok response', async () => {
    mockFetch({ ok: false, status: 404 });
    expect(await api.downloadTranscript('s1', 'txt')).toBe(false);
  });

  it('returns false when fetch throws', async () => {
    mockFetch({ rejects: true });
    expect(await api.downloadTranscript('s1', 'txt')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2.1 [RED] — helpAssistantWsUrl / buildHelpAssistantWsUrl
// ---------------------------------------------------------------------------

describe('buildHelpAssistantWsUrl', () => {
  it('builds wss:// URL from https API base', () => {
    const url = api.buildHelpAssistantWsUrl('https://api.voxtranslate.app', 'org-123');
    expect(url).toBe(
      'wss://api.voxtranslate.app/api/business/organizations/org-123/help-assistant',
    );
  });

  it('builds ws:// URL from http API base', () => {
    const url = api.buildHelpAssistantWsUrl('http://localhost:3001', 'org-abc');
    expect(url).toBe('ws://localhost:3001/api/business/organizations/org-abc/help-assistant');
  });

  it('strips trailing slash from apiBase', () => {
    const url = api.buildHelpAssistantWsUrl('https://api.voxtranslate.app/', 'org-1');
    expect(url).toBe('wss://api.voxtranslate.app/api/business/organizations/org-1/help-assistant');
  });
});

describe('helpAssistantWsUrl', () => {
  it('returns a wss:// URL for the help-assistant endpoint', () => {
    const url = api.helpAssistantWsUrl('org-xyz');
    // Module-level API_BASE defaults to 'http://localhost:3001' in test env
    expect(url).toContain('/api/business/organizations/org-xyz/help-assistant');
    expect(url).toMatch(/^ws(s)?:\/\//);
  });
});

describe('current-org persistence', () => {
  it('round-trips through localStorage', () => {
    expect(api.currentOrgId()).toBeNull();
    api.setCurrentOrgId('o9');
    expect(api.currentOrgId()).toBe('o9');
  });

  it('swallows storage errors', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(api.currentOrgId()).toBeNull();
    expect(() => api.setCurrentOrgId('x')).not.toThrow();
    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});
