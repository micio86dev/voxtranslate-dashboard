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

/** OAuth scopes requested at login — includes Calendar so the server can schedule
 *  meetings on the user's behalf. Keep in sync with the server's GOOGLE_CALENDAR_SCOPES. */
const OAUTH_SCOPE = 'openid email profile https://www.googleapis.com/auth/calendar.events';

/**
 * Exchange an OAuth authorization code for our session JWT. The popup code flow uses
 * the magic `postmessage` redirect_uri; the server exchanges the code for an id_token
 * + access/refresh tokens (Calendar access). Returns the user or null.
 */
export async function exchangeGoogleCode(code: string): Promise<User | null> {
  try {
    // The locale the B2B user is signing in with (URL's `[lang]` segment) is stored
    // on their account so meeting notifications reach them in their own language.
    const locale = location.pathname.split('/').filter(Boolean)[0] || 'en';
    const res = await fetch(`${API_BASE}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: 'postmessage', locale }),
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

// --- Google Identity Services (OAuth code flow) ------------------------------

interface CodeClient {
  requestCode: () => void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initCodeClient: (cfg: {
            client_id: string;
            scope: string;
            ux_mode?: 'popup' | 'redirect';
            callback: (resp: { code?: string; error?: string }) => void;
          }) => CodeClient;
        };
      };
    };
  }
}

/**
 * Render a "Sign in with Google" button into `el` that runs the OAuth **code** flow
 * (popup) and calls `onSignedIn` once the code has been exchanged for our session.
 * Loads the GSI script on demand. Note: the OAuth consent screen must list the
 * Calendar scope and the OAuth client must allow this origin.
 */
export function renderGoogleButton(el: HTMLElement, onSignedIn: (user: User) => void): void {
  if (!GOOGLE_CLIENT_ID) {
    el.textContent = 'Google sign-in is not configured (PUBLIC_GOOGLE_CLIENT_ID).';
    return;
  }
  const mount = () => {
    const g = window.google;
    if (!g) return;
    const codeClient = g.accounts.oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: OAUTH_SCOPE,
      ux_mode: 'popup',
      callback: (resp) => {
        if (!resp.code) {
          el.dispatchEvent(new CustomEvent('vox-login-error', { bubbles: true }));
          return;
        }
        void exchangeGoogleCode(resp.code).then((user) => {
          if (user) onSignedIn(user);
          else el.dispatchEvent(new CustomEvent('vox-login-error', { bubbles: true }));
        });
      },
    });
    // Google-branded sign-in button (light theme), per Google's branding guidelines:
    // white background, the official 4-colour "G" mark, and the "Sign in with Google"
    // wording. Required to pass OAuth brand verification.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Sign in with Google');
    btn.className =
      'inline-flex items-center gap-3 rounded-lg border border-[#dadce0] bg-white px-4 py-2.5 text-sm font-medium text-[#3c4043] shadow-sm transition hover:bg-[#f8f9fa]';
    btn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">' +
      '<path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>' +
      '<path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>' +
      '<path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>' +
      '<path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>' +
      '</svg><span>Sign in with Google</span>';
    btn.addEventListener('click', () => codeClient.requestCode());
    el.replaceChildren(btn);
  };
  if (window.google) {
    mount();
    return;
  }
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.defer = true;
  s.onload = mount;
  document.head.appendChild(s);
}
