import axios from 'axios';
import { buildCacheKey, getEntry, setEntry, clearHttpCache, CACHE_FRESH_MS, CACHE_MAX_AGE_MS } from './httpCache';

/// <reference types="vite/client" />

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** Bypass the in-memory cache read (response is still cached). Live/polling paths use this. */
    fresh?: boolean;
  }
}

export { clearHttpCache };

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3004/api/v1';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Stale-while-revalidate cache: a GET answered recently resolves instantly from
// memory instead of re-querying the database on every page switch. A stale
// entry is still served immediately (no skeleton on navigation) while a
// background refresh updates the cache for the next reader. `fresh: true`
// skips the cache read — used by live polling paths that must hit the server.
api.interceptors.request.use(config => {
  const method = (config.method || 'get').toLowerCase();
  if (method !== 'get' || config.fresh) return config;
  // Only cache JSON GETs (blob exports and the like must always stream).
  if (config.responseType && config.responseType !== 'json') return config;

  const key = buildCacheKey(config);
  const entry = getEntry(key);
  if (!entry) return config;

  const age = Date.now() - entry.cachedAt;
  if (age >= CACHE_MAX_AGE_MS) return config; // too old to serve — real fetch

  if (age >= CACHE_FRESH_MS && !entry.revalidating) {
    entry.revalidating = true;
    api.request({ ...config, fresh: true })
      .catch(() => { /* keep serving the stale copy */ })
      .finally(() => {
        const current = getEntry(key);
        if (current) current.revalidating = false;
      });
  }

  // Short-circuit the request; the response error interceptor resolves it as a
  // success (the standard axios cache-hit pattern).
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
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('mart_admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  response => {
    const method = (response.config.method || 'get').toLowerCase();
    if (method === 'get') {
      if (!response.config.responseType || response.config.responseType === 'json') {
        setEntry(buildCacheKey(response.config), {
          data: response.data,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers as Record<string, unknown>,
        });
      }
    } else {
      // A mutation happened: drop every cached GET so the next read is real.
      clearHttpCache();
    }
    return response;
  },
  err => {
    // Cache hits are delivered through the error channel — resolve them before
    // the failure handling below, or they would look like an outage.
    if (err?.isCacheHit && err.cachedResponse) {
      return Promise.resolve(err.cachedResponse);
    }
    if (err.response?.status === 401) {
      localStorage.removeItem('mart_admin_token');
      window.location.href = '/login';
    }
    // Feed the global offline/server screen with real request outcomes, so it
    // reacts the moment a call actually fails instead of waiting for its own
    // /health probe to time out. A transport-level failure (no HTTP response at
    // all) means the backend is unreachable — almost always no usable network —
    // while an HTTP 5xx means it answered but is unhealthy. 4xx is left alone.
    if (typeof window !== 'undefined') {
      try {
        if (!err?.response) {
          const timedOut = err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT';
          window.dispatchEvent(new CustomEvent('mart:api-failed', {
            detail: timedOut ? { timeout: true } : { offline: true },
          }));
        } else if ((err.response.status ?? 0) >= 500) {
          window.dispatchEvent(new CustomEvent('mart:api-failed', { detail: { server: true } }));
        }
      } catch {}
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    api.post('/admin/login', { username, password }),
  refreshSession: () => api.post('/admin/session/refresh'),
  getMe: () => api.get('/admin/me', { fresh: true }),
  // Revokes this device's session server-side (mart_admin_sessions). Called on
  // manual logout so the session ends for real instead of lingering until the
  // JWT expires; failures are ignored — the local sign-out always proceeds.
  logout: () => api.post('/admin/logout'),
};

// ── Uploads ───────────────────────────────────────────────────────────────────
// Mirrors the backend's checks (multer 5 MB cap, sharp JPEG/PNG/WebP only) so a
// bad file fails here with a readable message instead of a 5xx, which the hub's
// network overlay misreads as the backend being down.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const SUPPORTED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Shaped like an axios error so every upload call site's existing
// `e?.response?.data?.error` handling displays the reason.
function rejectPhoto(message: string): never {
  const error: any = new Error(message);
  error.response = { data: { success: false, error: message } };
  throw error;
}

function assertUploadablePhoto(file: File): void {
  // Some pickers/OSes hand over an empty `type`; fall back to the extension
  // (the backend re-checks the real bytes with sharp before storing).
  const typeSupported = file.type
    ? SUPPORTED_PHOTO_TYPES.has(file.type)
    : /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!typeSupported) {
    rejectPhoto('Only JPEG, PNG, and WebP images are supported.');
  }
  if (file.size > MAX_PHOTO_BYTES) {
    rejectPhoto('That photo is too large. Please use one under 5 MB.');
  }
}

// ── Products ──────────────────────────────────────────────────────────────────
export const productsApi = {
  getAll: (storeId?: string, opts?: FetchOpts) => api.get('/admin/products', { params: storeId ? { storeId } : {}, fresh: opts?.fresh }),
  create: (data: any) => api.post('/admin/products', data),
  getBundleComponents: (id: string, storeId?: string) => api.get(`/admin/products/${id}/components`, { params: storeId ? { storeId } : {} }),
  update: (id: string, data: any) => api.put(`/admin/products/${id}`, data),
  delete: (id: string, storeId?: string) => api.delete(`/admin/products/${id}`, { params: storeId ? { storeId } : {} }),
  cleanStorage: (dryRun = true) => api.post('/admin/storage/clean', { dryRun }),
  uploadPhoto: (file: File, maxDimension?: number, profile?: 'product') => {
    assertUploadablePhoto(file);
    const form = new FormData();
    form.append('photo', file);
    // Icons are drawn tiny in the customer app; cap them server-side so the
    // stored/served WebP stays a few KB instead of the default 1600px.
    if (maxDimension) form.append('maxDimension', String(maxDimension));
    if (profile) form.append('profile', profile);
    return api.post('/admin/upload/photo', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ── Categories ────────────────────────────────────────────────────────────────
export const categoriesApi = {
  getAll: (opts?: FetchOpts) => api.get('/admin/categories', { fresh: opts?.fresh }),
  create: (data: any) => api.post('/admin/categories', data),
  update: (id: string, data: any) => api.put(`/admin/categories/${id}`, data),
  delete: (id: string) => api.delete(`/admin/categories/${id}`),
};

// ── Orders ────────────────────────────────────────────────────────────────────
export type SummaryRange = 'today' | '7d' | '30d' | 'last_month' | 'custom' | 'all';

export interface OrderSummary {
  placed: number;
  pending: number;
  delivered: number;
  cancelled: number;
  preparing: number;
  readyToPickup: number;
  outForDelivery: number;
  pickedUp: number;
  revenue: number;
  avgOrderValue: number;
  deliveryCollected: number;
  freeDeliveries: number;
  couponOrders: number;
  couponAmount: number;
}

export interface FetchOpts { fresh?: boolean }

export const ordersApi = {
  getAll: (params?: { storeId?: string; status?: string; deliveryPreference?: string; phone?: string; q?: string; limit?: number; offset?: number }, opts?: FetchOpts) =>
    api.get('/admin/orders', { params, fresh: opts?.fresh }),
  getSummary: (params?: { storeId?: string; range?: SummaryRange; from?: string; to?: string; dateBasis?: 'created' | 'browse' }, opts?: FetchOpts) =>
    api.get('/admin/analytics/summary', { params, fresh: opts?.fresh }),
  updateStatus: (id: string, status: string, failureReason?: string, cancellationReason?: string, deliveryAssigneeId?: string, paymentMethod?: 'cash' | 'upi', forceReadyPickup?: boolean) =>
    api.put(`/admin/orders/${id}/status`, { status, failureReason, cancellationReason, deliveryAssigneeId, paymentMethod, forceReadyPickup }),
  declineCancellationRequest: (id: string) => api.put(`/admin/orders/${id}/cancellation-request/decline`),
  updateFulfilment: (id: string, storeId: string, status: 'prepared' | 'delivered' | 'picked_up') =>
    api.put(`/admin/orders/${id}/fulfilments/${storeId}`, { status }),
  // Manage an order's lines: send delivered quantities per line (0 removes the
  // line) and/or add new products. The backend recalculates totals, restores
  // stock for removals and deducts stock for additions.
  manageOrder: (
    id: string,
    adjustments: Array<{ orderItemId: string; deliveredQuantity: number }>,
    reason: string,
    paymentMethod?: 'cod' | 'upi',
    additions?: Array<{ productId: string; quantity: number; unit?: string; price?: number }>,
  ) => api.put(`/admin/orders/${id}/items`, { adjustments, reason, paymentMethod, additions }),
  reschedule: (id: string, scheduledFor: string) =>
    api.put(`/admin/orders/${id}/reschedule`, { scheduledFor }),
  // Acknowledge an after-hours order for delivery at the next opening hours
  // (only offered while the order is still pending and was placed outside
  // posted store hours).
  confirmNextOpen: (id: string) =>
    api.put(`/admin/orders/${id}/confirm-next-open`),
  batchDispatch: (orderIds: string[]) =>
    api.post('/admin/orders/batch-dispatch', { orderIds }),
  terminate: (id: string, reason: string, customReason?: string) =>
    api.put(`/admin/orders/${id}/terminate`, { reason, customReason }),
  lookupRestore: (phone: string) =>
    api.get('/admin/orders/restore/lookup', { params: { phone }, fresh: true }),
  restore: (data: {
    phone: string;
    cartId: string;
    status: string;
    orderNumber?: string;
    storeId?: string;
    deliveryCharge?: number;
    paymentMethod?: 'cod' | 'upi' | 'phonepay';
    guestName?: string;
    guestAddress?: string;
    notes?: string;
  }) => api.post('/admin/orders/restore', data),
};

// ── Customers ─────────────────────────────────────────────────────────────────
export interface CustomerAggregates {
  totalCustomers: number;
  newCustomers: number;
  repeatCustomers: number;
  avgOrders: number;
  top: Array<{ id: string; name: string; phone: string; orderCount: number; totalSpent: number }>;
}

export type CustomerSort = 'orders_desc' | 'spend_desc' | 'name_asc' | 'newest';

export interface CustomerStats {
  totalCustomers: number;
  totalRevenue: number;
  totalOrders: number;
  repeatCustomers: number;
  newCustomers: number;
  avgOrders: number;
}

export const customersApi = {
  getAll: (params?: { identity?: 'all' | 'signed_in' | 'guest_checkout'; search?: string; sort?: CustomerSort; limit?: number; offset?: number; range?: SummaryRange; from?: string; to?: string }) =>
    api.get('/admin/customers', { params }),
  getAggregates: (params?: { storeId?: string; range?: SummaryRange; from?: string; to?: string; top?: number; dateBasis?: 'created' | 'browse' }, opts?: FetchOpts) =>
    api.get('/admin/analytics/customers', { params, fresh: opts?.fresh }),
};

export type FunnelRange = 'today' | '7d' | '30d' | 'custom' | 'all';

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export interface FunnelDropoff {
  retriedNeverVerified: number;
  verifiedNeverOrdered: number;
  avgOtpRequests: number;
}

export interface FunnelSummary {
  range: FunnelRange;
  stages: FunnelStage[];
  dropoff: FunnelDropoff;
  daily: { date: string; visits: number; requested: number; verified: number; ordered: number }[];
  totals: { customers: number; orders: number; revenue: number };
  eventStages: { key: string; label: string; sessions: number }[];
  channels: { channel: string; sessions: number; ordered: number }[];
  attribution: {
    campaignId: string;
    campaignName: string;
    code: string | null;
    firstTouchOrders: number;
    lastTouchOrders: number;
  }[];
  cart: { carts: number; reachedCheckout: number; converted: number; abandoned: number };
  analytics?: {
    timezone: 'Asia/Kolkata';
    acquisition: { sessions: number; uniqueVisitors: number; newVisitors: number; returningVisitors: number };
    customerLifecycle: { newCustomers: number; returningCustomers: number };
    sessionFunnel: { key: string; label: string; count: number }[];
    nonEngagedSessions: number;
    largestDrop: { from: string; to: string; count: number; percent: number } | null;
    productDiscovery: { categoryInteractionSessions: number; searchInteractionSessions: number; productViewSessions: number; productViewEvents: number; zeroResultSearches: number };
    eventTotals: { key: string; count: number }[];
    otp: { mobileInteractions: number; otpRequests: number; otpVerified: number };
    orders: { placed: number; accepted: number; preparing: number; outForDelivery: number; delivered: number; paid: number; cancelled: number; gmv: number };
    channels: { source: string; sessions: number; cartSessions: number; checkoutSessions: number; orders: number }[];
    reconciliation: { orderTableCount: number; attributedOrderCount: number; unattributedOrderCount: number; guestOrderCount: number; customerLinkedOrderCount: number };
    devices: {
      platforms: { platform: string; sessions: number; cartSessions: number; checkoutSessions: number; orders: number }[];
      browsers: { browser: string; sessions: number }[];
      installed: { pwaSessions: number; browserSessions: number };
    };
    journey: {
      stopPoints: { key: string; label: string; sessions: number }[];
      timing: {
        sessions: number;
        avgDurationSeconds: number;
        medianDurationSeconds: number;
        medianSecondsToCart: number | null;
        medianSecondsToCheckout: number | null;
        medianSecondsToOrder: number | null;
      };
    };
    abandonedCarts: {
      carts: number;
      checkoutStage: number;
      cartStage: number;
      value: number;
      topItems: { productId: string; productName: string; unit: string; carts: number; quantity: number; value: number }[];
    };
    retention: {
      granularity: 'week';
      cohorts: { cohort: string; size: number; weeks: { week: number; visitors: number; percent: number }[] }[];
    };
  };
}

export const customerLeadsApi = {
  getAll: (status: 'all' | 'unverified' | 'verified' | 'guest', range: FunnelRange, from?: string, to?: string) => api.get('/admin/customer-leads', { params: { status, range, from, to } }),
  getFunnel: (range: FunnelRange, from?: string, to?: string) => api.get('/admin/customer-funnel/extended', { params: { range, from, to } }),
  downloadMarketingCsv: () => api.get('/admin/customer-leads/export', { responseType: 'blob' }),
};

export const installAnalyticsApi = {
  getSummary: (from?: string, to?: string) => api.get('/admin/install-analytics', { params: { from, to } }),
};

// ── Product suggestions ("Suggest products") ────────────────────────────────────
export type SuggestionStatus = 'new' | 'reviewing' | 'added' | 'declined';
export type BuyerTypeFilter = 'new' | 'repeat';

export interface ProductSuggestion {
  id: string;
  customerId: string | null;
  phone: string | null;
  name: string | null;
  suggestedProduct: string;
  detail: string | null;
  zoneId: string | null;
  zoneName: string | null;
  storeId: string | null;
  storeName: string | null;
  buyerType: BuyerTypeFilter;
  orderCount: number;
  contactConsent: boolean;
  status: SuggestionStatus;
  createdAt: string;
}

export interface SuggestionInsights {
  counts: { total: number; newBuyers: number; repeatBuyers: number; consented: number };
  topProducts: { product: string; count: number }[];
  topZones: { zoneId: string | null; zoneName: string | null; count: number }[];
  byStatus: { status: string; count: number }[];
}

export const suggestionsApi = {
  getAll: (filters: { status?: SuggestionStatus | 'all'; buyerType?: BuyerTypeFilter | 'all'; zoneId?: string }, range: FunnelRange, from?: string, to?: string) =>
    api.get('/admin/suggestions', { params: { ...filters, range, from, to } }),
  getInsights: (range: FunnelRange, from?: string, to?: string) =>
    api.get('/admin/suggestions/insights', { params: { range, from, to } }),
  updateStatus: (id: string, status: SuggestionStatus) =>
    api.put(`/admin/suggestions/${id}/status`, { status }),
};

// ── Settings ──────────────────────────────────────────────────────────────────
export const settingsApi = {
  getAll: (storeId?: string, opts?: FetchOpts) => api.get('/admin/settings', { params: storeId ? { storeId } : {}, fresh: opts?.fresh }),
  update: (settings: Record<string, string>, storeId?: string) =>
    api.put('/admin/settings', settings, { params: storeId ? { storeId } : {} }),
};

// ── Delivery Zones ────────────────────────────────────────────────────────────
export const zonesApi = {
  getAll: (storeId?: string) => api.get('/admin/zones', { params: storeId ? { storeId } : {} }),
  create: (data: { name: string; lat: number; lng: number; radiusKm: number; storeId?: string }) =>
    api.post('/admin/zones', data),
  update: (id: string, data: Partial<{ name: string; lat: number; lng: number; radiusKm: number; isActive: boolean; openingHours: any }>) =>
    api.put(`/admin/zones/${id}`, data),
  delete: (id: string) => api.delete(`/admin/zones/${id}`),
  /** Replace the zone's tagged stores. */
  tagStores: (id: string, storeIds: string[]) => api.post(`/admin/zones/${id}/stores`, { storeIds }),
  /** Set the zone head (the store the customer app sees as the zone's face). */
  setPrimary: (id: string, storeId: string) => api.put(`/admin/zones/${id}/primary`, { storeId }),
  getSettings: (id: string) => api.get(`/admin/zones/${id}/settings`),
  updateSettings: (id: string, values: Record<string, string>) => api.put(`/admin/zones/${id}/settings`, values),
};

export type PromotionType = 'new_product' | 'combo' | 'offer' | 'back_in_stock' | 'we_miss_you' | 'custom';
export type PromotionStatus = 'draft' | 'sending' | 'sent' | 'cancelled';
export type AudienceCohort = 'recent_purchaser' | 'winback_7' | 'winback_15' | 'winback_30' | 'first_order_followup' | 'repeat_buyer';

export interface PromotionAudienceRules {
  cohorts: AudienceCohort[];
}

export interface PromotionAudienceExclusions {
  notConsented: number;
  noSubscription: number;
  cohortMismatch: number;
  sentPromotionLast7d: number;
  activeOrder: number;
  recentDelivery: number;
  recentCancellationOrFailure: number;
  lateDeliverySuppression: number;
}

export interface PromotionPreview {
  recipients: number;
  subscriptions: number;
  exclusions: PromotionAudienceExclusions;
}

export interface Promotion {
  id: string;
  type: PromotionType;
  title: string;
  body: string;
  image_url: string | null;
  destination_url: string;
  zone_ids: string[] | null;
  audience_rules: PromotionAudienceRules | null;
  status: PromotionStatus;
  scheduled_at: string | null;
  created_at: string;
  sent_at: string | null;
  recipient_count: number;
  delivery_count: number;
  fail_count: number;
  clickCount: number;
  deliveredCount?: number;
}

export interface PromotionInput {
  type: PromotionType;
  title: string;
  body: string;
  imageUrl?: string | null;
  destinationUrl: string;
  zoneIds?: string[] | null;
  audienceRules?: PromotionAudienceRules;
  scheduledAt?: string | null;
}

export const promotionsApi = {
  getAll: () => api.get<{ success: boolean; data: Promotion[] }>('/admin/promotions'),
  create: (data: PromotionInput) => api.post<{ success: boolean; data: Promotion }>('/admin/promotions', data),
  update: (id: string, data: Partial<PromotionInput>) => api.put<{ success: boolean; data: Promotion }>(`/admin/promotions/${id}`, data),
  delete: (id: string) => api.delete(`/admin/promotions/${id}`),
  preview: (id: string) => api.post<{ success: boolean; data: PromotionPreview }>(`/admin/promotions/${id}/preview`),
  test: (id: string) => api.post<{ success: boolean; data: { sent: number; failed: number } }>(`/admin/promotions/${id}/test`),
  send: (id: string) => api.post<{ success: boolean; data: { sent: number; failed: number; recipients: number } }>(`/admin/promotions/${id}/send`),
};

// ── Stores ────────────────────────────────────────────────────────────────────
export const storesApi = {
  getAll: () => api.get('/admin/stores'),
  create: (data: { name: string; address?: string; ownerName?: string; supportPhone?: string; logoUrl?: string; monthlyFee?: number; estimatedDelivery?: string }) => api.post('/admin/stores', data),
  update: (id: string, data: { name?: string; address?: string; isActive?: boolean; isLive?: boolean; ownerName?: string; supportPhone?: string; logoUrl?: string; openingHours?: any; monthlyFee?: number; estimatedDelivery?: string }) =>
    api.put(`/admin/stores/${id}`, data),
  // Branded store fields for a non-super-admin (opening hours, logo, support
  // phone, owner name). Must be used instead of update() by store owners and
  // managers: update() is requireSuperAdmin and answers 403, which is why
  // saving opening hours appeared to do nothing.
  updateSettings: (id: string, data: { ownerName?: string; supportPhone?: string; logoUrl?: string; openingHours?: any }) =>
    api.put(`/admin/stores/${id}/settings`, data),
};

export const subscriptionsApi = {
  getAll: () => api.get('/admin/store-subscriptions'),
  update: (storeId: string, data: { planName: string; amount: number; status: 'pending' | 'active' | 'suspended' | 'expired' | 'cancelled'; startsAt: string | null; endsAt: string | null; paymentReference?: string; notes?: string }) =>
    api.put(`/admin/stores/${storeId}/subscription`, data),
};

export const storeApplicationsApi = {
  getAll: () => api.get('/admin/store-applications'),
  update: (id: string, status: 'approved' | 'rejected') => api.put(`/admin/store-applications/${id}`, { status }),
};

// ── Users ────────────────────────────────────────────────────────────────────
export const usersApi = {
  getAll: () => api.get('/admin/users'),
  create: (data: { username: string; password: string; name?: string; email?: string; phone?: string; role: string; storeId?: string }) =>
    api.post('/admin/users', data),
  update: (id: string, data: { name?: string; email?: string; phone?: string; role?: string; storeId?: string; password?: string; isActive?: boolean }) =>
    api.put(`/admin/users/${id}`, data),
  delete: (id: string) => api.delete(`/admin/users/${id}`),
};

// ── Compliance (DPDP) ────────────────────────────────────────────────────────────
export const complianceApi = {
  getDeletions: () => api.get('/admin/compliance/deletions'),
  processDeletion: (id: string, action: 'approved' | 'rejected', notes?: string) =>
    api.put(`/admin/compliance/deletions/${id}`, { action, notes }),
  getGrievances: () => api.get('/admin/compliance/grievances'),
  respondGrievance: (id: string, response: string, status: string) =>
    api.put(`/admin/compliance/grievances/${id}`, { response, status }),
};

// ── Catalog ────────────────────────────────────────────────────────────────────────────────
export const catalogApi = {
  getAll: (params?: { categoryId?: string; search?: string }) =>
    api.get('/admin/catalog', { params }),
  create: (data: { name: string; localName?: string; searchAliases?: string[]; description?: string; photoUrl?: string; photos?: string[]; photoVariants?: Array<{ assetId?: string; thumbnailUrl: string; largeUrl: string }>; imageAssetIds?: string[]; categoryId?: string; photoLocalPath?: string }) =>
    api.post('/admin/catalog', data),
  update: (id: string, data: { name?: string; localName?: string; searchAliases?: string[]; description?: string; photoUrl?: string; photos?: string[]; photoVariants?: Array<{ assetId?: string; thumbnailUrl: string; largeUrl: string }>; imageAssetIds?: string[]; categoryId?: string }) =>
    api.put(`/admin/catalog/${id}`, data),
  delete: (id: string) => api.delete(`/admin/catalog/${id}`),
  bulkAddToStore: (productIds: string[], storeId?: string) =>
    api.post('/admin/products/bulk-from-catalog', { productIds }, { params: storeId ? { storeId } : {} }),
};
// ── Inventory ────────────────────────────────────────────────────────────────
export const inventoryApi = {
  getStores:  () => api.get('/admin/inventory/stores'),
  getSettings: (storeId?: string) => api.get('/admin/inventory/settings', { params: storeId ? { storeId } : {} }),
  updateSettings: (data: { inventoryTracking?: boolean; autoOutOfStock?: boolean; lowStockThreshold?: number }, storeId?: string) =>
    api.put('/admin/inventory/settings', data, { params: storeId ? { storeId } : {} }),
  getAll:     (storeId?: string, opts?: FetchOpts) => api.get('/admin/inventory', { params: storeId ? { storeId } : {}, fresh: opts?.fresh }),
  bulkRestock: (items: Array<{ productId: string; qty: number; stockUnit: string }>, note: string, storeId?: string, idempotencyKey?: string) =>
    api.post('/admin/inventory/bulk-restock', { items, note }, { params: storeId ? { storeId } : {}, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  restock:    (productId: string, qty: number, note: string, storeId?: string, stockUnit?: string, idempotencyKey?: string, unitCost?: number) =>
    api.post(`/admin/inventory/${productId}/restock`, { qty, note, stockUnit, unitCost }, { params: storeId ? { storeId } : {}, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  setStock:   (productId: string, qty: number, storeId?: string, idempotencyKey?: string, stockUnit?: string) =>
    api.put(`/admin/inventory/${productId}/stock`, { qty, stockUnit }, { params: storeId ? { storeId } : {}, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  getHistory: (productId: string, storeId?: string) =>
    api.get(`/admin/inventory/${productId}/history`, { params: storeId ? { storeId } : {} }),
  recordPurchase: (productId: string, quantity: number, unit: string, unitCost: number, note?: string, storeId?: string, idempotencyKey?: string) =>
    api.post('/admin/inventory/purchase', { productId, quantity, unit, unitCost, note }, { params: storeId ? { storeId } : {}, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  getMovements: (storeId?: string, productId?: string, limit?: number) =>
    api.get('/admin/inventory/movements', { params: { ...(storeId ? { storeId } : {}), ...(productId ? { productId } : {}), ...(limit ? { limit } : {}) } }),
  adjustStock: (productId: string, quantity: number, reason: string, note?: string, storeId?: string, idempotencyKey?: string) =>
    api.post('/admin/inventory/adjust', { productId, quantity, reason, note }, { params: storeId ? { storeId } : {}, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  createTransfer: (destinationStoreId: string, items: Array<{ productId: string; quantity: number; unit: string }>, notes?: string, storeId?: string, idempotencyKey?: string) =>
    api.post('/admin/inventory/transfers', { destinationStoreId, items, notes }, { params: storeId ? { storeId } : {}, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  receiveTransfer: (transferId: string, lines: Array<{ lineId: string; receivedQuantity: number }>, idempotencyKey?: string) =>
    api.post(`/admin/inventory/transfers/${transferId}/receive`, { lines }, { headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  listTransfers: (storeId?: string) => api.get('/admin/inventory/transfers', { params: storeId ? { storeId } : {} }),
  customerReturn: (orderId: string, productId: string, quantity: number, condition: 'resalable' | 'damaged', unit?: string, note?: string, storeId?: string, idempotencyKey?: string) =>
    api.post('/admin/inventory/returns/customer', { orderId, productId, quantity, condition, unit, note }, { params: storeId ? { storeId } : {}, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  supplierReturn: (productId: string, quantity: number, unit: string, unitCost?: number, note?: string, storeId?: string, idempotencyKey?: string) =>
    api.post('/admin/inventory/returns/supplier', { productId, quantity, unit, unitCost, note }, { params: storeId ? { storeId } : {}, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  stocktake: (items: Array<{ productId: string; countedQuantity: number; unit: string }>, note?: string, storeId?: string, idempotencyKey?: string) =>
    api.post('/admin/inventory/stocktake', { items, note }, { params: storeId ? { storeId } : {}, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  getValuation: (storeId?: string, asOf?: string) => api.get('/admin/inventory/valuation', { params: { ...(storeId ? { storeId } : {}), ...(asOf ? { asOf } : {}) } }),
  getProfitability: (from?: string, to?: string, storeId?: string) => api.get('/admin/inventory/profitability', { params: { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(storeId ? { storeId } : {}) } }),
};

// ── Team Management ───────────────────────────────────────────────────────────
export const teamApi = {
  getStoreTeam: (storeId: string) => api.get(`/admin/stores/${storeId}/team`),
  addMember: (storeId: string, data: { adminId?: string; role: string; username?: string; password?: string; name?: string; phone?: string; email?: string }) =>
    api.post(`/admin/stores/${storeId}/team`, data),
  updateMember: (storeId: string, userId: string, data: { role?: string; isActive?: boolean }) =>
    api.put(`/admin/stores/${storeId}/team/${userId}`, data),
  removeMember: (storeId: string, userId: string) =>
    api.delete(`/admin/stores/${storeId}/team/${userId}`),
  lookupByPhone: (phone: string) => api.get('/admin/users/lookup', { params: { phone } }),
  getUserStores: (userId: string) => api.get(`/admin/users/${userId}/stores`),
  deactivateStore: (storeId: string) => api.put(`/admin/stores/${storeId}/deactivate`),
};

// ── Compliance extras ─────────────────────────────────────────────────────────
export const auditApi = {
  getLogs: (params?: { adminId?: string; action?: string; limit?: number }) =>
    api.get('/admin/compliance/audit-logs', { params }),
};

// ── Feedback ────────────────────────────────────────────────────────────────────────────────
export const feedbackApi = {
  getAll: (params?: { storeId?: string; rating?: number; category?: string; limit?: number; offset?: number }) =>
    api.get('/admin/feedback', { params }),
};

// ── Campaigns ────────────────────────────────────────────────────────────────────────────────
export const campaignsApi = {
  getAll: () => api.get("/admin/campaigns"),
  create: (data: any) => api.post("/admin/campaigns", data),
  update: (id: string, data: any) => api.put("/admin/campaigns/" + id, data),
  delete: (id: string) => api.delete("/admin/campaigns/" + id),
  redemptions: (id: string) => api.get("/admin/campaigns/" + id + "/redemptions"),
  supersede: (id: string, data: any) => api.post("/admin/campaigns/" + id + "/supersede", data),
};

export const carouselApi = {
  getAll: () => api.get("/admin/carousel"),
  getSettings: () => api.get("/admin/carousel/settings"),
  updateSettings: (data: { autoplayEnabled: boolean; autoplayIntervalSeconds: number }) => api.put("/admin/carousel/settings", data),
  create: (data: any) => api.post("/admin/carousel", data),
  update: (id: string, data: any) => api.put("/admin/carousel/" + id, data),
  delete: (id: string) => api.delete("/admin/carousel/" + id),
  reorder: (ids: string[]) => api.post("/admin/carousel/reorder", { ids }),
  uploadImage: (file: File) => {
    assertUploadablePhoto(file);
    const form = new FormData();
    form.append("photo", file);
    return api.post("/admin/upload/photo", form, { headers: { "Content-Type": "multipart/form-data" } });
  },
};

// Homepage sections are per-store, so every call carries the active store id.
export const homeSectionsApi = {
  getAll: (storeId: string) => api.get("/admin/home-sections", { params: { storeId } }),
  create: (storeId: string, data: any) => api.post("/admin/home-sections", data, { params: { storeId } }),
  update: (storeId: string, id: string, data: any) => api.put("/admin/home-sections/" + id, data, { params: { storeId } }),
  duplicate: (storeId: string, id: string) => api.post("/admin/home-sections/" + id + "/duplicate", {}, { params: { storeId } }),
  delete: (storeId: string, id: string) => api.delete("/admin/home-sections/" + id, { params: { storeId } }),
  reorder: (storeId: string, ids: string[]) => api.post("/admin/home-sections/reorder", { ids }, { params: { storeId } }),
};

// Daily sales ledger. App figures are computed live by the backend from
// mart_orders; offline counter sales are itemised rows (one per product sold).
export interface DailySalesDay {
  date: string;
  storeId: string | null;
  ordersDelivered?: number;
  ordersPlaced?: number;
  ordersCancelled: number;
  subtotalValue: number;
  couponDeduction?: number;
  orderValueAfterCoupon: number;
  deliveryCharge: number;
  codValue: number;
  upiValue: number;
  offlineCash: number;
  offlineUpi: number;
  offlineTotal: number;
  offlineEntryCount: number;
  totalDaySales: number;
  hasManualEntry: boolean;
}

export interface OfflineSale {
  id: string;
  date: string;
  storeId: string;
  productId: string | null;
  productName: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  total: number;
  paymentMethod: 'cash' | 'upi';
  notes: string | null;
  recordedBy: { id: string; username: string; name: string | null } | null;
  createdAt: string;
}

export type DailySalesMode = "today" | "yesterday" | "month" | "all" | "custom";

export const dailySalesApi = {
  getDay: (date: string, storeId?: string, opts?: FetchOpts) =>
    api.get("/admin/daily-sales/day", { params: { date, storeId }, fresh: opts?.fresh }),
  getRange: (params: { mode: DailySalesMode; from?: string; to?: string; storeId?: string }, opts?: FetchOpts) =>
    api.get("/admin/daily-sales", { params, fresh: opts?.fresh }),
  getEntries: (date: string, storeId?: string, opts?: FetchOpts) =>
    api.get("/admin/daily-sales/entries", { params: { date, storeId }, fresh: opts?.fresh }),
  addEntry: (data: {
    date: string; productId?: string; quantity: number; amount?: number; unitPrice?: number;
    paymentMethod: 'cash' | 'upi'; notes?: string | null; storeId?: string;
  }) => api.post("/admin/daily-sales/entries", data),
  updateEntry: (data: {
    id: string; date: string; productId?: string; quantity: number; amount?: number; unitPrice?: number;
    paymentMethod: 'cash' | 'upi'; notes?: string | null; storeId?: string;
  }) => api.put(`/admin/daily-sales/entries/${data.id}`, data),
  removeEntry: (id: string, storeId?: string) =>
    api.delete(`/admin/daily-sales/entries/${id}`, { params: { storeId } }),
};

export const topSellingApi = {
  get: (range: '5d' | '10d' | '30d' | 'all' | 'custom', storeId?: string, from?: string, to?: string, opts?: FetchOpts) =>
    api.get('/admin/analytics/top-products', { params: { range, storeId, from, to }, fresh: opts?.fresh }),
};
