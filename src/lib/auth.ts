/**
 * Client-side auth for the dashboard (separate origin from the consumer app, so
 * its own token). Sign in with Google → POST /api/auth/google → JWT in
 * localStorage. The dashboard is static, so route guarding is client-side.
 */

export const API_BASE = (import.meta.env.PUBLIC_API_BASE || 'http://localhost:3001').replace(
  /\/+$/,
  '',
);
export const GOOGLE_CLIENT_ID = import.meta.env.PUBLIC_GOOGLE_CLIENT_ID || '';

const TOKEN_KEY = 'voxb.token';
const USER_KEY = 'voxb.user';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string | null;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function setSession(token: string, user: User): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* private mode — session won't persist, but the page still works this load */
  }
}

export function logout(redirectTo = '/'): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
  location.href = redirectTo;
}

/** Redirect to the login page (locale-aware) if there's no session. */
export function requireAuth(lang: string): boolean {
  if (isLoggedIn()) return true;
  const next = encodeURIComponent(location.pathname + location.search);
  location.href = `/${lang}/?next=${next}`;
  return false;
}

/** Exchange a Google credential for our session JWT. Returns the user or null. */
export async function loginWithGoogle(credential: string): Promise<User | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { token: string; user: User };
    if (!data.token || !data.user) return null;
    setSession(data.token, data.user);
    return data.user;
  } catch {
    return null;
  }
}

// --- Google Identity Services ------------------------------------------------

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: {
            client_id: string;
            callback: (resp: { credential: string }) => void;
          }) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

/**
 * Render the Google Sign-In button into `el` and call `onSignedIn` once the
 * credential has been exchanged for our session. Loads the GSI script on demand.
 */
export function renderGoogleButton(el: HTMLElement, onSignedIn: (user: User) => void): void {
  if (!GOOGLE_CLIENT_ID) {
    el.textContent = 'Google sign-in is not configured (PUBLIC_GOOGLE_CLIENT_ID).';
    return;
  }
  const start = () => {
    const g = window.google;
    if (!g) return;
    g.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (resp) => {
        void loginWithGoogle(resp.credential).then((user) => {
          if (user) onSignedIn(user);
          else el.dispatchEvent(new CustomEvent('vox-login-error', { bubbles: true }));
        });
      },
    });
    g.accounts.id.renderButton(el, { theme: 'outline', size: 'large', width: 280 });
  };
  if (window.google) {
    start();
    return;
  }
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.defer = true;
  s.onload = start;
  document.head.appendChild(s);
}
