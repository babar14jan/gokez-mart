import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from '@/constants/config';

export const api = axios.create({ baseURL: API_URL });

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
  label: string; price: number;
}

export interface Product {
  id: string; name: string; localName: string | null; description: string | null;
  photoUrl: string | null; price: number; unit: string;
  weightOptions: WeightOption[] | null;
  discountPercent: number; isAvailable: boolean;
  availabilityStatus: 'available' | 'out_of_stock' | 'hidden';
  categoryId: string; categoryName: string;
}

export interface PublicSettings {
  store_name: string; store_address: string; delivery_charge: string;
  free_delivery_above: string; min_order_amount: string;
  delivery_area: string; store_open: string; estimated_delivery: string;
  cod_enabled: string; upi_enabled: string; phonepay_enabled: string;
  phonepay_qr_url: string; upi_phone: string; upi_id: string;
  whatsapp_number: string; support_name: string; support_phone: string;
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
  storeName?: string; fulfilledBy?: string;
  deliveryByName?: string; deliveryByPhone?: string;
  deliveryPreference?: string; cancellationReason?: string;
  items: Array<{
    productId: string; productName: string;
    unit: string; price: number; quantity: number;
    total: number; photoUrl?: string | null;
  }>;
  guestAddress: string; guestName?: string; guestPhone?: string;
}

export interface Grievance {
  id: string; subject: string; description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  response: string | null; createdAt: string;
}

export interface Address {
  id: string; label: string; addressLine: string; isDefault: boolean; createdAt: string;
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

// ── Auth API ─────────────────────────────────────────────────────────────────

export const authApi = {
  sendOtp:    (phone: string) => api.post('/auth/send-otp', { phone }),
  verifyOtp:  (phone: string, otp: string) => api.post('/auth/verify-otp', { phone, otp }),
  logout:     () => api.post('/auth/logout'),
  getMe:      () => api.get('/auth/me'),
  updateProfile: (data: { name?: string; address?: string; address2?: string }) =>
    api.put('/auth/profile', data),
  getOrders:  () => api.get<{ success: boolean; data: Order[] }>('/auth/orders'),
  cancelOrder: (orderId: string) => api.put(`/auth/orders/${orderId}/cancel`),
  requestDeletion: (reason?: string) => api.post('/compliance/deletion', { reason }),
  submitGrievance: (subject: string, description: string) =>
    api.post('/compliance/grievances', { subject, description }),
  getGrievances: () => api.get<{ success: boolean; data: Grievance[] }>('/compliance/grievances'),
  getMarketingConsent: () => api.get('/compliance/marketing-consent'),
  updateMarketingConsent: (granted: boolean) => api.put('/compliance/marketing-consent', { granted }),
  requestDataExport: () => api.post('/compliance/data-export'),
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
  list:       () => api.get<{ success: boolean; data: Address[] }>('/auth/addresses'),
  add:        (label: string, addressLine: string, isDefault?: boolean) =>
    api.post<{ success: boolean; data: Address }>('/auth/addresses', { label, addressLine, isDefault }),
  update:     (id: string, label: string, addressLine: string) =>
    api.put<{ success: boolean; data: Address }>(`/auth/addresses/${id}`, { label, addressLine }),
  remove:     (id: string) => api.delete(`/auth/addresses/${id}`),
  setDefault: (id: string) => api.put(`/auth/addresses/${id}/default`),
};

// ── Store API ─────────────────────────────────────────────────────────────────

export const storeApi = {
  getCategories: () => api.get<{ success: boolean; data: Category[] }>('/categories'),
  getProducts: (categoryId?: string, storeId?: string) =>
    api.get<{ success: boolean; data: Product[] }>('/products', {
      params: { ...(categoryId ? { categoryId } : {}), ...(storeId ? { storeId } : {}) },
    }),
  getSettings: (storeId?: string) =>
    api.get<{ success: boolean; data: PublicSettings }>('/settings/public', {
      params: storeId ? { storeId } : {},
    }),
  getZones: () => api.get<{ success: boolean; data: MartZone[] }>('/zones'),
  placeOrder: (data: {
    guestName: string; guestPhone: string; guestAddress: string;
    zoneName?: string; storeId?: string;
    deliveryPreference?: string; deliveryNote?: string;
    items: Array<{ productId: string; productName: string; unit: string; price: number; quantity: number }>;
    paymentMethod: 'cod' | 'upi' | 'phonepay'; notes?: string;
    campaignId?: string; couponCode?: string;
  }) => api.post('/orders', data),
  trackOrders: () => api.get('/orders/track'),
};

// ── Campaign API ──────────────────────────────────────────────────────────────

export const campaignApi = {
  getEligible: (cartTotal: number, storeId: string) =>
    api.get('/campaigns/eligible', { params: { cartTotal, storeId } }),
  validateCode: (code: string, cartTotal: number, storeId: string) =>
    api.post('/campaigns/validate', { code, cartTotal, storeId }),
  getCarousel: () => api.get<{ success: boolean; data: CarouselCard[] }>('/carousel'),
};

// ── Feedback API ──────────────────────────────────────────────────────────────

export const feedbackApi = {
  submit: (data: { rating: number; category: string; message?: string; orderId?: string }) =>
    api.post('/feedback', data),
};
