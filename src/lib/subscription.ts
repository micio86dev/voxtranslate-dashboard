/**
 * The one client-side definition of "this subscription is live right now".
 *
 * It mirrors the server's gate (`business::credits::SUBSCRIPTION_ACTIVE_SQL`)
 * deliberately: status AND an unexpired period. Status alone is not enough,
 * because a subscription can lapse by DATE with nothing to update the row — an
 * admin-gifted plan has no Stripe behind it, so no webhook ever flips it to
 * 'canceled' and it keeps reading 'active' months after it ended.
 *
 * Anywhere the UI decides "does this org have a plan?", it asks this.
 */
export function isSubscriptionLive(
  status: string,
  currentPeriodEnd: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (status !== 'active') return false;
  if (!currentPeriodEnd) return true; // open-ended period — nothing to expire
  const end = Date.parse(currentPeriodEnd);
  // An unparseable date must not silently grant access.
  if (Number.isNaN(end)) return false;
  return end > now.getTime();
}

/** The two billing routes a subscription screen can offer. */
export interface SubscriptionActions {
  /** Open the Stripe Billing Portal — update the card, switch or cancel a plan. */
  canManage: boolean;
  /** Start a new subscription through checkout. */
  canSubscribe: boolean;
}

/**
 * Which billing routes to offer this organization.
 *
 * Both answers used to be inferred from `subscription_status`, which lies: a
 * gifted subscription has no Stripe behind it, so nothing ever cancels it and
 * the row reads 'active' long after the period ended. That left the page
 * offering the Billing Portal — which 409s without a customer — while hiding the
 * one button that would have let the user subscribe. A dead end, on the screen
 * whose entire job is taking money.
 *
 * So ask the two questions directly, because they are genuinely independent:
 * the portal needs a Stripe CUSTOMER, and checkout needs there to be no LIVE
 * subscription. An org can satisfy both (a lapsed Stripe plan: update the card,
 * or start a new one) or neither.
 */
export function subscriptionActions(org: {
  subscription_active: boolean;
  has_stripe_customer: boolean;
}): SubscriptionActions {
  return {
    canManage: org.has_stripe_customer,
    canSubscribe: !org.subscription_active,
  };
}

/**
 * When a subscription is scheduled to stop — or `null` if it is simply renewing.
 *
 * Stripe expresses "this is ending" in more than one way, and has moved which
 * one it populates: the `cancel_at_period_end` flag, an explicit `cancel_at`
 * timestamp, or `canceled_at` once it is over. Reading only the flag meant a
 * customer who had just cancelled was told **"Renews on 07/10/2026"** — the
 * flag came back absent, the code found nothing to object to, and fell through
 * to the reassuring branch.
 *
 * That is the third field Stripe has relocated under this codebase (the
 * subscription link on an invoice, then the price id, now this). The lesson is
 * the same every time: check every place the answer can live, and let the
 * absence of one signal mean nothing rather than mean "no".
 *
 * Returns the most specific date available: an explicit cancellation date beats
 * the end of the paid period, because a cancellation can be scheduled earlier.
 */
export function subscriptionEnding(sub: {
  status: string;
  cancel_at_period_end?: boolean;
  current_period_end?: string | null;
  cancel_at?: string | null;
  canceled_at?: string | null;
}): string | null {
  const ending = sub.status === 'canceled' || sub.cancel_at_period_end === true || !!sub.cancel_at;
  if (!ending) return null;
  return sub.canceled_at ?? sub.cancel_at ?? sub.current_period_end ?? null;
}
