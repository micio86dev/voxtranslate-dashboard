/**
 * Shared client bootstrap for org-scoped pages (dashboard, members, projects).
 *
 * Gates on auth, loads the caller's orgs, resolves the active org (persisted),
 * wires the header's org switcher + sign-out, and returns the context. Returns
 * `null` when it has redirected (no session, expired token, or no org yet) — so
 * callers should bail when it returns null.
 */
import { getUser, logout, requireAuth, type User } from '../lib/auth';
import { currentOrgId, listOrgs, setCurrentOrgId, type OrgSummary } from '../lib/api';
import { type Locale } from '../lib/i18n';

export interface AppCtx {
  user: User | null;
  orgs: OrgSummary[];
  activeOrg: OrgSummary;
  lang: Locale;
}

function pageLang(): Locale {
  return (document.documentElement.lang || 'en') as Locale;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c;
  });
}

export async function boot(): Promise<AppCtx | null> {
  const lang = pageLang();
  if (!requireAuth(lang)) return null;

  document.getElementById('signout')?.addEventListener('click', () => logout(`/${lang}/`));

  const res = await listOrgs();
  if (res.status === 401) {
    logout(`/${lang}/`);
    return null;
  }
  const orgs = res.data ?? [];
  if (orgs.length === 0) {
    location.href = `/${lang}/onboarding/`;
    return null;
  }

  let activeId = currentOrgId();
  if (!activeId || !orgs.some((o) => o.id === activeId)) {
    activeId = orgs[0].id;
    setCurrentOrgId(activeId);
  }
  const activeOrg = orgs.find((o) => o.id === activeId)!;

  const sw = document.getElementById('org-switcher') as HTMLSelectElement | null;
  if (sw) {
    sw.innerHTML = orgs.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('');
    sw.value = activeId;
    sw.hidden = orgs.length < 2 ? true : false;
    sw.addEventListener('change', () => {
      setCurrentOrgId(sw.value);
      location.reload();
    });
  }

  return { user: getUser(), orgs, activeOrg, lang };
}
