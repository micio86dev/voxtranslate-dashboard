import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getToken,
  getUser,
  isLoggedIn,
  authHeaders,
  logout,
  requireAuth,
  exchangeGoogleCode,
  renderGoogleButton,
  type User,
} from './auth';

const USER: User = { id: 'u1', email: 'a@b.co', name: 'Ann', avatar_url: null };

/** Replace window.location with a writable stub so href assignment doesn't navigate. */
function stubLocation(pathname = '/en/dashboard/', search = '') {
  const loc = { href: '', pathname, search, reload: vi.fn() };
  Object.defineProperty(window, 'location', { value: loc, writable: true, configurable: true });
  return loc;
}

beforeEach(() => {
  localStorage.clear();
  stubLocation();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('session getters', () => {
  it('getToken returns null when unset, the value when set', () => {
    expect(getToken()).toBeNull();
    localStorage.setItem('voxb.token', 'jwt123');
    expect(getToken()).toBe('jwt123');
  });

  it('isLoggedIn reflects the token presence', () => {
    expect(isLoggedIn()).toBe(false);
    localStorage.setItem('voxb.token', 'jwt');
    expect(isLoggedIn()).toBe(true);
  });

  it('getUser parses stored JSON, returns null when absent or malformed', () => {
    expect(getUser()).toBeNull();
    localStorage.setItem('voxb.user', JSON.stringify(USER));
    expect(getUser()).toEqual(USER);
    localStorage.setItem('voxb.user', '{not json');
    expect(getUser()).toBeNull();
  });

  it('authHeaders adds Bearer only when a token exists', () => {
    expect(authHeaders()).toEqual({});
    localStorage.setItem('voxb.token', 'jwt');
    expect(authHeaders()).toEqual({ Authorization: 'Bearer jwt' });
  });
});

describe('getToken with throwing storage', () => {
  it('swallows a localStorage error and returns null', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getToken()).toBeNull();
    expect(getUser()).toBeNull();
    spy.mockRestore();
  });
});

describe('logout', () => {
  it('clears the session and redirects', () => {
    localStorage.setItem('voxb.token', 'jwt');
    localStorage.setItem('voxb.user', JSON.stringify(USER));
    const loc = stubLocation();
    logout('/en/');
    expect(localStorage.getItem('voxb.token')).toBeNull();
    expect(localStorage.getItem('voxb.user')).toBeNull();
    expect(loc.href).toBe('/en/');
  });

  it('defaults the redirect to "/"', () => {
    const loc = stubLocation();
    logout();
    expect(loc.href).toBe('/');
  });
});

describe('requireAuth', () => {
  it('returns true and does not redirect when logged in', () => {
    localStorage.setItem('voxb.token', 'jwt');
    const loc = stubLocation('/en/members/', '?x=1');
    expect(requireAuth('en')).toBe(true);
    expect(loc.href).toBe('');
  });

  it('redirects to the locale login with a next param when logged out', () => {
    const loc = stubLocation('/en/members/', '?x=1');
    expect(requireAuth('en')).toBe(false);
    expect(loc.href).toBe(`/en/?next=${encodeURIComponent('/en/members/?x=1')}`);
  });
});

describe('exchangeGoogleCode', () => {
  it('persists the session and returns the user on success', async () => {
    stubLocation('/it/dashboard/');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'jwt', user: USER }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = await exchangeGoogleCode('auth-code');
    expect(user).toEqual(USER);
    expect(getToken()).toBe('jwt');
    expect(getUser()).toEqual(USER);
    // posts the locale parsed from the URL
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ code: 'auth-code', redirect_uri: 'postmessage', locale: 'it' });
  });

  it('defaults locale to "en" at the site root', async () => {
    stubLocation('/');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'jwt', user: USER }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await exchangeGoogleCode('c');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).locale).toBe('en');
  });

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await exchangeGoogleCode('c')).toBeNull();
    expect(getToken()).toBeNull();
  });

  it('returns null when the payload is missing token or user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'x' }) }),
    );
    expect(await exchangeGoogleCode('c')).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await exchangeGoogleCode('c')).toBeNull();
  });
});

describe('renderGoogleButton', () => {
  it('shows a config error when no client id is set', () => {
    const el = document.createElement('div');
    renderGoogleButton(el, () => {});
    expect(el.textContent).toContain('not configured');
  });

  describe('with a configured client id', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.stubEnv('PUBLIC_GOOGLE_CLIENT_ID', 'client-123.apps.googleusercontent.com');
    });

    it('injects the GSI script then mounts a branded button on load', async () => {
      const { renderGoogleButton: render } = await import('./auth');
      const el = document.createElement('div');
      document.body.appendChild(el);

      render(el, () => {});
      // GSI not present yet → a script is appended and mount waits for onload
      const script = document.head.querySelector('script[src*="gsi/client"]') as HTMLScriptElement;
      expect(script).toBeTruthy();

      // Simulate the GSI lib becoming available, then fire the script load.
      const requestCode = vi.fn();
      let cb: (r: { code?: string; error?: string }) => void = () => {};
      (window as unknown as { google: unknown }).google = {
        accounts: {
          oauth2: {
            initCodeClient: (cfg: { callback: typeof cb }) => {
              cb = cfg.callback;
              return { requestCode };
            },
          },
        },
      };
      script.onload?.(new Event('load'));

      const btn = el.querySelector('button');
      expect(btn).toBeTruthy();
      expect(btn?.getAttribute('aria-label')).toBe('Sign in with Google');

      // Clicking asks GSI for a code.
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(requestCode).toHaveBeenCalled();

      // A successful code exchange calls onSignedIn.
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ token: 'jwt', user: USER }) });
      vi.stubGlobal('fetch', fetchMock);
      const onSignedIn = vi.fn();
      // Re-mount with our spy callback so we can assert onSignedIn.
      render(el, onSignedIn);
      // window.google already present → mounts synchronously this time.
      cb({ code: 'ok-code' });
      await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(USER));
    });

    it('dispatches vox-login-error when GSI returns no code', async () => {
      const { renderGoogleButton: render } = await import('./auth');
      const el = document.createElement('div');
      document.body.appendChild(el);
      let cb: (r: { code?: string; error?: string }) => void = () => {};
      (window as unknown as { google: unknown }).google = {
        accounts: {
          oauth2: {
            initCodeClient: (cfg: { callback: typeof cb }) => {
              cb = cfg.callback;
              return { requestCode: vi.fn() };
            },
          },
        },
      };
      const onErr = vi.fn();
      el.addEventListener('vox-login-error', onErr);
      render(el, () => {});
      cb({ error: 'access_denied' });
      expect(onErr).toHaveBeenCalled();
    });

    afterEach(() => {
      delete (window as unknown as { google?: unknown }).google;
      vi.unstubAllEnvs();
    });
  });
});
