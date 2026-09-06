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
