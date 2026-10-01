import axios from 'axios';

const configuredApiUrl = (import.meta as any).env?.VITE_API_URL?.trim();
const isDevelopment = Boolean((import.meta as any).env?.DEV);
export const API_URL = configuredApiUrl || (isDevelopment ? 'http://localhost:3004/api/v1' : '');

export const isApiConfigured = Boolean(API_URL);

export const api = axios.create({ baseURL: API_URL });

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

export interface Category {
  id: string; name: string; slug: string; icon: string; productCount: number;
}

export interface Product {
  id: string; name: string; localName: string | null; description: string | null;
  photoUrl: string | null; price: number; unit: string;
  weightOptions: Array<{ label: string; price: number }> | null;
  discountPercent: number; isAvailable: boolean;
  availabilityStatus: 'available' | 'out_of_stock' | 'hidden';
  categoryId: string; categoryName: string;
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

export interface PublicSettings {
  store_name: string; store_address: string; delivery_charge: string;
  free_delivery_above: string; min_order_amount: string;
  delivery_area: string; store_open: string; estimated_delivery: string;
  cod_enabled: string; upi_enabled: string; phonepay_enabled: string;
  phonepay_qr_url: string; upi_phone: string; upi_id: string;
  whatsapp_number: string; support_name: string; support_phone: string;
  openState?: StoreOpenState;
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
  updateProfile: (data: { name?: string; address?: string; address2?: string; photoUrl?: string }) => api.put('/auth/profile', data),
  getOrders: () => api.get('/auth/orders'),
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

export const storeApi = {
  getCategories: () => api.get<{ success: boolean; data: Category[] }>('/categories'),
  getProducts: (categoryId?: string, storeId?: string) =>
    api.get<{ success: boolean; data: Product[] }>('/products', {
      params: { ...(categoryId ? { categoryId } : {}), ...(storeId ? { storeId } : {}) },
    }),
  getSettings: (storeId?: string) => api.get<{ success: boolean; data: PublicSettings }>('/settings/public', {
    params: storeId ? { storeId } : {},
  }),
  getZones: () => api.get<{ success: boolean; data: MartZone[] }>('/zones'),
  reverseGeocode: (latitude: number, longitude: number) =>
    api.post<{ success: boolean; data: { house: string; building: string; locality: string; city: string; pincode: string } }>('/geocode/reverse', { latitude, longitude }),
  placeOrder: (data: {
    guestName: string; guestPhone: string; guestAddress: string;
    guestAddressLabel?: string;
    latitude?: number | null; longitude?: number | null;
    zoneName?: string; storeId?: string;
    deliveryPreference?: string; deliveryNote?: string;
    items: Array<{ productId: string; productName: string; unit: string; price: number; quantity: number }>;
    paymentMethod: 'cod' | 'upi' | 'phonepay'; notes?: string;
    campaignId?: string; couponCode?: string;
    /** Closes the cart funnel. Optional; the server ignores a malformed value. */
    funnelSessionId?: string;
  }, idempotencyKey: string) => api.post('/orders', data, { headers: { 'Idempotency-Key': idempotencyKey } }),
  trackOrdersByTokens: (tokens: string[]) => api.get('/orders/track/tokens', { params: { tokens: tokens.join(',') } }),
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
