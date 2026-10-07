/**
 * First-party funnel tracking for the storefront.
 *
 * Deliberately dependency-free and third-party-free: no Google Analytics, no
 * Meta Pixel, no Hotjar, no Clarity. This posts to our own backend, which
 * stores anonymous session events.
 *
 * What this does and does not collect:
 *   - It records THAT a step happened, never WHO. No phone number, email,
 *     name or address is ever passed in `props`.
 *   - The customer link is made server-side at OTP verification. By the time
 *     the backend writes it, the phone is already in hand there.
 *   - `session_id` is a random first-party value in localStorage. It is not a
 *     fingerprint, does not leave the device, and cannot identify a person.
 *
 * Every call is fire-and-forget: a failed or blocked request must never break
 * browsing, login or checkout.
 */

import { API_URL, isApiConfigured } from '../services/api';

const isDevelopment = Boolean((import.meta as any).env?.DEV);

const SESSION_KEY = 'mart-funnel-session';
const SESSION_AT = 'mart-funnel-session-at';
const CHANNEL_KEY = 'mart-funnel-channel';
const VISITOR_KEY = 'mart-funnel-visitor';

/**
 * A funnel session ends after this much quiet time. Past the window a revisit
 * on the same device counts as a new session again, so a QR camper's repeat
 * scans -- or a shopper coming back the next day -- still move the funnel
 * instead of being pinned to one lifetime id per device. Activity from any
 * tracked event keeps the session alive, which is what stops rapid re-scans
 * from inflating the count.
 */
const SESSION_IDLE_MS = 30 * 60 * 1000;

export type FunnelEvent =
  | 'session_start'
  | 'login_viewed'
  | 'login_field_focused'
  | 'login_number_entered'
  | 'otp_requested'
  | 'otp_entered'
  | 'otp_verification_failed'
  | 'otp_viewed'
  | 'login_verified'
  | 'login_abandoned'
  | 'product_viewed'
  | 'product_search'
  | 'search_zero_results'
  | 'category_viewed'
  | 'cart_started'
  | 'cart_added'
  | 'cart_updated'
  | 'cart_removed'
  | 'cart_cleared'
  | 'checkout_started'
  | 'checkout_address_started'
  | 'checkout_address_completed'
  | 'checkout_reviewed'
  | 'order_placed'
  | 'order_cancelled'
  | 'order_completed';

const CHANNEL_ALLOW = /^[a-z0-9_-]{1,32}$/i;

function randomId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The channel marker. `?ch=qr` on a printed QR resolves to 'qr'; anything
 * absent, malformed or unrecognised resolves to 'unattributed' so the
 * standee / QR / direct-entry bucket is never silently mislabelled.
 */
export function getFunnelChannel(): string {
  const store = safeLocalStorage();
  if (store) {
    const cached = store.getItem(CHANNEL_KEY);
    if (cached) return cached;
  }
  let channel = 'unattributed';
  try {
    const raw = new URLSearchParams(window.location.search).get('ch');
    if (raw && CHANNEL_ALLOW.test(raw)) channel = raw.toLowerCase();
    const utm = new URLSearchParams(window.location.search).get('utm_source');
    if (channel === 'unattributed' && utm && CHANNEL_ALLOW.test(utm)) channel = `utm_${utm.toLowerCase()}`;
  } catch {
    /* noop */
  }
  try { store?.setItem(CHANNEL_KEY, channel); } catch { /* noop */ }
  return channel;
}

export function getFunnelSessionId(): string {
  const store = safeLocalStorage();
  if (!store) return randomId();
  const stored = store.getItem(SESSION_KEY);
  const lastActive = Number(store.getItem(SESSION_AT) ?? 0);
  const expired = !stored || stored.length > 64 || !lastActive || Date.now() - lastActive > SESSION_IDLE_MS;
  if (expired) {
    const id = randomId();
    try {
      store.setItem(SESSION_KEY, id);
      store.setItem(SESSION_AT, String(Date.now()));
      // A new session may arrive through a different marker than the old one
      // (a fresh QR after a Google entry, say), so re-derive the channel from
      // the URL instead of trusting the stale cache.
      store.removeItem(CHANNEL_KEY);
    } catch { /* noop */ }
    return id;
  }
  // Touch the session: any activity extends the current one.
  try { store.setItem(SESSION_AT, String(Date.now())); } catch { /* noop */ }
  return stored;
}

/** A stable anonymous first-party browser identifier, distinct from a session. */
export function getFunnelVisitorId(): string {
  const store = safeLocalStorage();
  if (!store) return randomId();
  const stored = store.getItem(VISITOR_KEY);
  if (stored && /^[a-f0-9]{32}$/i.test(stored)) return stored;
  const id = randomId();
  try { store.setItem(VISITOR_KEY, id); } catch { /* noop */ }
  return id;
}

function attributionFromLocation(): Record<string, string | undefined> {
  try {
    const params = new URLSearchParams(window.location.search);
    const channel = getFunnelChannel();
    const qrCodeId = params.get('qr_code_id') || params.get('qr') || undefined;
    const hasCampaign = Boolean(params.get('utm_source') || params.get('utm_medium') || params.get('utm_campaign'));
    const hasReferrer = Boolean(document.referrer);
    const source = params.get('utm_source') || (channel === 'qr' ? 'offline' : channel !== 'unattributed' ? channel : !hasCampaign && !hasReferrer ? 'direct' : undefined);
    const medium = params.get('utm_medium') || (channel === 'qr' ? 'qr' : source === 'direct' ? 'none' : undefined);
    return {
      source,
      medium,
      content: params.get('utm_content') || undefined,
      term: params.get('utm_term') || undefined,
      qrCodeId,
    };
  } catch {
    return { source: 'unattributed' };
  }
}

function post(path: string, body: unknown): void {
  // In production the API is same-origin and API_URL is ''. In local dev it
  // points at the dev API host, so events must follow it rather than a
  // hardcoded path, or local testing would silently post nowhere.
  const url = `${API_URL}${path}`;
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    }
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    /* tracking must never surface an error to the shopper */
  }
}

export function track(event: FunnelEvent, props?: Record<string, unknown>): void {
  try {
    if (!isApiConfigured && isDevelopment) return;
    const urlParams = new URLSearchParams(window.location.search);
    post('/funnel/event', {
      sessionId: getFunnelSessionId(),
      visitorId: getFunnelVisitorId(),
      eventName: event,
      channel: getFunnelChannel(),
      path: window.location.pathname,
      referrer: document.referrer || undefined,
      utmSource: urlParams.get('utm_source') || undefined,
      utmMedium: urlParams.get('utm_medium') || undefined,
      utmCampaign: urlParams.get('utm_campaign') || undefined,
      ...attributionFromLocation(),
      props: props ?? {},
    });
  } catch { /* noop */ }
}

/** Server-side cart mirror. localStorage stays the render source. */
export function syncFunnelCart(
  items: unknown[],
  options: { reachedCheckout?: boolean } = {},
): void {
  // No customerId is sent. The server derives the customer from the verified
  // session link, so the browser never asserts which account a cart belongs to.
  post('/funnel/cart', {
    sessionId: getFunnelSessionId(),
    items,
    reachedCheckout: options.reachedCheckout === true,
  });
}

export function trackCampaignTouch(campaignId: string | number | null | undefined): void {
  if (!campaignId) return;
  post('/funnel/campaign', {
    sessionId: getFunnelSessionId(),
    campaignId: String(campaignId),
  });
}

/**
 * Emits an event at most once per session. Used for the funnel steps that
 * describe reaching a screen rather than an action, so a shopper who reopens
 * the login modal does not inflate the stage.
 */
const emitted = new Set<string>();
export function trackOnce(event: FunnelEvent, props?: Record<string, unknown>): void {
  if (emitted.has(event)) return;
  emitted.add(event);
  track(event, props);
}
