import axios from 'axios';

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3004/api/v1';

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
  id: string; name: string; description: string | null;
  photoUrl: string | null; price: number; unit: string;
  weightOptions: Array<{ label: string; price: number }> | null;
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
  verifyOtp: (phone: string, otp: string) => api.post('/auth/verify-otp', { phone, otp }),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me'),
  updateProfile: (data: { name?: string; address?: string; address2?: string }) => api.put('/auth/profile', data),
  getOrders: () => api.get('/auth/orders'),
  cancelOrder: (orderId: string) => api.put(`/auth/orders/${orderId}/cancel`),
  requestDeletion: (reason?: string) => api.post('/compliance/deletion', { reason }),
  getDeletionStatus: () => api.get('/compliance/deletion'),
  submitGrievance: (subject: string, description: string) => api.post('/compliance/grievances', { subject, description }),
  getGrievances: () => api.get('/compliance/grievances'),
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
  placeOrder: (data: {
    guestName: string; guestPhone: string; guestAddress: string;
    zoneName?: string; storeId?: string;
    deliveryPreference?: string; deliveryNote?: string;
    items: Array<{ productId: string; productName: string; unit: string; price: number; quantity: number }>;
    paymentMethod: 'cod' | 'upi' | 'phonepay'; notes?: string;
  }) => api.post('/orders', data),
  trackOrders: (phone: string) => api.get(`/orders/track/${phone}`),
};
