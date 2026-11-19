/** The Live Connect tab bar: what each role gets to see. */
import { isAdminRole } from './format';

/** Usage is money: only owners and admins have the tab (the server refuses everyone else). */
export function applyLiveNav(role: string | undefined, root: ParentNode = document): void {
  root.querySelector('[data-live-tab="usage"]')?.classList.toggle('hidden', !isAdminRole(role));
}
