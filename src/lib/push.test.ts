import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The push module talks to the backend through ./api — mock those three calls.
vi.mock('./api', () => ({
  getVapidKey: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}));

import { getVapidKey, subscribePush, unsubscribePush } from './api';
import { pushSupported, pushPermission, enablePush, disablePush, isPushSubscribed } from './push';

const getVapidKeyMock = vi.mocked(getVapidKey);
const subscribePushMock = vi.mocked(subscribePush);
const unsubscribePushMock = vi.mocked(unsubscribePush);

// A valid base64url VAPID key (length multiple of 4, exercises the -/_ → +// swap;
// decodes cleanly through atob).
const VAPID = 'BNcRdab-_ef0';

interface FakeSub {
  endpoint: string;
  toJSON: () => unknown;
  unsubscribe: () => Promise<boolean>;
}

function makeSub(json: unknown): FakeSub {
  return {
    endpoint: 'https://push.example/sub',
    toJSON: () => json,
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

/** Install navigator.serviceWorker + window.PushManager/Notification so the
 *  capability check passes, with a configurable registration. */
function installPush(opts: {
  registerThrows?: boolean;
  subscribeResult?: FakeSub | Error;
  existingSub?: FakeSub | null;
  permission?: NotificationPermission;
}) {
  const pushManager = {
    subscribe: vi.fn(async () => {
      if (opts.subscribeResult instanceof Error) throw opts.subscribeResult;
      return opts.subscribeResult;
    }),
    getSubscription: vi.fn(async () => opts.existingSub ?? null),
  };
  const registration = { pushManager };
  const serviceWorker = {
    register: vi.fn(async () => {
      if (opts.registerThrows) throw new Error('sw register failed');
      return registration;
    }),
    ready: Promise.resolve(registration),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: serviceWorker,
    configurable: true,
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', {
    permission: opts.permission ?? 'default',
    requestPermission: vi.fn(async () => opts.permission ?? 'granted'),
  });
  return { registration, pushManager, serviceWorker };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Remove the serviceWorker shim between tests.
  // @ts-expect-error cleanup
  delete navigator.serviceWorker;
});

describe('pushSupported / pushPermission', () => {
  it('reports unsupported when the APIs are missing', () => {
    expect(pushSupported()).toBe(false);
    expect(pushPermission()).toBe('unsupported');
  });

  it('reports supported + the current permission when present', () => {
    installPush({ permission: 'granted' });
    expect(pushSupported()).toBe(true);
    expect(pushPermission()).toBe('granted');
  });
});

describe('enablePush', () => {
  it('returns unsupported when push APIs are absent', async () => {
    expect(await enablePush()).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('returns denied when the user blocks the prompt', async () => {
    installPush({ permission: 'denied' });
    expect(await enablePush()).toEqual({ ok: false, reason: 'denied' });
  });

  it('returns failed when the service worker cannot register', async () => {
    installPush({ permission: 'granted', registerThrows: true });
    expect(await enablePush()).toEqual({ ok: false, reason: 'failed' });
  });

  it('returns server when the backend has no VAPID key', async () => {
    installPush({ permission: 'granted' });
    getVapidKeyMock.mockResolvedValue({ ok: true, status: 200, data: { key: '' } });
    expect(await enablePush()).toEqual({ ok: false, reason: 'server' });
  });

  it('returns failed when the subscription JSON is incomplete', async () => {
    installPush({
      permission: 'granted',
      subscribeResult: makeSub({ endpoint: 'x', keys: { p256dh: 'p' } }),
    });
    getVapidKeyMock.mockResolvedValue({ ok: true, status: 200, data: { key: VAPID } });
    expect(await enablePush()).toEqual({ ok: false, reason: 'failed' });
  });

  it('returns failed when subscribe() throws', async () => {
    installPush({ permission: 'granted', subscribeResult: new Error('denied by UA') });
    getVapidKeyMock.mockResolvedValue({ ok: true, status: 200, data: { key: VAPID } });
    expect(await enablePush()).toEqual({ ok: false, reason: 'failed' });
  });

  it('returns failed when the server rejects the subscription', async () => {
    installPush({
      permission: 'granted',
      subscribeResult: makeSub({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }),
    });
    getVapidKeyMock.mockResolvedValue({ ok: true, status: 200, data: { key: VAPID } });
    subscribePushMock.mockResolvedValue({ ok: false, status: 500, data: null });
    expect(await enablePush()).toEqual({ ok: false, reason: 'failed' });
  });

  it('returns ok and registers the subscription on success', async () => {
    const { pushManager } = installPush({
      permission: 'granted',
      subscribeResult: makeSub({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }),
    });
    getVapidKeyMock.mockResolvedValue({ ok: true, status: 200, data: { key: VAPID } });
    subscribePushMock.mockResolvedValue({ ok: true, status: 200, data: null });

    expect(await enablePush()).toEqual({ ok: true });
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(subscribePushMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }),
    );
  });
});

describe('disablePush', () => {
  it('no-ops when there is no subscription', async () => {
    installPush({ permission: 'granted', existingSub: null });
    await expect(disablePush()).resolves.toBeUndefined();
    expect(unsubscribePushMock).not.toHaveBeenCalled();
  });

  it('unsubscribes locally and on the server when subscribed', async () => {
    const sub = makeSub({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } });
    installPush({ permission: 'granted', existingSub: sub });
    unsubscribePushMock.mockResolvedValue({ ok: true, status: 200, data: null });
    await disablePush();
    expect(unsubscribePushMock).toHaveBeenCalledWith(sub.endpoint);
    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it('returns (no throw) when push is unsupported', async () => {
    await expect(disablePush()).resolves.toBeUndefined();
  });
});

describe('isPushSubscribed', () => {
  it('is false without support', async () => {
    expect(await isPushSubscribed()).toBe(false);
  });
  it('is true when a subscription exists', async () => {
    installPush({
      permission: 'granted',
      existingSub: makeSub({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }),
    });
    expect(await isPushSubscribed()).toBe(true);
  });
});
