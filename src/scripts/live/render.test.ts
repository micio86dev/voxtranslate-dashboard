import { describe, expect, it } from 'vitest';
import type {
  LiveDesk,
  LiveParticipant,
  LiveSessionRow,
  LiveUtterance,
  WaitingGuest,
} from '../../lib/api';
import {
  deskCard,
  openSessionsList,
  participantsList,
  sessionFacts,
  sessionRow,
  statusBadge,
  timelineList,
  usageTable,
  utteranceItem,
  waitingItem,
  type RenderCtx,
} from './render';
import { speakerSides } from './format';
import { h } from './dom';

// Keys render as `[key]` and variables as `[key|k=v]`, so assertions read as intent.
const ctx: RenderCtx = {
  lang: 'en',
  t: (key, vars) =>
    vars ? `[${key}|${Object.entries(vars).map(([k, v]) => `${k}=${v}`)}]` : `[${key}]`,
};

const row = (over: Partial<LiveSessionRow> = {}): LiveSessionRow => ({
  id: 's1',
  status: 'ended',
  created_at: '2026-03-01T10:00:00Z',
  started_at: '2026-03-01T10:01:00Z',
  ended_at: '2026-03-01T10:06:00Z',
  end_reason: 'ended_by_guest',
  duration_secs: 305,
  host_lang: 'it',
  desk: { id: 'd1', name: 'Front desk', location_label: 'Milan' },
  project: { id: 'p1', name: 'Retail' },
  guest: { name: 'Ana', lang: 'es' },
  staff_name: 'Luca',
  credits: 42,
  has_transcript: true,
  ...over,
});

describe('h', () => {
  it('sets text as text, never as markup', () => {
    const el = h('p', {}, '<img src=x onerror=alert(1)>');
    expect(el.children.length).toBe(0);
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>');
  });
  it('skips null attributes and children, and writes true as a bare attribute', () => {
    const el = h('button', { disabled: true, title: null, hidden: false, n: 3 }, null, false, 'x');
    expect(el.hasAttribute('disabled')).toBe(true);
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(el.getAttribute('n')).toBe('3');
    expect(el.textContent).toBe('x');
  });
  it('accepts elements as children', () => {
    expect(h('div', {}, h('span', {}, 'a')).querySelector('span')?.textContent).toBe('a');
  });
});

describe('statusBadge', () => {
  it('says the status in words and marks it for tests and styling', () => {
    const b = statusBadge('active', ctx);
    expect(b.textContent).toBe('[live.status.active]');
    expect(b.dataset.status).toBe('active');
    expect(statusBadge('waiting', ctx).className).toContain('warn');
    expect(statusBadge('ended', ctx).className).toContain('muted');
    expect(statusBadge('nonsense', ctx).textContent).toBe('[live.status.unknown]');
  });
});

describe('sessionRow', () => {
  it('shows status, desk and location, project, guest and language, staff, duration, credits, transcript', () => {
    const tr = sessionRow(row(), ctx, '/en/live/detail/?session=s1');
    const text = tr.textContent ?? '';
    expect(text).toContain('[live.status.ended]');
    expect(text).toContain('Front desk');
    expect(text).toContain('Milan');
    expect(text).toContain('Retail');
    expect(text).toContain('Ana');
    expect(text).toContain('Spanish');
    expect(text).toContain('Luca');
    expect(text).toContain('5:05');
    expect(text).toContain('42');
    expect(text).toContain('[live.sessions.yes]');
    expect(tr.dataset.sessionId).toBe('s1');
    expect(tr.querySelector('a')?.getAttribute('href')).toBe('/en/live/detail/?session=s1');
  });

  it('copes with a conversation that never started or has no desk, project, guest or staff', () => {
    const tr = sessionRow(
      row({
        status: 'waiting',
        started_at: null,
        duration_secs: null,
        desk: null,
        project: null,
        guest: { name: null, lang: null },
        staff_name: null,
        has_transcript: false,
      }),
      ctx,
      '#',
    );
    const text = tr.textContent ?? '';
    expect(text).toContain('[live.sessions.noDesk]');
    expect(text).toContain('[live.sessions.no]');
    expect(text).toContain('—');
  });

  it('renders hostile names as text', () => {
    const tr = sessionRow(
      row({ guest: { name: '<script>alert(1)</script>', lang: 'es' }, staff_name: '"><b>x</b>' }),
      ctx,
      '#',
    );
    expect(tr.querySelector('script')).toBeNull();
    expect(tr.querySelector('b')).toBeNull();
    expect(tr.textContent).toContain('<script>alert(1)</script>');
  });
});

describe('sessionFacts', () => {
  it('lists the facts, with the end reason only once there is one', () => {
    const text = sessionFacts(row(), ctx).textContent ?? '';
    expect(text).toContain('Retail');
    expect(text).toContain('Front desk · Milan');
    expect(text).toContain('5:05');
    expect(text).toContain('[live.endReason.ended_by_guest]');
    const open = sessionFacts(row({ status: 'active', end_reason: null, desk: null }), ctx);
    expect(open.textContent).not.toContain('endReason');
    expect(open.textContent).toContain('[live.sessions.noDesk]');
  });
});

describe('participants and utterances', () => {
  const participants: LiveParticipant[] = [
    { peer_id: 'p1', role: 'guest', display_name: 'Ana', lang: 'es' },
    { peer_id: 'p2', role: 'staff', display_name: 'Luca', lang: 'it' },
  ];
  const u = (over: Partial<LiveUtterance> = {}): LiveUtterance => ({
    at: '2026-03-01T10:01:05Z',
    offset_ms: 65_000,
    speaker_id: 'p1',
    speaker_name: 'Ana',
    original_lang: 'es',
    original: 'Hola, necesito ayuda',
    translation: 'Hello, I need help',
    translations: { en: 'Hello, I need help' },
    ...over,
  });

  it('lists each participant with role and language, one colour each', () => {
    const side = speakerSides(participants, []);
    const ul = participantsList(participants, side, ctx);
    expect(ul.textContent).toContain('Ana · [live.role.guest] · Spanish');
    expect(ul.textContent).toContain('Luca · [live.role.staff] · Italian');
    const [a, b] = Array.from(ul.querySelectorAll('li'));
    expect(a.className).not.toBe(b.className);
    const odd = participantsList([{ ...participants[0], role: 'weird' }], side, ctx);
    expect(odd.textContent).toContain('[live.role.other]');
  });

  it('shows the original, with the translation beside it and labelled', () => {
    const li = utteranceItem(u(), 0, 'en', ctx);
    expect(li.querySelector('[data-part=original]')?.textContent).toBe('Hola, necesito ayuda');
    expect(li.querySelector('[data-part=original]')?.getAttribute('lang')).toBe('es');
    const tr = li.querySelector('[data-part=translation]');
    expect(tr?.textContent).toContain('Hello, I need help');
    expect(tr?.textContent).toContain('English:');
    expect(li.textContent).toContain('Ana');
    expect(li.textContent).toContain('1:05');
  });

  it('never shows a translation in place of the original', () => {
    // Even when the translation is the only thing the server has, the original line is rendered.
    const li = utteranceItem(u({ original: 'Ciao', translation: 'Hi' }), 1, 'en', ctx);
    expect(li.querySelector('[data-part=original]')?.textContent).toBe('Ciao');
    expect(li.querySelectorAll('[data-part=original]')).toHaveLength(1);
  });

  it('says so when a line has no translation into the chosen language', () => {
    const li = utteranceItem(u({ translation: null }), 0, 'fr', ctx);
    expect(li.querySelector('[data-part=translation-missing]')?.textContent).toBe(
      '[live.detail.noTranslation]',
    );
  });

  it('does not offer a translation of a line that was already in the chosen language', () => {
    const li = utteranceItem(u({ translation: null, original_lang: 'en' }), 0, 'en', ctx);
    expect(li.querySelector('[data-part=translation-missing]')).toBeNull();
    expect(li.querySelector('[data-part=translation]')).toBeNull();
  });

  it('shows no translation line at all when none was asked for', () => {
    const li = utteranceItem(u(), 0, '', ctx);
    expect(li.querySelector('[data-part^=translation]')).toBeNull();
  });

  it('keeps the two speakers on their own side', () => {
    const a = utteranceItem(u(), 0, '', ctx);
    const b = utteranceItem(u({ speaker_id: 'p2', speaker_name: 'Luca' }), 1, '', ctx);
    expect(a.dataset.side).toBe('0');
    expect(b.dataset.side).toBe('1');
  });

  it('renders hostile transcript text as text', () => {
    const li = utteranceItem(
      u({ original: '<img src=x onerror=1>', translation: '<b>t</b>' }),
      0,
      'en',
      ctx,
    );
    expect(li.querySelector('img')).toBeNull();
    expect(li.querySelector('b')).toBeNull();
  });

  it('tolerates a missing offset', () => {
    const li = utteranceItem(u({ offset_ms: null }), 0, '', ctx);
    expect(li.querySelector('time')?.textContent).toBe('—');
  });
});

describe('timelineList', () => {
  it('lists events by kind and time', () => {
    const ol = timelineList(
      [
        { at: '2026-03-01T10:00:00Z', kind: 'answered', detail: { by: 'x' } },
        { at: '2026-03-01T10:05:00Z', kind: 'ended', detail: {} },
      ],
      ctx,
    );
    expect(ol.querySelectorAll('li')).toHaveLength(2);
    expect(ol.textContent).toContain('answered');
    expect(ol.textContent).not.toContain('"by"');
  });
});

describe('deskCard', () => {
  const desk: LiveDesk = {
    id: 'd1',
    org_id: 'o1',
    project_id: 'p1',
    name: 'Front desk',
    location_label: 'Milan',
    default_lang: 'it',
    languages: ['en', 'es'],
    public_id: 'pub',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
  };
  const actions = (el: HTMLElement) =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-action]')).map((b) => b.dataset.action);

  it('gives an admin every action', () => {
    const c = deskCard(desk, { admin: true, projectName: 'Retail' }, ctx);
    expect(actions(c)).toEqual([
      'png',
      'svg',
      'pdf',
      'print',
      'copy',
      'edit',
      'regenerate',
      'revoke',
    ]);
    expect(c.textContent).toContain('Retail');
    expect(c.textContent).toContain('Italian');
    expect(c.textContent).toContain('English, Spanish');
    expect(c.dataset.deskId).toBe('d1');
  });

  it('gives a member a read-only card: no buttons at all', () => {
    const c = deskCard(desk, { admin: false, projectName: 'Retail' }, ctx);
    expect(actions(c)).toEqual([]);
    expect(c.querySelector('button')).toBeNull();
  });

  it('a revoked desk says so and cannot be revoked again, but can be regenerated', () => {
    const c = deskCard({ ...desk, status: 'revoked' }, { admin: true, projectName: null }, ctx);
    expect(c.textContent).toContain('[live.desks.statusRevoked]');
    expect(actions(c)).not.toContain('revoke');
    expect(actions(c)).toContain('regenerate');
  });

  it('says every language when none is restricted, and tolerates no location or project', () => {
    const c = deskCard(
      { ...desk, languages: [], location_label: null },
      { admin: false, projectName: null },
      ctx,
    );
    expect(c.textContent).toContain('[live.desks.allLanguages]');
    expect(c.textContent).toContain('—');
  });

  it('never carries the printable URL', () => {
    const withUrl = { ...desk, qr_url: 'https://app/secret-token' } as LiveDesk;
    const c = deskCard(withUrl, { admin: true, projectName: 'Retail' }, ctx);
    expect(c.outerHTML).not.toContain('secret-token');
  });
});

describe('waitingItem', () => {
  const g: WaitingGuest = {
    session_id: 's9',
    guest_name: 'Ana',
    guest_lang: 'es',
    waited_secs: 75,
  };

  it('shows who, in what language and how long, with an answer link into the call app', () => {
    const li = waitingItem(g, 'https://app.test/live/desks?answer=s9', ctx);
    expect(li.textContent).toContain('Ana');
    expect(li.textContent).toContain('Spanish');
    expect(li.textContent).toContain('time=1:15');
    const a = li.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://app.test/live/desks?answer=s9');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(li.dataset.sessionId).toBe('s9');
  });

  it('renders a hostile name as text', () => {
    const li = waitingItem({ ...g, guest_name: '<b>x</b>' }, '#', ctx);
    expect(li.querySelector('b')).toBeNull();
  });
});

describe('usageTable', () => {
  it('lists each row with its sessions and credits, and a bar scaled to the busiest', () => {
    const t = usageTable(
      [
        { key: 'a', label: 'Front desk', sessions: 4, credits: 200 },
        { key: 'b', label: 'Back desk', sessions: 1, credits: 50 },
        { key: 'c', label: '', sessions: 0, credits: 0 },
      ],
      'desk',
      ctx,
    );
    const rows = Array.from(t.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Front desk');
    expect(rows[0].textContent).toContain('200');
    const bars = Array.from(t.querySelectorAll<HTMLElement>('[data-bar]')).map(
      (b) => b.dataset.bar,
    );
    expect(bars).toEqual(['100', '25', '0']);
    expect(rows[2].textContent).toContain('—');
    expect(t.querySelector('thead')?.textContent).toContain('[live.usage.col.desk]');
  });
});

describe('openSessionsList', () => {
  it('shows what each open conversation has cost so far, and links to it', () => {
    const ul = openSessionsList(
      [
        {
          session_id: 's1',
          status: 'active',
          desk: 'Front desk',
          started_at: '2026-03-01T10:00:00Z',
          credits: 12,
        },
        { session_id: 's2', status: 'waiting', desk: null, started_at: null, credits: 0 },
      ],
      (id) => `/en/live/detail/?session=${id}`,
      ctx,
    );
    expect(ul.textContent).toContain('Front desk');
    expect(ul.textContent).toContain('credits=12');
    expect(ul.textContent).toContain('[live.sessions.noDesk]');
    expect(ul.querySelectorAll('a')[0].getAttribute('href')).toBe('/en/live/detail/?session=s1');
  });
});
