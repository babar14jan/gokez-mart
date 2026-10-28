import { api } from './api';
import { readTrackingTokens } from '../utils/guestTracking';

const SW_URL = '/sw.js';

// Some browsers (notably in-app webviews and PWAs whose worker failed to
// activate) never resolve `serviceWorker.ready`, and iOS can leave the native
// permission promise pending indefinitely. Without a ceiling the "Enable"
// button sits on "Turning on..." forever, so every async step gets a deadline.
const SUBSCRIBE_TIMEOUT_MS = 20000;
const PERMISSION_TIMEOUT_MS = 30000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  // The production worker caches scripts cache-first. Keeping it active under
  // Vite can make local UI edits appear unchanged after a server restart.
  const isLocalDevelopment = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  if (isLocalDevelopment) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames
        .filter(name => name.startsWith('gokez-mart-'))
        .map(name => caches.delete(name)));
    } catch (e) { console.warn('[SW] Development cleanup failed:', e); }
    return;
  }

  // The worker asks the page to reload itself when it takes over from a build
  // that left this device stuck; navigate() alone is refused by some browsers.
  // Guarded so it can never reload in a loop within one session.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'GOKEZ_FORCE_RELOAD' && !sessionStorage.getItem('gokez-sw-reloaded')) {
      sessionStorage.setItem('gokez-sw-reloaded', '1');
      window.location.reload();
    }
  });

  try { await navigator.serviceWorker.register(SW_URL); }
  catch (e) { console.warn('[SW] Registration failed:', e); }
}

// Get current notification permission state
export function getNotificationPermission(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/**
 * Whether this device can use web push at all. Some browsers (notably iOS
 * Safari running as a normal tab, not an installed PWA) expose neither
 * `Notification` nor `PushManager`, so there is nothing to prompt for and a
 * "turn on notifications" popup would be a dead end. Checked before showing it.
 */
export function isPushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
}

/**
 * True when this browser already holds an active push subscription. Used so the
 * "keep track of your order" popup never asks a device that is already
 * subscribed — permission alone is not enough, because a device can be granted
 * yet have no subscription (e.g. a fresh install, or a cleared endpoint).
 */
export async function hasActivePushSubscription(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch { return false; }
}

// Get current location permission state
export async function getLocationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  if (!navigator.geolocation) return 'unsupported';
  if (!navigator.permissions) return 'prompt'; // fallback
  try {
    const result = await navigator.permissions.query({ name: 'geolocation' });
    return result.state as 'granted' | 'denied' | 'prompt';
  } catch { return 'prompt'; }
}

// Request notification permission and subscribe
export async function requestNotificationPermission(): Promise<'granted' | 'denied' | 'default'> {
  if (!('Notification' in window)) return 'denied';
  return withTimeout(
    Notification.requestPermission(),
    PERMISSION_TIMEOUT_MS,
    'Notification permission request timed out',
  );
}

// Subscribe to push after permission granted.
//
// A signed-in customer registers once against their account. A guest has no
// account, so the device is registered against each order tracking token it
// holds; the backend then pushes to that device for those orders. Registering
// the guest tokens only happens when the device already holds them (i.e. it has
// placed or tracked an order), so permission alone never creates a row.
export async function subscribeToPush(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    if (Notification.permission !== 'granted') return false;

    const authed = isCustomerAuthed();
    const tokens = authed ? [] : readTrackingTokens();
    if (!authed && tokens.length === 0) return false;

    const keyRes = await api.get('/push/vapid-public-key');
    const publicKey = keyRes.data.data.publicKey;
    if (!publicKey) return false;

    const reg = await withTimeout(
      navigator.serviceWorker.ready,
      SUBSCRIBE_TIMEOUT_MS,
      'Service worker did not become ready',
    );
    const existing = await reg.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();

    const sub = await withTimeout(
      reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      }),
      SUBSCRIBE_TIMEOUT_MS,
      'Push subscription timed out',
    );

    if (authed) {
      await api.post('/push/subscribe/customer', sub.toJSON());
      return true;
    }

    // Guest: register the same endpoint once per held tracking token. The first
    // call creates the row (UNIQUE endpoint), the rest re-point it, so the final
    // owner is the most recent token — the device's newest order, which is the
    // one most likely to still be live. Any failure is non-fatal.
    let registered = false;
    for (const trackingToken of tokens) {
      try {
        await api.post('/push/subscribe/guest', { ...sub.toJSON(), trackingToken });
        registered = true;
      } catch { /* skip tokens the server rejects (e.g. old/unknown) */ }
    }
    return registered;
  } catch (e) {
    console.warn('[Push] Subscribe failed:', e);
    return false;
  }
}

// The auth token is stored by the zustand customer store; read it directly to
// avoid importing the store here (this module is used before React mounts).
function isCustomerAuthed(): boolean {
  try {
    const stored = localStorage.getItem('mart-customer-auth');
    if (!stored) return false;
    return !!JSON.parse(stored)?.state?.token;
  } catch { return false; }
}

// Unsubscribe from push
export async function unsubscribeFromPush(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch {}
}
