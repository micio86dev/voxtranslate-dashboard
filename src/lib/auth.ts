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
    const res = await fetch(`${API_BASE}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: 'postmessage' }),
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
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-primary';
    btn.textContent = 'Sign in with Google';
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
