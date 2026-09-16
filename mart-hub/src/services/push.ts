import { api } from '../services/api';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export async function registerAdminSW(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (e) {
    console.warn('[SW] Registration failed:', e);
  }
}

export async function subscribeAdminToPush(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[Push] Not supported');
      return false;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[Push] Permission not granted:', permission);
      return false;
    }

    const keyRes = await api.get('/push/vapid-public-key');
    const publicKey = keyRes.data.data.publicKey;
    if (!publicKey) {
      console.warn('[Push] No VAPID public key from server');
      return false;
    }

    const reg = await navigator.serviceWorker.ready;

    // Check if already subscribed with same key — reuse
    let sub = await reg.pushManager.getSubscription();

    if (sub) {
      // Check if subscription is for the same VAPID key
      const existingKey = sub.options?.applicationServerKey;
      const newKey = urlBase64ToUint8Array(publicKey);
      const existingKeyBase64 = existingKey
        ? btoa(String.fromCharCode(...new Uint8Array(existingKey as ArrayBuffer)))
        : null;
      const newKeyBase64 = btoa(String.fromCharCode(...newKey));
      if (existingKeyBase64 !== newKeyBase64) {
        // Different key — unsubscribe and resubscribe
        await sub.unsubscribe();
        sub = null;
      }
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      });
    }

    // Save to backend
    await api.post('/push/subscribe/admin', sub.toJSON());
    console.log('[Push] Admin subscribed successfully');
    return true;
  } catch (e: any) {
    console.warn('[Push] Admin subscribe failed:', e?.message || e);
    return false;
  }
}

export async function unsubscribeAdminFromPush(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (e) {
    console.warn('[Push] Unsubscribe failed:', e);
  }
}
