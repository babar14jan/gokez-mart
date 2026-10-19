import axios from 'axios';
import {
  buildCacheKey, getEntry, setEntry, getInflight, startInflight,
  clearHttpCache, getCacheGeneration, CACHE_FRESH_MS, CACHE_MAX_AGE_MS,
} from './httpCache';

const configuredApiUrl = (import.meta as any).env?.VITE_API_URL?.trim();
const isDevelopment = Boolean((import.meta as any).env?.DEV);
export const API_URL = configuredApiUrl || (isDevelopment ? 'http://localhost:3004/api/v1' : '');

export const isApiConfigured = Boolean(API_URL);

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** Bypass the in-memory cache read (response is still cached). Live/polling paths use this. */
    fresh?: boolean;
  }
}

export { clearHttpCache };

export const api = axios.create({ baseURL: API_URL });

// Stale-while-revalidate cache: a GET answered recently resolves instantly from
// memory instead of re-querying the backend on every tab switch or remount. A
// stale entry is still served immediately (no skeleton) while a background
// refresh updates the cache for the next reader. `fresh: true` skips the cache
// read — used by live polling paths that must hit the server. Concurrent
// identical GETs share one network request (the checkout overlay mounts twice).
api.interceptors.request.use(config => {
  const method = (config.method || 'get').toLowerCase();
  if (method !== 'get') return config;
  // Record the generation this read started in, before any early return, so the
  // response interceptor can refuse to cache it if a mutation cleared the cache
  // while it was in flight.
  (config as any).__martCacheGen = getCacheGeneration();
  if (config.fresh) return config;
  // Only cache JSON GETs; the connectivity probe must always reach the network.
  if (config.responseType && config.responseType !== 'json') return config;
  if ((config.url || '').includes('/health')) return config;

  const key = buildCacheKey(config);
  const entry = getEntry(key);
  if (entry) {
    const age = Date.now() - entry.cachedAt;
    if (age < CACHE_MAX_AGE_MS) {
      if (age >= CACHE_FRESH_MS && !entry.revalidating) {
        entry.revalidating = true;
        api.request({ ...config, fresh: true })
          .catch(() => { /* keep serving the stale copy */ })
          .finally(() => {
            const current = getEntry(key);
            if (current) current.revalidating = false;
          });
      }
      // Short-circuit; the response error interceptor resolves it as a success.
      const cacheHit: any = new Error('mart http cache hit');
      cacheHit.isCacheHit = true;
      cacheHit.config = config;
      cacheHit.cachedResponse = {
        data: entry.response.data,
        status: entry.response.status,
        statusText: entry.response.statusText,
        headers: entry.response.headers,
        config,
      };
      return Promise.reject(cacheHit);
    }
  }

  // De-duplicate concurrent identical network GETs: the second caller joins the
  // first one's promise instead of issuing a second request.
  const existing = getInflight(key);
  if (existing) {
    const join: any = new Error('mart http request in flight');
    join.inflightPromise = existing.promise;
    join.config = config;
    return Promise.reject(join);
  }
  (config as any).__martInflightKey = key;
  startInflight(key);
  return config;
});

// Inject customer token if available
api.interceptors.request.use(config => {
  try {
    const stored = localStorage.getItem('mart-customer-auth');
    if (stored) {
      const { state } = JSON.parse(stored);
      if (state?.token) config.headers.Authorization = `Bearer ${state.token}`;
    }
  } catch {}
  return config;
});

// A 401 means the stored token is no longer valid (expired, or the customer was
// signed out elsewhere). Without this the app keeps isLoggedIn=true forever and
// every authenticated call — including the address book — fails silently, so a
// shopper sees "saved" but nothing persists. Drop the session instead of lying.
api.interceptors.response.use(
  response => {
    const method = (response.config.method || 'get').toLowerCase();
    if (method === 'get') {
      if (!response.config.responseType || response.config.responseType === 'json') {
        const key = buildCacheKey(response.config);
        // Only write back if no mutation cleared the cache since this read
        // started; otherwise we would re-seed pre-mutation data (and serve it
        // "fresh" for the next 20s).
        if ((response.config as any).__martCacheGen === getCacheGeneration()) {
          setEntry(key, {
            data: response.data,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers as Record<string, unknown>,
          });
        }
        getInflight(key)?.resolve(response);
      }
    } else {
      // A mutation happened: drop every cached GET so the next read is real.
      clearHttpCache();
    }
    return response;
  },
  async error => {
    // Joiners and cache hits arrive through the error channel — settle them
    // before the failure handling below, or they would look like outages.
    if (error?.inflightPromise) {
      return error.inflightPromise;
    }
    if (error?.isCacheHit && error.cachedResponse) {
      return Promise.resolve(error.cachedResponse);
    }
    // The owning request failed: propagate to whoever joined its promise.
    const ownerKey = error?.config?.__martInflightKey;
    if (ownerKey) getInflight(ownerKey)?.reject(error);

    const status = error?.response?.status;
    const url: string = error?.config?.url || '';
    // OTP verification answers 401 for a wrong code while nobody is signed in;
    // the generic handler must not treat that as an expired session.
    if (status === 401 && !url.includes('/auth/send-otp') && !url.includes('/auth/verify-otp')) {
      try {
        const { useCustomerAuthStore } = await import('../store/customerAuthStore');
        if (useCustomerAuthStore.getState().isLoggedIn) {
          useCustomerAuthStore.getState().logout();
          window.dispatchEvent(new CustomEvent('mart:auth-expired'));
        }
      } catch {}
    }
    // Feed the global offline/server screen with real request outcomes, so it
    // reacts the moment a call actually fails instead of waiting for its own
    // /health probe to time out. A transport-level failure (no HTTP response at
    // all) means the backend is unreachable — almost always no usable network —
    // while an HTTP 5xx means it answered but is unhealthy. 4xx is left alone:
    // that is a request problem, not a connectivity one.
    if (typeof window !== 'undefined') {
      try {
        if (!error?.response) {
          const timedOut = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT';
          window.dispatchEvent(new CustomEvent('mart:api-failed', {
            detail: timedOut ? { timeout: true } : { offline: true },
          }));
        } else if ((status ?? 0) >= 500) {
          window.dispatchEvent(new CustomEvent('mart:api-failed', { detail: { server: true } }));
        }
      } catch {}
    }
    return Promise.reject(error);
  }
);

export interface Category {
  id: string; name: string; slug: string; icon: string; productCount: number;
}

export interface Product {
  id: string; name: string; localName: string | null; description: string | null;
  searchAliases: string[];
  photoUrl: string | null; price: number; unit: string;
  approxWeight: string | null;
  weightOptions: Array<{ label: string; price: number }> | null;
  discountPercent: number; isAvailable: boolean;
  availabilityStatus: 'available' | 'out_of_stock' | 'hidden';
  categoryId: string; categoryName: string;
  /** A fixed combo/bundle sold as one product. Drives the "Today's Combos" section. */
  isBundle: boolean;
}

/**
 * A configurable homepage section, ordered by the backend. `sectionKey` selects
 * how the storefront renders it; `config` carries the small amount of per-section
 * setting. Product content is resolved live from the catalogue, never stored here.
 */
export interface HomeSection {
  id: string;
  sectionKey: 'todays_combos' | 'fresh_vegetables' | 'deals' | 'top_picks' | string;
  title: string;
  subtitle: string | null;
  sortOrder: number;
  isEnabled: boolean;
  config: {
    categorySlug: string | null;
    productIds?: string[];
    limit?: number | null;
    layout?: 'row' | 'grid' | null;
  };
}

/**
 * Open/closed state, computed by the server from the store's posted hours and
 * the manual open/closed switch. The browser deliberately does not re-derive
 * this: a single implementation means the customer is never told one thing
 * while the order is recorded as another.
 */
export interface StoreOpenState {
  isOpen: boolean;
  closedReason: 'manual' | 'outside_hours' | 'never_opens' | null;
  /** ISO instant the store next opens. Null after a manual closure, when no
   *  reopening time was ever promised. */
  nextOpenAt: string | null;
  /** Preformatted IST label, e.g. "9:00 AM tomorrow". */
  nextOpenLabel: string | null;
  closesAtLabel: string | null;
}

export type StoreOpeningHours =
  Record<string, { open?: string; close?: string; closed?: boolean } | null | undefined> | null;

export interface PublicSettings {
  store_name: string; store_address: string; delivery_charge: string;
  free_delivery_above: string; min_order_amount: string;
  delivery_area: string; store_open: string; estimated_delivery: string;
  cod_enabled: string; upi_enabled: string; phonepay_enabled: string;
  phonepay_qr_url: string; upi_phone: string; upi_id: string;
  whatsapp_number: string; support_name: string; support_phone: string;
  openState?: StoreOpenState;
  openingHours?: StoreOpeningHours;
}

export interface MartZone {
  id: string;
  storeId: string;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
  isActive: boolean;
}

export const authApi = {
  sendOtp: (phone: string) => api.post('/auth/send-otp', { phone }),
  // `funnelSessionId` is optional and additive: the backend uses it to link the
  // anonymous session to the customer for attribution and ignores it if absent,
  // so authentication behaviour is unchanged either way.
  verifyOtp: (phone: string, otp: string, funnelSessionId?: string) =>
    api.post('/auth/verify-otp', { phone, otp, ...(funnelSessionId ? { funnelSessionId } : {}) }),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me'),
  // `token` is supplied only by the new-customer name capture, which runs before
  // the login is committed (see LoginFlow). Everywhere else the request
  // interceptor attaches the stored token as usual.
  updateProfile: async (data: { name?: string; address?: string; address2?: string; photoUrl?: string }, token?: string) => {
    const effectiveToken = token || (() => {
      try {
        const stored = localStorage.getItem('mart-customer-auth');
        const { state } = JSON.parse(stored || '{}');
        return state?.token || null;
      } catch { return null; }
    })();
    if (!effectiveToken) return Promise.reject(new Error('No auth token available'));
    return api.put('/auth/profile', data, { headers: { Authorization: `Bearer ${effectiveToken}` } });
  },
  getOrders: (opts?: FetchOpts) => api.get('/auth/orders', { fresh: opts?.fresh }),
  uploadPhoto: (file: File) => {
    const form = new FormData();
    form.append('photo', file);
    return api.post('/auth/upload/photo', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  cancelOrder: (orderId: string) => api.put(`/auth/orders/${orderId}/cancel`),
  requestDeletion: (reason?: string) => api.post('/compliance/deletion', { reason }),
  getDeletionStatus: () => api.get('/compliance/deletion'),
  submitGrievance: (subject: string, description: string, idempotencyKey: string) => api.post('/compliance/grievances', { subject, description }, { headers: { 'Idempotency-Key': idempotencyKey } }),
  getGrievances: () => api.get('/compliance/grievances'),
  requestDataExport: () => api.post('/compliance/data-export'),
  getDataExport: () => api.get('/compliance/data-export'),
  getMarketingConsent: () => api.get('/compliance/marketing-consent'),
  updateMarketingConsent: (granted: boolean) => api.put('/compliance/marketing-consent', { granted }),
};

export interface AddressBookEntry {
  id: string; label: string; addressLine: string; latitude: number | null; longitude: number | null;
  isDefault: boolean; createdAt: string;
}

export const addressApi = {
  list:       () => api.get<{ success: boolean; data: AddressBookEntry[] }>('/auth/addresses'),
  add:        (label: string, addressLine: string, isDefault?: boolean, latitude?: number | null, longitude?: number | null) =>
    api.post<{ success: boolean; data: AddressBookEntry }>('/auth/addresses', { label, addressLine, isDefault, latitude, longitude }),
  update:     (id: string, label: string, addressLine: string, latitude?: number | null, longitude?: number | null) =>
    api.put<{ success: boolean; data: AddressBookEntry }>(`/auth/addresses/${id}`, { label, addressLine, latitude, longitude }),
  remove:     (id: string) => api.delete(`/auth/addresses/${id}`),
  setDefault: (id: string) => api.put(`/auth/addresses/${id}/default`),
};

export interface FetchOpts { fresh?: boolean }

export const storeApi = {
  getCategories: (opts?: FetchOpts) =>
    api.get<{ success: boolean; data: Category[] }>('/categories', { fresh: opts?.fresh }),
  getProducts: (categoryId?: string, storeId?: string, opts?: FetchOpts) =>
    api.get<{ success: boolean; data: Product[] }>('/products', {
      params: { ...(categoryId ? { categoryId } : {}), ...(storeId ? { storeId } : {}) },
      fresh: opts?.fresh,
    }),
  getSettings: (storeId?: string, opts?: FetchOpts) => api.get<{ success: boolean; data: PublicSettings }>('/settings/public', {
    params: storeId ? { storeId } : {},
    fresh: opts?.fresh,
  }),
  getHomeSections: (storeId?: string, opts?: FetchOpts) =>
    api.get<{ success: boolean; data: HomeSection[] }>('/home-sections', {
      params: storeId ? { storeId } : {},
      fresh: opts?.fresh,
    }),
  /**
   * A tiny fingerprint of the whole public catalog. The catalog poll compares
   * this and skips the four heavy fetches entirely when nothing changed.
   */
  getCatalogStamp: (storeId?: string) =>
    api.get<{ success: boolean; data: { stamp: string } }>('/catalog/stamp', {
      params: storeId ? { storeId } : {},
    }),
  getZones: () => api.get<{ success: boolean; data: MartZone[] }>('/zones'),
  placeOrder: (data: {
    guestName: string; guestPhone: string; guestAddress: string;
    guestAddressLabel?: string;
    latitude?: number | null; longitude?: number | null;
    zoneName?: string; storeId?: string;
    deliveryPreference?: string; deliveryNote?: string;
    /** ISO instant for a customer-chosen "Scheduled" delivery window. */
    scheduledFor?: string;
    items: Array<{ productId: string; productName: string; unit: string; price: number; quantity: number }>;
    paymentMethod?: 'cod' | 'upi' | 'phonepay'; notes?: string;
    campaignId?: string; couponCode?: string;
    /** Closes the cart funnel. Optional; the server ignores a malformed value. */
    funnelSessionId?: string;
  }, idempotencyKey: string) => api.post('/orders', data, { headers: { 'Idempotency-Key': idempotencyKey } }),
  /**
   * Persists a guest's latest name/phone/address server-side, so the hub shows
   * an edit made before the next order lands. Only writes for phones that have
   * not verified via OTP (signed-in customers edit their own profile).
   */
  saveGuestDetails: (data: {
    phone: string; name?: string; address: string; label?: string;
    latitude?: number | null; longitude?: number | null;
  }) => api.post('/guest-details', data),
  trackOrdersByTokens: (tokens: string[], opts?: FetchOpts) =>
    api.get('/orders/track/tokens', { params: { tokens: tokens.join(',') }, fresh: opts?.fresh }),
  cancelOrderByToken: (orderId: string, trackingToken: string) =>
    api.post(`/orders/track/${orderId}/cancel`, { trackingToken }),
};

// ── Feedback ────────────────────────────────────────────────────────────────────────────────
export const feedbackApi = {
  submit: (data: { rating: number; category: string; message?: string; storeId?: string; orderId?: string }, idempotencyKey: string) =>
    api.post('/feedback', data, { headers: { 'Idempotency-Key': idempotencyKey } }),
};

// ── Campaigns (public) ────────────────────────────────────────────────────────────────────────────────
export const campaignApi = {
  /** Pre-login welcome teaser. Includes coupon-code offers; grants no authority. */
  getWelcome: (cartTotal: number, storeId: string) =>
    api.get("/campaigns/welcome", { params: { cartTotal, storeId } }),
  getEligible: (cartTotal: number, storeId: string) =>
    api.get("/campaigns/eligible", { params: { cartTotal, storeId } }),
  validateCode: (code: string, cartTotal: number, storeId: string) =>
    api.post("/campaigns/validate", { code, cartTotal, storeId }),
  getCarousel: () => api.get("/carousel"),
};
