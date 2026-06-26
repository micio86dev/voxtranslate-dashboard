/**
 * Subscription nudge bar (rendered into #sub-banner on every org-scoped page).
 *
 * Goal: guide B2B users toward buying a plan whenever the active org has no live
 * subscription. It surfaces three states off `OrgSummary.subscription_status`:
 *
 *   none      → never subscribed   → "Buy your first subscription"
 *   past_due  → payment overdue    → "Fix payment" (Billing Portal)
 *   canceled  → expired            → "Reactivate subscription"
 *
 * When the subscription is `active` the bar stays empty. The bar is dismissable;
 * a dismissal is snoozed per (org, state) for SNOOZE_MS so it keeps nudging but
 * isn't naggy within a session — and it always reappears when the state worsens
 * (e.g. active → past_due) because the snooze key includes the state.
 *
 * The actual purchase/portal gating is enforced server-side (subscribe = owner,
 * portal = owner/admin); here we only tailor the call-to-action to the role so a
 * plain member isn't pushed toward an action they can't take.
 */
import { useTranslations, localizePath, type Locale } from '../lib/i18n';
import type { OrgSummary } from '../lib/api';

const SNOOZE_MS = 24 * 60 * 60 * 1000; // re-nudge at most once a day per state
type BannerState = 'none' | 'past_due' | 'canceled';

function snoozeKey(orgId: string, state: BannerState): string {
  return `voxb.subbanner.${orgId}.${state}`;
}

function isSnoozed(orgId: string, state: BannerState): boolean {
  try {
    const ts = parseInt(localStorage.getItem(snoozeKey(orgId, state)) ?? '', 10);
    return Number.isFinite(ts) && Date.now() - ts < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze(orgId: string, state: BannerState): void {
  try {
    localStorage.setItem(snoozeKey(orgId, state), String(Date.now()));
  } catch {
    /* private mode — banner simply reappears next load */
  }
}

/**
 * Per-state visual tone + i18n key prefix + whether it's a payment-fix flow.
 * `bar` holds COMPLETE class strings (not interpolated) so Tailwind's source
 * scanner generates them — `bg-${tone}` would silently produce no CSS.
 */
const STATES: Record<BannerState, { bar: string; key: string; portal: boolean }> = {
  none: { bar: 'border-brand/30 bg-brand/10 text-brand', key: 'banner.none', portal: false },
  past_due: { bar: 'border-warn/30 bg-warn/10 text-warn', key: 'banner.pastDue', portal: true },
  canceled: {
    bar: 'border-danger/30 bg-danger/10 text-danger',
    key: 'banner.canceled',
    portal: false,
  },
};

function alertIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('mt-0.5', 'shrink-0');
  for (const d of [
    'M12 9v4',
    'M12 17h.01',
    'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  ]) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * Render (or clear) the subscription bar for the active org. Safe to call on any
 * chrome page — it no-ops when the host element is absent or the org is active.
 */
export function renderSubBanner(org: OrgSummary, lang: Locale): void {
  const host = document.getElementById('sub-banner');
  if (!host) return;
  host.replaceChildren();

  const status = org.subscription_status;
  if (status !== 'none' && status !== 'past_due' && status !== 'canceled') return;
  const state: BannerState = status;
  if (isSnoozed(org.id, state)) return;

  const t = useTranslations(lang);
  const cfg = STATES[state];
  const isOwner = org.role === 'owner';
  const isAdmin = org.role === 'admin';
  // Who can act on this state: payment fixes need the portal (owner/admin),
  // (re)subscribing needs the owner. Everyone else just gets the explainer.
  const canAct = cfg.portal ? isOwner || isAdmin : isOwner;

  // Outer tinted bar.
  const bar = document.createElement('div');
  bar.className = `border-b ${cfg.bar}`;
  const row = document.createElement('div');
  row.className = 'mx-auto flex w-full max-w-5xl items-start gap-3 px-4 py-3';
  bar.appendChild(row);

  row.appendChild(alertIcon());

  const copy = document.createElement('div');
  copy.className = 'min-w-0 flex-1';
  const title = document.createElement('p');
  title.className = 'text-sm font-semibold text-ink';
  title.textContent = t(`${cfg.key}.title`);
  const body = document.createElement('p');
  body.className = 'mt-0.5 text-sm text-muted';
  body.textContent = canAct
    ? t(`${cfg.key}.body`)
    : `${t(`${cfg.key}.body`)} ${t('banner.memberNote')}`;
  copy.append(title, body);
  row.appendChild(copy);

  const actions = document.createElement('div');
  actions.className = 'flex shrink-0 items-center gap-1.5';

  // Primary CTA → the Credits page, where the plan comparison + checkout live.
  // The #plans anchor lands the user on the comparison; payment fixes that have a
  // portal jump straight to the page where "Manage subscription" is shown.
  const cta = document.createElement('a');
  cta.href = localizePath(lang, 'credits') + (cfg.portal ? '' : '#plans');
  cta.className = 'btn-primary text-sm';
  cta.textContent = canAct ? t(`${cfg.key}.cta`) : t('banner.viewPlans');
  actions.appendChild(cta);

  // Dismiss (×). Snoozes this exact state so a worse state still breaks through.
  const close = document.createElement('button');
  close.type = 'button';
  // NB: not `text-base` — `--color-base` makes that a (background-)color utility in
  // Tailwind v4, which would override btn-ghost's text-ink. `text-lg` is size-only.
  close.className = 'btn-ghost px-2.5 py-2 text-lg leading-none';
  close.setAttribute('aria-label', t('banner.dismiss'));
  close.textContent = '×';
  close.addEventListener('click', () => {
    snooze(org.id, state);
    host.replaceChildren();
  });
  actions.appendChild(close);

  row.appendChild(actions);
  host.appendChild(bar);
}
