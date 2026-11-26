import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from '@/constants/config';
import { newIdempotencyKey } from '@/utils/idempotency';

export const api = axios.create({ baseURL: API_URL, timeout: 30000 });

api.interceptors.request.use(async config => {
  const token = await SecureStore.getItemAsync('mart-auth-token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Types ────────────────────────────────────────────────────────────────────

export interface Category {
  id: string; name: string; slug: string; icon: string; productCount: number;
}

export interface WeightOption {
  label: string; price: number; discountPercent?: number; approxWeight?: string | null;
}

export interface Product {
  id: string; name: string; localName: string | null; description: string | null;
  storeId?: string;
  photoUrl: string | null; price: number; unit: string;
  photos?: string[] | null;
  photoVariants?: Array<{ smallUrl?: string | null; thumbnailUrl: string; largeUrl: string }> | null;
  thumbnailUrl?: string | null;
  largeUrl?: string | null;
  weightOptions: WeightOption[] | null;
  discountPercent: number; isAvailable: boolean;
  availabilityStatus: 'available' | 'out_of_stock' | 'hidden';
  categoryId: string; categoryName: string;
  mrp?: number | null;
  searchAliases?: string[];
  isBundle?: boolean;
  sortOrder?: number;
  approxWeight?: string | null;
}

export interface HomeSection {
  id: string;
  kind?: 'manual' | 'category' | 'combo' | 'deals' | 'bestsellers' | 'new_arrivals' | 'buy_again' | 'banner' | 'referral_banner' | 'category_tiles' | 'fresh' | string;
  sectionKey?: 'todays_combos' | 'fresh_vegetables' | 'deals' | 'top_picks' | string;
  title: string;
  subtitle: string | null;
  sortOrder: number;
  isEnabled: boolean;
  layout?: 'row' | 'grid' | 'hero' | 'tiles' | null;
  badge?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  visibilityRule?: string | null;
  config: {
    categorySlug?: string | null;
    categorySlugs?: string[];
    productIds?: string[];
    excludeProductIds?: string[];
    limit?: number | null;
    layout?: 'row' | 'grid' | 'hero' | 'tiles' | null;
    fallback?: 'none' | 'bestsellers' | 'new_arrivals';
    sort?: 'catalogue' | 'discount' | 'price_asc' | 'price_desc' | 'newest' | 'bestselling';
    inStockOnly?: boolean;
    minDiscount?: number;
    windowDays?: number;
    imageUrl?: string | null;
    aspectRatio?: string | null;
    buttonColor?: string | null;
    href?: string | null;
    alt?: string | null;
    columns?: number | null;
  };
  items?: Product[];
}

export interface StoreOpenState {
  isOpen: boolean;
  closedReason: 'manual' | 'outside_hours' | 'never_opens' | null;
  nextOpenAt: string | null;
  nextOpenLabel: string | null;
  closedUntilLabel?: string | null;
  closesAtLabel: string | null;
}

export type StoreOpeningHours =
  Record<string, { open?: string; close?: string; closed?: boolean } | null | undefined> | null;

export interface PublicSettings {
  store_name: string; store_address: string; delivery_charge: string;
  free_delivery_above: string; min_order_amount: string;
  delivery_area: string; store_open: string; estimated_delivery: string;
  cod_enabled: string; upi_enabled: string; phonepay_enabled: string;
  inventory_tracking?: string; auto_out_of_stock?: string;
  phonepay_qr_url: string; upi_phone: string; upi_id: string;
  whatsapp_number: string; support_name: string; support_phone: string;
  store_closed_message?: string;
  store_closed_greeting?: string;
  store_closed_from?: string;
  store_closed_until?: string;
  openState?: StoreOpenState;
  openingHours?: StoreOpeningHours;
}

export interface MartZone {
  id: string; storeId: string; name: string;
  lat: number; lng: number; radiusKm: number; isActive: boolean;
}

export interface Order {
  id: string; orderNumber: string; status: string;
  subtotal: number; deliveryCharge: number; total: number;
  campaignDiscount?: number; couponCodeUsed?: string | null;
  paymentMethod: string; createdAt: string; updatedAt?: string;
  storeName?: string; storeAddress?: string; fulfilledBy?: string;
  deliveryByName?: string; deliveryByPhone?: string;
  deliveryPreference?: string; cancellationReason?: string;
  items: Array<{
    productId: string; productName: string;
    unit: string; price: number; quantity: number;
    total: number; photoUrl?: string | null;
  }>;
  guestAddress: string; guestName?: string; guestPhone?: string;
  placedOutsideHours?: boolean;
  closedReason?: 'manual' | 'outside_hours' | 'never_opens' | null;
  scheduledFor?: string | null;
  scheduledForLabel?: string | null;
  referralDiscount?: number;
  referralCreditId?: string | null;
  itemSavings?: number;
  freeDeliverySaving?: number;
  trackingToken?: string;
}

export interface Grievance {
  id: string; subject: string; description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  response: string | null; createdAt: string;
}

export interface Address {
  id: string; label: string; addressLine: string; isDefault: boolean; createdAt: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface CarouselCard {
  id: string;
  title: string | null;
  subtitle: string | null;
  image_url: string | null;
  gradient: string;
  campaign_id: string | null;
  discountType: string | null;
  discountValue: number | null;
  couponCode: string | null;
}

export interface CatalogStamp {
  stamp: string;
}

export interface RecommendationResult {
  mode: 'free_delivery' | 'discovery';
  remainingForFreeDelivery: number;
  freeDeliveryThreshold: number;
  deliveryCharge: number;
  products: Product[];
}

export interface ReferralCredit {
  id: string;
  benefitType: 'first_order' | 'reward' | string;
  referralId: string | null;
  rewardId?: string | null;
  amount: number;
  status: string;
  stageNumber: number | null;
  redemptionMinOrderAmount?: number | null;
  redeemableNow?: boolean;
  unlockedAt: string | null;
  expiresAt: string | null;
  reservationExpiresAt: string | null;
  orderId: string | null;
}

export interface ReferralCampaign {
  name: string;
  status: string;
  totalRewardAmount: number;
  rewardStages: Array<{ stage: number; amount: number }>;
  redemptionMinOrderAmount?: number | null;
  expiryDays: number;
  maxReferralsPerReferrer: number;
}

export interface ReferralStats {
  totalEarned: number;
  available: number;
  redeemableNow?: number;
  used: number;
  pending: number;
  expired: number;
  reversed: number;
  successfulReferrals: number;
  pendingReferrals: number;
}

export interface ReferralRecord {
  id: string;
  role: 'referrer' | 'referee';
  status: string;
  attributedAt: string | null;
  rewardedAt: string | null;
  qualifyingOrderId: string | null;
  firstOrderCreditId: string | null;
  notes: string | null;
}

export interface ReferralMeData {
  code: string;
  campaign: ReferralCampaign;
  minimumOrderAmount: number;
  redemptionMinimum?: number;
  stats: ReferralStats;
  eligibleForCode: boolean;
  credits: ReferralCredit[];
  referrals: ReferralRecord[];
}

export interface ReferralValidateData {
  valid: boolean;
  reason?: string;
  [key: string]: unknown;
}

export interface ReferralReservation {
  id: string;
  amount: number;
  status: string;
  reservationExpiresAt: string | null;
  duplicate?: boolean;
}

export interface DataExport {
  id: string;
  status: string;
  data?: Record<string, unknown> | null;
  createdAt?: string;
  readyAt?: string | null;
}

export interface DeletionStatus {
  id: string;
  status: string;
  reason?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string | null;
}

export interface VerifyOtpOptions {
  funnelSessionId?: string;
  trackingTokens?: string[];
  referralCode?: string;
}

export interface CampaignCartItem {
  categoryId?: string | null;
  price?: number | string;
  quantity?: number;
}

export interface FunnelEventBody {
  sessionId: string;
  visitorId?: string;
  eventName: string;
  channel?: string;
  path?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  source?: string;
  medium?: string;
  content?: string;
  term?: string;
  qrCodeId?: string;
  platform?: string;
  deviceCategory?: string;
  browser?: string;
  isPwa?: boolean;
  props?: Record<string, unknown>;
}

export interface FunnelCartBody {
  sessionId: string;
  items: unknown[];
  reachedCheckout?: boolean;
}

export interface FunnelCampaignBody {
  sessionId: string;
  campaignId: string;
}

// ── Auth API ─────────────────────────────────────────────────────────────────

export const authApi = {
  sendOtp: (phone: string) => api.post('/auth/send-otp', { phone }),
  verifyOtp: (phone: string, otp: string, options?: VerifyOtpOptions) =>
    api.post('/auth/verify-otp', {
      phone,
      otp,
      ...(options?.funnelSessionId ? { funnelSessionId: options.funnelSessionId } : {}),
      ...(options?.trackingTokens?.length ? { trackingTokens: options.trackingTokens } : {}),
      ...(options?.referralCode ? { referralCode: options.referralCode } : {}),
    }),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me'),
  updateProfile: (data: { name?: string; address?: string; address2?: string }) =>
    api.put('/auth/profile', data),
  getOrders: () => api.get<{ success: boolean; data: Order[] }>('/auth/orders'),
  cancelOrder: (orderId: string, reason?: string) => api.put(`/auth/orders/${orderId}/cancel`, { reason }),
  requestCancellation: (orderId: string, reason: string) =>
    api.post(`/auth/orders/${orderId}/cancellation-request`, { reason }),
  requestDeletion: (reason?: string) => api.post('/compliance/deletion', { reason }),
  getDeletionStatus: () => api.get<{ success: boolean; data: DeletionStatus | null }>('/compliance/deletion'),
  submitGrievance: (subject: string, description: string) =>
    api.post('/compliance/grievances', { subject, description }),
  getGrievances: () => api.get<{ success: boolean; data: Grievance[] }>('/compliance/grievances'),
  getMarketingConsent: () => api.get('/compliance/marketing-consent'),
  updateMarketingConsent: (granted: boolean) => api.put('/compliance/marketing-consent', { granted }),
  requestDataExport: () => api.post('/compliance/data-export'),
  getDataExport: () => api.get<{ success: boolean; data: DataExport | null }>('/compliance/data-export'),
  updateGuestMarketingConsent: (trackingToken: string, granted: boolean) =>
    api.put('/push/guest-consent', { trackingToken, granted }),
  uploadPhoto: (uri: string) => {
    const form = new FormData();
    form.append('photo', { uri, name: 'photo.jpg', type: 'image/jpeg' } as any);
    return api.post<{ success: boolean; data: { url: string } }>('/auth/upload/photo', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ── Address book API ──────────────────────────────────────────────────────────

export const addressApi = {
  list: () => api.get<{ success: boolean; data: Address[] }>('/auth/addresses'),
  add: (label: string, addressLine: string, isDefault?: boolean, latitude?: number | null, longitude?: number | null) =>
    api.post<{ success: boolean; data: Address }>('/auth/addresses', { label, addressLine, isDefault, latitude, longitude }),
  update: (id: string, label: string, addressLine: string, latitude?: number | null, longitude?: number | null) =>
    api.put<{ success: boolean; data: Address }>(`/auth/addresses/${id}`, { label, addressLine, latitude, longitude }),
  remove: (id: string) => api.delete(`/auth/addresses/${id}`),
  setDefault: (id: string) => api.put(`/auth/addresses/${id}/default`),
};

// ── Store API ─────────────────────────────────────────────────────────────────

export const storeApi = {
  getCategories: () => api.get<{ success: boolean; data: Category[] }>('/categories'),
  getProducts: (categoryId?: string, storeId?: string, zoneId?: string) =>
    api.get<{ success: boolean; data: Product[] }>('/products', {
      params: { ...(categoryId ? { categoryId } : {}), ...(storeId ? { storeId } : {}), ...(zoneId ? { zoneId } : {}) },
    }),
  getProduct: (id: string, storeId?: string, zoneId?: string) =>
    api.get<{ success: boolean; data: Product }>(`/products/${id}`, {
      params: { ...(storeId ? { storeId } : {}), ...(zoneId ? { zoneId } : {}) },
    }),
  getSettings: (storeId?: string, zoneId?: string) =>
    api.get<{ success: boolean; data: PublicSettings }>('/settings/public', {
      params: { ...(storeId ? { storeId } : {}), ...(zoneId ? { zoneId } : {}) },
    }),
  getHomeSections: (storeId?: string) =>
    api.get<{ success: boolean; data: HomeSection[] }>('/home-sections', {
      params: storeId ? { storeId } : {},
    }),
  getCatalogStamp: (storeId?: string, zoneId?: string) =>
    api.get<{ success: boolean; data: CatalogStamp }>('/catalog/stamp', {
      params: { ...(storeId ? { storeId } : {}), ...(zoneId ? { zoneId } : {}) },
    }),
  getZones: () => api.get<{ success: boolean; data: MartZone[] }>('/zones'),
  placeOrder: (data: {
    guestName: string; guestPhone: string; guestAddress: string;
    guestAddressLabel?: string;
    latitude?: number | null; longitude?: number | null;
    zoneId?: string; zoneName?: string; storeId?: string;
    deliveryPreference?: string; deliveryNote?: string;
    scheduledFor?: string; scheduledLabel?: string;
    items: Array<{ productId: string; productName: string; unit: string; price: number; quantity: number; sourceStoreId?: string }>;
    paymentMethod?: 'cod' | 'upi' | 'phonepay'; notes?: string;
    campaignId?: string; couponCode?: string;
    referralCreditId?: string;
    funnelSessionId?: string;
  }, idempotencyKey?: string) =>
    api.post('/orders', (data.campaignId || data.couponCode)
      ? { ...data, referralCreditId: undefined }
      : data, { headers: { 'Idempotency-Key': idempotencyKey || newIdempotencyKey() } }),
  saveGuestDetails: (data: {
    phone: string; name?: string; address: string; label?: string;
    latitude?: number | null; longitude?: number | null;
  }) => api.post('/guest-details', data),
  trackOrders: () => api.get('/orders/track'),
  trackGuestOrders: (phone: string) => api.get('/orders/track/guest', { params: { phone } }),
  trackOrdersByTokens: (tokens: string[]) =>
    api.get('/orders/track/tokens', { params: { tokens: tokens.join(',') } }),
  cancelOrderByToken: (orderId: string, trackingToken: string, reason?: string) =>
    api.post(`/orders/track/${orderId}/cancel`, { trackingToken, reason }),
  requestCancellationByToken: (orderId: string, trackingToken: string, reason: string) =>
    api.post(`/orders/track/${orderId}/cancellation-request`, { trackingToken, reason }),
};

// ── Campaign API ──────────────────────────────────────────────────────────────

export const campaignApi = {
  getWelcome: (cartTotal: number, storeId: string, zoneId?: string, cartItems: CampaignCartItem[] = []) =>
    api.get('/campaigns/welcome', {
      params: { cartTotal, storeId, zoneId, cartItems: JSON.stringify(cartItems) },
    }),
  getEligible: (cartTotal: number, storeId: string, zoneId?: string, cartItems: CampaignCartItem[] = []) =>
    api.get('/campaigns/eligible', {
      params: { cartTotal, storeId, zoneId, cartItems: JSON.stringify(cartItems) },
    }),
  validateCode: (code: string, cartTotal: number, storeId: string, zoneId?: string, cartItems: CampaignCartItem[] = []) =>
    api.post('/campaigns/validate', { code, cartTotal, storeId, zoneId, cartItems }),
  getCarousel: () => api.get<{ success: boolean; data: CarouselCard[] }>('/carousel'),
  getCarouselSettings: () => api.get('/carousel/settings'),
};

// ── Recommendations ───────────────────────────────────────────────────────────

export const recommendationApi = {
  get: (storeId: string, cartItems: Array<{ productId: string }>, cartSubtotal: number, guestPhone?: string) =>
    api.post<{ success: boolean; data: RecommendationResult }>('/recommendations', {
      storeId,
      cartItems,
      cartSubtotal,
      guestPhone: guestPhone || undefined,
    }),
};

// ── Referral & Earn ───────────────────────────────────────────────────────────

export const referralApi = {
  getMe: () => api.get<{ success: boolean; data: ReferralMeData }>('/referrals/me'),
  validate: (code: string) =>
    api.post<{ success: boolean; data: ReferralValidateData }>('/referrals/validate', { code }),
  getCredits: () =>
    api.get<{ success: boolean; data: { items: ReferralCredit[]; total: number } }>('/referrals/credits'),
  reserve: (creditId: string, idempotencyKey: string) =>
    api.post<{ success: boolean; data: ReferralReservation }>('/referrals/credits/reserve', { creditId, idempotencyKey }),
  release: (id: string) =>
    api.post<{ success: boolean; data: { status: 'available' } }>(`/referrals/credits/${encodeURIComponent(id)}/release`, {}),
};

// ── Suggestions ───────────────────────────────────────────────────────────────

export const suggestionApi = {
  submit: (data: {
    suggestedProduct: string;
    detail?: string;
    zoneId?: string | null;
    zoneName?: string | null;
    storeId?: string | null;
    storeName?: string | null;
    contactConsent?: boolean;
  }) => api.post<{ success: boolean; data: { id: string } }>('/suggestions', data),
};

// ── Funnel ────────────────────────────────────────────────────────────────────

export const funnelApi = {
  event: (body: FunnelEventBody) => api.post('/funnel/event', body),
  cart: (body: FunnelCartBody) => api.post('/funnel/cart', body),
  campaign: (body: FunnelCampaignBody) => api.post('/funnel/campaign', body),
  install: (body: { sessionId: string; visitorId?: string; platform: string; eventName: string }) =>
    api.post('/install/event', body),
};

// ── Feedback ──────────────────────────────────────────────────────────────────

export const feedbackApi = {
  submit: (
    data: { rating: number; category: string; message?: string; storeId?: string; orderId?: string },
    idempotencyKey?: string,
  ) => api.post('/feedback', data, { headers: { 'Idempotency-Key': idempotencyKey || newIdempotencyKey() } }),
};
