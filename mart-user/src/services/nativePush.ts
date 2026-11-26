import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { api } from './api';

const CHANNEL_ID = 'gokez-orders';
const TOKEN_KEY = 'mart_native_push_token';
const PENDING_ROUTE_KEY = 'mart_native_push_route';
const ALLOWED_PATHS = new Set([
  '/', '/about', '/what-is-gokez-mart', '/categories', '/deals', '/orders',
  '/account', '/login', '/privacy', '/terms', '/grievance', '/delete-account',
  '/feedback', '/referrals', '/fresh', '/notification-settings',
]);

let started = false;
const TOKEN_WAIT_MS = 5000;

async function waitForNativeToken(): Promise<boolean> {
  const deadline = Date.now() + TOKEN_WAIT_MS;
  while (Date.now() < deadline) {
    if (readToken()) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return Boolean(readToken());
}

export function isNativePush(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function hasNativePushToken(): boolean {
  if (!isNativePush()) return false;
  try { return Boolean(localStorage.getItem(TOKEN_KEY)); } catch { return false; }
}

function readToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

function isCustomerAuthed(): boolean {
  try {
    const stored = localStorage.getItem('mart-customer-auth');
    return Boolean(JSON.parse(stored || '{}')?.state?.token);
  } catch { return false; }
}

function registerEndpoint(): string {
  return String((import.meta as any).env?.VITE_FCM_TOKEN_ENDPOINT || '').trim();
}

function unregisterEndpoint(): string {
  const configured = String((import.meta as any).env?.VITE_FCM_TOKEN_UNREGISTER_ENDPOINT || '').trim();
  if (configured) return configured;
  const register = registerEndpoint();
  return register ? `${register.replace(/\/$/, '')}/unregister` : '';
}

function routeFromData(data: any): string | null {
  const raw = typeof data?.route === 'string'
    ? data.route
    : typeof data?.path === 'string'
      ? data.path
      : typeof data?.link === 'string'
        ? data.link
        : '';
  if (raw.startsWith('http')) return null;
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  if (ALLOWED_PATHS.has(path.split('?')[0])) return path;
  const type = typeof data?.type === 'string' ? data.type : '';
  if (type.startsWith('order')) return '/orders';
  if (type === 'offer' || type === 'promotion' || type === 'deal') return '/deals';
  if (type === 'referral') return '/referrals';
  if (type === 'account') return '/account';
  return null;
}

function openRoute(path: string) {
  try { sessionStorage.setItem(PENDING_ROUTE_KEY, path); } catch {}
  const [pathname, query] = path.split('?');
  if (`${window.location.pathname}${window.location.search}` !== `${pathname}${query ? `?${query}` : ''}`) {
    window.history.pushState({}, '', path);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function consumePendingPushRoute(): string | null {
  if (!isNativePush()) return null;
  try {
    const path = sessionStorage.getItem(PENDING_ROUTE_KEY);
    sessionStorage.removeItem(PENDING_ROUTE_KEY);
    return path && ALLOWED_PATHS.has(path.split('?')[0]) ? path : null;
  } catch { return null; }
}

async function postToken(url: string, token: string): Promise<void> {
  if (!url || !isApiConfiguredFor(url)) return;
  try {
    await api.post(url, { token, platform: 'android' });
  } catch (error) {
    console.warn('[NativePush] Token sync failed:', error);
  }
}

function isApiConfiguredFor(url: string): boolean {
  if (!url.startsWith('/')) return true;
  const apiUrl = String((import.meta as any).env?.VITE_API_URL || '').trim();
  return Boolean(apiUrl) || Boolean((import.meta as any).env?.DEV);
}

async function storeToken(token: string): Promise<void> {
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
  await syncNativePushAssociation();
}

export async function syncNativePushAssociation(): Promise<void> {
  const token = readToken();
  if (!token || !isCustomerAuthed()) return;
  await postToken(registerEndpoint(), token);
}

export async function clearNativePushAssociation(): Promise<void> {
  const token = readToken();
  if (!token) return;
  await postToken(unregisterEndpoint(), token);
}

export async function requestNativePushPermission(): Promise<boolean> {
  if (!isNativePush()) return false;
  try {
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive !== 'granted') return false;
    await PushNotifications.register();
    if (!(await waitForNativeToken())) return false;
    await syncNativePushAssociation();
    return true;
  } catch (error) {
    console.warn('[NativePush] Permission request failed:', error);
    return false;
  }
}

export async function startNativePush(): Promise<void> {
  if (!isNativePush() || started) return;
  started = true;
  try {
    await PushNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Order updates',
      description: 'Gokez Mart order status and delivery updates',
      importance: 3,
      visibility: 1,
      vibration: true,
    });
  } catch (error) {
    console.warn('[NativePush] Channel setup failed:', error);
  }
  try {
    await PushNotifications.addListener('registration', (event: { value: string }) => {
      storeToken(event.value).catch(() => {});
    });
    await PushNotifications.addListener('registrationError', (error: any) => {
      console.warn('[NativePush] Registration error:', error);
    });
    await PushNotifications.addListener('pushNotificationActionPerformed', (action: any) => {
      const path = routeFromData(action?.notification?.data);
      if (path) openRoute(path);
    });
    const permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'granted') await PushNotifications.register();
  } catch (error) {
    console.warn('[NativePush] Startup failed:', error);
  }
}
