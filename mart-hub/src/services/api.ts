import axios from 'axios';

/// <reference types="vite/client" />

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3004/api/v1';

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('mart_admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('mart_admin_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    api.post('/admin/login', { username, password }),
};

// ── Products ──────────────────────────────────────────────────────────────────
export const productsApi = {
  getAll: (storeId?: string) => api.get('/admin/products', { params: storeId ? { storeId } : {} }),
  create: (data: any) => api.post('/admin/products', data),
  update: (id: string, data: any) => api.put(`/admin/products/${id}`, data),
  delete: (id: string) => api.delete(`/admin/products/${id}`),
  uploadPhoto: (file: File) => {
    const form = new FormData();
    form.append('photo', file);
    return api.post('/admin/upload/photo', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ── Categories ────────────────────────────────────────────────────────────────
export const categoriesApi = {
  getAll: () => api.get('/admin/categories'),
  create: (data: any) => api.post('/admin/categories', data),
  update: (id: string, data: any) => api.put(`/admin/categories/${id}`, data),
  delete: (id: string) => api.delete(`/admin/categories/${id}`),
};

// ── Orders ────────────────────────────────────────────────────────────────────
export const ordersApi = {
  getAll: (params?: { storeId?: string; status?: string; phone?: string; limit?: number; offset?: number }) =>
    api.get('/admin/orders', { params }),
  updateStatus: (id: string, status: string, failureReason?: string) =>
    api.put(`/admin/orders/${id}/status`, { status, failureReason }),
  batchDispatch: (orderIds: string[]) =>
    api.post('/admin/orders/batch-dispatch', { orderIds }),
  terminate: (id: string, reason: string, customReason?: string) =>
    api.put(`/admin/orders/${id}/terminate`, { reason, customReason }),
};

// ── Customers ─────────────────────────────────────────────────────────────────
export const customersApi = {
  getAll: () => api.get('/admin/customers'),
};

// ── Settings ──────────────────────────────────────────────────────────────────
export const settingsApi = {
  getAll: (storeId?: string) => api.get('/admin/settings', { params: storeId ? { storeId } : {} }),
  update: (settings: Record<string, string>, storeId?: string) =>
    api.put('/admin/settings', settings, { params: storeId ? { storeId } : {} }),
};

// ── Delivery Zones ────────────────────────────────────────────────────────────
export const zonesApi = {
  getAll: (storeId?: string) => api.get('/admin/zones', { params: storeId ? { storeId } : {} }),
  create: (data: { name: string; lat: number; lng: number; radiusKm: number; storeId?: string }) =>
    api.post('/admin/zones', data),
  update: (id: string, data: Partial<{ name: string; lat: number; lng: number; radiusKm: number; isActive: boolean }>) =>
    api.put(`/admin/zones/${id}`, data),
  delete: (id: string) => api.delete(`/admin/zones/${id}`),
};

// ── Stores ────────────────────────────────────────────────────────────────────
export const storesApi = {
  getAll: () => api.get('/admin/stores'),
  create: (data: { name: string; address?: string; ownerName?: string; supportPhone?: string; logoUrl?: string; revenueModel?: string; commissionPercent?: number; monthlyFee?: number; estimatedDelivery?: string }) => api.post('/admin/stores', data),
  update: (id: string, data: { name?: string; address?: string; isActive?: boolean; isLive?: boolean; ownerName?: string; supportPhone?: string; logoUrl?: string; openingHours?: any; revenueModel?: string; commissionPercent?: number; monthlyFee?: number; estimatedDelivery?: string }) =>
    api.put(`/admin/stores/${id}`, data),
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
  update: (id: string, data: { name?: string; email?: string; phone?: string; role?: string; storeId?: string; password?: string }) =>
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
