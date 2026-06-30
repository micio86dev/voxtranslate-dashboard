import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderSubBanner } from './sub-banner';
import type { OrgSummary } from '../lib/api';

function org(over: Partial<OrgSummary> = {}): OrgSummary {
  return {
    id: 'o1',
    name: 'Acme',
    slug: 'acme',
    plan: 'business',
    subscription_status: 'none',
    credits_balance: 0,
    role: 'owner',
    ...over,
  };
}

function host(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'sub-banner';
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderSubBanner', () => {
  it('no-ops when the host element is absent', () => {
    expect(() => renderSubBanner(org(), 'en')).not.toThrow();
  });

  it('clears the host and shows nothing for an active subscription', () => {
    const el = host();
    el.innerHTML = '<span>stale</span>';
    renderSubBanner(org({ subscription_status: 'active' }), 'en');
    expect(el.children).toHaveLength(0);
  });

  it('renders the "none" nudge for an owner with a CTA to #plans', () => {
    const el = host();
    renderSubBanner(org({ subscription_status: 'none', role: 'owner' }), 'en');
    expect(el.querySelector('p.font-semibold')?.textContent).toBeTruthy();
    const cta = el.querySelector('a');
    expect(cta?.getAttribute('href')).toBe('/en/credits/#plans');
    // owner can act → no member note
    expect(el.textContent).not.toContain('Ask the workspace owner');
  });

  it('renders the past_due nudge with a portal CTA (no #plans anchor)', () => {
    const el = host();
    renderSubBanner(org({ subscription_status: 'past_due', role: 'admin' }), 'en');
    const cta = el.querySelector('a');
    expect(cta?.getAttribute('href')).toBe('/en/credits/');
  });

  it('renders the canceled nudge', () => {
    const el = host();
    renderSubBanner(org({ subscription_status: 'canceled', role: 'owner' }), 'en');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/en/credits/#plans');
  });

  it('shows the member note + "view plans" CTA when the user cannot act', () => {
    const el = host();
    renderSubBanner(org({ subscription_status: 'none', role: 'member' }), 'en');
    expect(el.textContent).toContain('Ask the workspace owner');
    // member sees the neutral "Compare plans" CTA, not the owner CTA
    expect(el.querySelector('a')?.textContent).toBe('Compare plans');
  });

  it('a member cannot use the portal for past_due either', () => {
    const el = host();
    renderSubBanner(org({ subscription_status: 'past_due', role: 'member' }), 'en');
    expect(el.textContent).toContain('Ask the workspace owner');
  });

  it('dismiss snoozes the state and clears the bar; stays hidden on re-render', () => {
    const el = host();
    renderSubBanner(org({ subscription_status: 'none' }), 'en');
    const close = el.querySelector('button[aria-label]') as HTMLButtonElement;
    expect(close).toBeTruthy();
    close.click();
    expect(el.children).toHaveLength(0);
    // re-rendering the same state is snoozed → still empty
    renderSubBanner(org({ subscription_status: 'none' }), 'en');
    expect(el.children).toHaveLength(0);
  });

  it('a worse state breaks through an existing snooze (per-state key)', () => {
    const el = host();
    // snooze "none"
    renderSubBanner(org({ subscription_status: 'none' }), 'en');
    (el.querySelector('button[aria-label]') as HTMLButtonElement).click();
    // a different state is not snoozed → it renders
    renderSubBanner(org({ subscription_status: 'past_due' }), 'en');
    expect(el.children.length).toBeGreaterThan(0);
  });

  it('treats an unparseable snooze timestamp as not snoozed', () => {
    localStorage.setItem('voxb.subbanner.o1.none', 'not-a-number');
    const el = host();
    renderSubBanner(org({ subscription_status: 'none' }), 'en');
    expect(el.children.length).toBeGreaterThan(0);
  });

  it('survives a throwing localStorage (private mode) without crashing', () => {
    const el = host();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => renderSubBanner(org({ subscription_status: 'none' }), 'en')).not.toThrow();
    // banner still renders (isSnoozed swallowed the error → false)
    expect(el.children.length).toBeGreaterThan(0);
    // dismiss path also swallows the setItem error
    expect(() =>
      (el.querySelector('button[aria-label]') as HTMLButtonElement).click(),
    ).not.toThrow();
  });
});
