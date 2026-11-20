/**
 * DOM builders for the Live Connect pages. Pure: data in, elements out; the pages own fetching,
 * timers and events. Every dynamic string is set as text (see `dom.ts`), so a guest named
 * `<img onerror=…>` is just a name.
 */
import type {
  LiveDesk,
  LiveOpenSession,
  LiveParticipant,
  LiveSessionRow,
  LiveTimelineEvent,
  LiveUsageRow,
  LiveUtterance,
  WaitingGuest,
} from '../../lib/api';
import { formatDuration } from '../phone-dialer';
import { barPercents } from './bars';
import { h } from './dom';
import { endReasonKey, langName, statusKey } from './format';
import { formatWaited } from './waiting';

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface RenderCtx {
  t: Translate;
  /** The viewer's language (UI locale). */
  lang: string;
}

const DASH = '—';

const when = (iso: string | null | undefined, lang: string): string =>
  iso ? new Date(iso).toLocaleString(lang) : DASH;

/** A rounded status pill. The state is in the words, not only the colour. */
export function statusBadge(status: string, ctx: RenderCtx): HTMLElement {
  const tone =
    status === 'active'
      ? 'border-ok text-ok'
      : status === 'waiting'
        ? 'border-warn text-warn'
        : 'border-line text-muted';
  return h('span', { class: `badge ${tone}`, 'data-status': status }, ctx.t(statusKey(status)));
}

/** "Front desk" and, beneath it, the location. */
function deskCell(desk: LiveSessionRow['desk'], t: Translate): Node {
  if (!desk) return h('span', { class: 'text-muted' }, t('live.sessions.noDesk'));
  return h(
    'div',
    {},
    h('div', { class: 'font-medium' }, desk.name ?? DASH),
    desk.location_label ? h('div', { class: 'text-xs text-muted' }, desk.location_label) : null,
  );
}

/** One row of the sessions table. `href` opens the conversation. */
export function sessionRow(row: LiveSessionRow, ctx: RenderCtx, href: string): HTMLTableRowElement {
  const { t, lang } = ctx;
  const td = (...c: (Node | string | null)[]) => h('td', { class: 'px-4 py-3' }, ...c);
  const guestLang = row.guest.lang ? langName(row.guest.lang, lang) : '';
  return h(
    'tr',
    { class: 'border-b border-line last:border-0', 'data-session-id': row.id },
    td(statusBadge(row.status, ctx)),
    td(deskCell(row.desk, t)),
    td(row.project?.name ?? DASH),
    td(
      h('div', { class: 'font-medium' }, row.guest.name ?? DASH),
      guestLang ? h('div', { class: 'text-xs text-muted' }, guestLang) : null,
    ),
    td(row.staff_name ?? DASH),
    h('td', { class: 'px-4 py-3 text-muted' }, when(row.started_at ?? row.created_at, lang)),
    td(formatDuration(row.duration_secs)),
    td(String(row.credits)),
    td(row.has_transcript ? t('live.sessions.yes') : t('live.sessions.no')),
    h(
      'td',
      { class: 'px-4 py-3 text-right' },
      h('a', { href, class: 'btn-ghost text-xs' }, t('live.sessions.open')),
    ),
  );
}

/** Label/value facts of one conversation (project, desk, status, end reason, duration, credits). */
export function sessionFacts(row: LiveSessionRow, ctx: RenderCtx): HTMLElement {
  const { t, lang } = ctx;
  const reasonKey = endReasonKey(row.end_reason);
  const facts: [string, Node | string][] = [
    [t('live.detail.status'), statusBadge(row.status, ctx)],
    [t('live.detail.project'), row.project?.name ?? DASH],
    [
      t('live.detail.desk'),
      row.desk
        ? [row.desk.name, row.desk.location_label].filter(Boolean).join(' · ') || DASH
        : t('live.sessions.noDesk'),
    ],
    [t('live.detail.started'), when(row.started_at ?? row.created_at, lang)],
    [t('live.detail.duration'), formatDuration(row.duration_secs)],
    [t('live.detail.credits'), String(row.credits)],
  ];
  if (reasonKey) facts.push([t('live.detail.endReason'), t(reasonKey)]);
  return h(
    'dl',
    { class: 'grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3' },
    ...facts.map(([k, v]) =>
      h(
        'div',
        {},
        h('dt', { class: 'text-xs text-muted' }, k),
        h('dd', { class: 'mt-0.5 text-sm' }, v),
      ),
    ),
  );
}

/** The two people in the conversation, each with their language and their colour. */
export function participantsList(
  participants: LiveParticipant[],
  side: (id: string, name: string) => 0 | 1,
  ctx: RenderCtx,
): HTMLElement {
  const { t, lang } = ctx;
  return h(
    'ul',
    { class: 'flex flex-wrap gap-3', 'aria-label': t('live.detail.participants') },
    ...participants.map((p) =>
      h(
        'li',
        { class: `badge ${SIDE_CLASS[side(p.peer_id, p.display_name)].badge}` },
        `${p.display_name} · ${t(`live.role.${['host', 'guest', 'staff'].includes(p.role) ? p.role : 'other'}`)} · ${langName(p.lang, lang)}`,
      ),
    ),
  );
}

const SIDE_CLASS = [
  { badge: 'border-brand text-brand', name: 'text-brand', bar: 'border-brand' },
  { badge: 'border-warn text-warn', name: 'text-warn', bar: 'border-warn' },
] as const;

/**
 * One line of the transcript. The original is always shown, as spoken; a translation sits
 * beneath it, labelled with its language, never in its place.
 */
export function utteranceItem(
  u: LiveUtterance,
  sideIndex: 0 | 1,
  translationLang: string,
  ctx: RenderCtx,
): HTMLElement {
  const { t, lang } = ctx;
  const style = SIDE_CLASS[sideIndex];
  const showTranslation = Boolean(translationLang);
  const translation = showTranslation
    ? u.translation
      ? h(
          'p',
          { class: 'mt-1 text-sm text-muted', lang: translationLang, 'data-part': 'translation' },
          h('span', { class: 'mr-1 text-xs uppercase' }, `${langName(translationLang, lang)}:`),
          u.translation,
        )
      : u.original_lang.toLowerCase() === translationLang.toLowerCase()
        ? null
        : h(
            'p',
            { class: 'mt-1 text-xs italic text-muted', 'data-part': 'translation-missing' },
            t('live.detail.noTranslation'),
          )
    : null;
  return h(
    'li',
    { class: `border-l-4 ${style.bar} py-1 pl-3`, 'data-side': sideIndex },
    h(
      'div',
      { class: 'flex flex-wrap items-baseline gap-2 text-xs text-muted' },
      h('span', { class: `font-semibold ${style.name}` }, u.speaker_name),
      h(
        'time',
        { datetime: u.at },
        formatDuration(u.offset_ms == null ? null : u.offset_ms / 1000),
      ),
      h('span', { class: 'uppercase' }, u.original_lang),
    ),
    h('p', { class: 'text-sm', lang: u.original_lang, 'data-part': 'original' }, u.original),
    translation,
  );
}

/** Admin-only diagnostic timeline of how the call went. */
export function timelineList(events: LiveTimelineEvent[], ctx: RenderCtx): HTMLElement {
  return h(
    'ol',
    { class: 'space-y-1 text-xs' },
    ...events.map((e) =>
      h(
        'li',
        { class: 'flex flex-wrap gap-2' },
        h('time', { class: 'text-muted', datetime: e.at }, when(e.at, ctx.lang)),
        h('code', {}, e.kind),
      ),
    ),
  );
}

export interface DeskCardOpts {
  admin: boolean;
  projectName: string | null;
}

/** A desk in the management list. Admin controls exist only for admins; the server enforces it too. */
export function deskCard(desk: LiveDesk, opts: DeskCardOpts, ctx: RenderCtx): HTMLElement {
  const { t, lang } = ctx;
  const revoked = desk.status === 'revoked';
  const btn = (action: string, label: string, cls = 'btn-ghost') =>
    h('button', { type: 'button', class: `${cls} text-xs`, 'data-action': action }, label);
  const langs = desk.languages.length
    ? desk.languages.map((l) => langName(l, lang)).join(', ')
    : t('live.desks.allLanguages');
  return h(
    'article',
    { class: 'card', 'data-desk-id': desk.id, 'data-desk-status': desk.status },
    h(
      'div',
      { class: 'flex flex-wrap items-start justify-between gap-2' },
      h(
        'div',
        {},
        h('h3', { class: 'text-lg font-semibold' }, desk.name),
        desk.location_label ? h('p', { class: 'text-sm text-muted' }, desk.location_label) : null,
      ),
      h(
        'span',
        { class: `badge ${revoked ? 'border-danger text-danger' : 'border-ok text-ok'}` },
        t(revoked ? 'live.desks.statusRevoked' : 'live.desks.statusActive'),
      ),
    ),
    h(
      'dl',
      { class: 'mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3' },
      h(
        'div',
        {},
        h('dt', { class: 'text-xs text-muted' }, t('live.desks.project')),
        h('dd', {}, opts.projectName ?? DASH),
      ),
      h(
        'div',
        {},
        h('dt', { class: 'text-xs text-muted' }, t('live.desks.defaultLang')),
        h('dd', {}, langName(desk.default_lang, lang)),
      ),
      h(
        'div',
        {},
        h('dt', { class: 'text-xs text-muted' }, t('live.desks.languages')),
        h('dd', {}, langs),
      ),
    ),
    opts.admin
      ? h(
          'div',
          { class: 'mt-4 flex flex-wrap gap-2' },
          btn('png', t('live.desks.downloadPng')),
          btn('svg', t('live.desks.downloadSvg')),
          btn('pdf', t('live.desks.downloadPdf')),
          btn('print', t('live.desks.print')),
          btn('copy', t('live.desks.copyLink')),
          btn('edit', t('live.desks.edit')),
          btn('regenerate', t('live.desks.regenerate')),
          revoked ? null : btn('revoke', t('live.desks.revoke'), 'btn-danger'),
        )
      : null,
  );
}

/** One waiting customer, with the way to answer them. */
export function waitingItem(g: WaitingGuest, answerHref: string, ctx: RenderCtx): HTMLElement {
  const { t, lang } = ctx;
  return h(
    'li',
    {
      class:
        'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2',
      'data-session-id': g.session_id,
    },
    h(
      'div',
      {},
      h('div', { class: 'font-medium' }, g.guest_name),
      h(
        'div',
        { class: 'text-xs text-muted' },
        `${langName(g.guest_lang, lang)} · ${t('live.console.waited', { time: formatWaited(g.waited_secs) })}`,
      ),
    ),
    h(
      'a',
      {
        href: answerHref,
        target: '_blank',
        rel: 'noopener noreferrer',
        class: 'btn-primary text-xs',
      },
      t('live.console.answer'),
    ),
  );
}

/** Usage grouped by desk / project / day, each row with a CSS bar scaled to the busiest. */
export function usageTable(rows: LiveUsageRow[], group: string, ctx: RenderCtx): HTMLTableElement {
  const { t } = ctx;
  const widths = barPercents(rows.map((r) => r.credits));
  return h(
    'table',
    { class: 'w-full text-sm' },
    h(
      'thead',
      { class: 'border-b border-line text-left text-muted' },
      h(
        'tr',
        {},
        h('th', { class: 'px-4 py-3' }, t(`live.usage.col.${group}`)),
        h('th', { class: 'px-4 py-3 text-right' }, t('live.usage.col.sessions')),
        h('th', { class: 'px-4 py-3 text-right' }, t('live.usage.col.credits')),
        h(
          'th',
          { class: 'w-1/3 px-4 py-3' },
          h('span', { class: 'sr-only' }, t('live.usage.col.share')),
        ),
      ),
    ),
    h(
      'tbody',
      {},
      ...rows.map((r, i) =>
        h(
          'tr',
          { class: 'border-b border-line last:border-0' },
          h('td', { class: 'px-4 py-3' }, r.label || DASH),
          h('td', { class: 'px-4 py-3 text-right tabular-nums' }, String(r.sessions)),
          h('td', { class: 'px-4 py-3 text-right tabular-nums' }, String(r.credits)),
          h(
            'td',
            { class: 'px-4 py-3' },
            h(
              'div',
              { class: 'h-2 w-full rounded-full bg-base', 'aria-hidden': 'true' },
              h('div', {
                class: 'h-2 rounded-full bg-brand',
                style: `width:${widths[i]}%`,
                'data-bar': widths[i],
              }),
            ),
          ),
        ),
      ),
    ),
  );
}

/** Conversations open right now and what they have cost so far. */
export function openSessionsList(
  list: LiveOpenSession[],
  detailHref: (id: string) => string,
  ctx: RenderCtx,
): HTMLElement {
  const { t, lang } = ctx;
  return h(
    'ul',
    { class: 'divide-y divide-line text-sm' },
    ...list.map((s) =>
      h(
        'li',
        {
          class: 'flex flex-wrap items-center justify-between gap-2 py-2',
          'data-session-id': s.session_id,
        },
        h(
          'div',
          { class: 'flex flex-wrap items-center gap-2' },
          statusBadge(s.status, ctx),
          h('span', {}, s.desk ?? t('live.sessions.noDesk')),
          h('span', { class: 'text-xs text-muted' }, when(s.started_at, lang)),
        ),
        h(
          'div',
          { class: 'flex items-center gap-3' },
          h('span', { class: 'tabular-nums' }, t('live.usage.soFar', { credits: s.credits })),
          h(
            'a',
            { href: detailHref(s.session_id), class: 'text-brand underline' },
            t('live.sessions.open'),
          ),
        ),
      ),
    ),
  );
}
