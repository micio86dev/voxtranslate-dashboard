/**
 * Web Push opt-in for the dashboard. Registers the service worker, asks for
 * notification permission, subscribes via the PushManager using the server's VAPID
 * public key, and registers the subscription. All best-effort and non-throwing.
 */
import { getVapidKey, subscribePush, unsubscribePush } from './api';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** True when this browser can do web push. */
export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Current permission ('granted' | 'denied' | 'default'), or 'unsupported'. */
export function pushPermission(): NotificationPermission | 'unsupported' {
  return pushSupported() ? Notification.permission : 'unsupported';
}

async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    await navigator.serviceWorker.register('/sw.js');
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

/** Prompt for permission and subscribe. Returns true on success. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  const reg = await readyRegistration();
  if (!reg) return false;
  const keyRes = await getVapidKey();
  if (!keyRes.ok || !keyRes.data?.key) return false;
  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyRes.data.key) as BufferSource,
    });
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
    const res = await subscribePush({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      user_agent: navigator.userAgent,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Unsubscribe this browser from push (best-effort). */
export async function disablePush(): Promise<void> {
  const reg = await readyRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await unsubscribePush(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

/** True if this browser already holds a push subscription. */
export async function isPushSubscribed(): Promise<boolean> {
  const reg = await readyRegistration();
  return !!(await reg?.pushManager.getSubscription());
}
