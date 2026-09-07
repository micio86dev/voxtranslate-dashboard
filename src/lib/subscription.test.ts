import { describe, it, expect } from 'vitest';
import { isSubscriptionLive, subscriptionActions, subscriptionEnding } from './subscription';

const NOW = new Date('2026-09-06T12:00:00Z');

describe('isSubscriptionLive', () => {
  it('is live while the paid period is still running', () => {
    expect(isSubscriptionLive('active', '2026-10-01T00:00:00Z', NOW)).toBe(true);
  });

  // The case that started this: a gifted plan whose period ran out on 29 Aug.
  // Nothing updates the row, so the status still reads 'active' — and the
  // dashboard believed it, showing a live plan to an org the server had already
  // cut off.
  it('is NOT live once the period has passed, whatever the status says', () => {
    expect(isSubscriptionLive('active', '2026-08-29T00:00:00Z', NOW)).toBe(false);
  });

  it('treats an open-ended period as live', () => {
    expect(isSubscriptionLive('active', null, NOW)).toBe(true);
    expect(isSubscriptionLive('active', undefined, NOW)).toBe(true);
  });

  it('is never live for a non-active status', () => {
    for (const st of ['none', 'past_due', 'canceled', 'incomplete']) {
      expect(isSubscriptionLive(st, '2026-10-01T00:00:00Z', NOW)).toBe(false);
    }
  });

  it('denies rather than grants when the date cannot be read', () => {
    expect(isSubscriptionLive('active', 'not-a-date', NOW)).toBe(false);
  });
});

describe('subscriptionActions', () => {
  const org = (over: Partial<Parameters<typeof subscriptionActions>[0]> = {}) => ({
    subscription_active: false,
    has_stripe_customer: false,
    ...over,
  });

  // The dead end this exists to prevent: a gifted subscription reads 'active'
  // forever because no Stripe webhook ever cancels it. Inferring both actions
  // from that status offered the Billing Portal — which 409s without a customer
  // — AND hid the button that would have let the user subscribe.
  it('routes a lapsed gifted subscription to checkout, not the portal', () => {
    const a = subscriptionActions(org({ subscription_active: false, has_stripe_customer: false }));
    expect(a.canSubscribe).toBe(true);
    expect(a.canManage).toBe(false);
  });

  it('routes a live subscription to the portal, not a second checkout', () => {
    const a = subscriptionActions(org({ subscription_active: true, has_stripe_customer: true }));
    expect(a.canSubscribe).toBe(false);
    expect(a.canManage).toBe(true);
  });

  // A Stripe subscription that lapsed still has a customer: both routes are
  // legitimate — update the card in the portal, or start a new plan.
  it('offers both when Stripe knows them but nothing is live', () => {
    const a = subscriptionActions(org({ subscription_active: false, has_stripe_customer: true }));
    expect(a.canSubscribe).toBe(true);
    expect(a.canManage).toBe(true);
  });

  it('never offers the portal to an org Stripe has never seen', () => {
    for (const active of [true, false]) {
      expect(subscriptionActions(org({ subscription_active: active })).canManage).toBe(false);
    }
  });
});

describe('subscriptionEnding', () => {
  const sub = (over: Record<string, unknown> = {}) =>
    ({
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: '2026-10-07T00:00:00Z',
      ...over,
    }) as Parameters<typeof subscriptionEnding>[0];

  it('says nothing about a subscription that is simply renewing', () => {
    expect(subscriptionEnding(sub())).toBeNull();
  });

  it('reports the end date when Stripe sets cancel_at_period_end', () => {
    expect(subscriptionEnding(sub({ cancel_at_period_end: true }))).toBe('2026-10-07T00:00:00Z');
  });

  // The bug this exists for: a cancellation came back with `cancel_at` set and
  // `cancel_at_period_end` absent, so the page read only the flag it knew, found
  // nothing, and cheerfully announced "Renews on 07/10/2026" to a customer who
  // had just cancelled. Stripe has moved three separate fields on us now; read
  // every place the answer can live.
  it('reports it from cancel_at when the flag is missing entirely', () => {
    const s = sub({ cancel_at_period_end: undefined, cancel_at: '2026-10-07T00:00:00Z' });
    expect(subscriptionEnding(s)).toBe('2026-10-07T00:00:00Z');
  });

  it('prefers the explicit cancel date over the period end', () => {
    const s = sub({ cancel_at_period_end: true, cancel_at: '2026-09-30T00:00:00Z' });
    expect(subscriptionEnding(s)).toBe('2026-09-30T00:00:00Z');
  });

  it('reports an already-cancelled subscription from canceled_at', () => {
    const s = sub({ status: 'canceled', canceled_at: '2026-08-29T00:00:00Z' });
    expect(subscriptionEnding(s)).toBe('2026-08-29T00:00:00Z');
  });
});
