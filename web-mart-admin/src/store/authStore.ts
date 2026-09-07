import { create } from 'zustand';

interface AuthState {
  token: string | null;
  username: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  storeId: string | null;
  lastLoginAt: string | null;
  isAuthenticated: boolean;
  isSuperAdmin: () => boolean;
  login: (token: string, data: { username: string; name: string; email?: string | null; phone?: string | null; role?: string; storeId?: string | null }) => void;
  setProfile: (data: { name?: string; email?: string | null; phone?: string | null }) => void;
  setName: (name: string) => void;
  logout: () => void;
}

const get = (key: string) => localStorage.getItem(key);
const set = (key: string, val: string | null) => val ? localStorage.setItem(key, val) : localStorage.removeItem(key);

export const useAuthStore = create<AuthState>((setState) => ({
  token:       get('mart_admin_token'),
  username:    get('mart_admin_username'),
  name:        get('mart_admin_name'),
  email:       get('mart_admin_email'),
  phone:       get('mart_admin_phone'),
  role:        get('mart_admin_role'),
  storeId:     get('mart_admin_store_id'),
  lastLoginAt: get('mart_admin_last_login'),
  isAuthenticated: !!get('mart_admin_token'),
  isSuperAdmin: () => !get('mart_admin_store_id'),

  login: (token, data) => {
    set('mart_admin_token',    token);
    set('mart_admin_username', data.username);
    set('mart_admin_name',     data.name);
    set('mart_admin_email',    data.email || null);
    set('mart_admin_phone',    data.phone || null);
    set('mart_admin_role',     data.role || 'super_admin');
    set('mart_admin_store_id', data.storeId || null);
    setState({ token, username: data.username, name: data.name, email: data.email || null, phone: data.phone || null, role: data.role || 'super_admin', storeId: data.storeId || null, isAuthenticated: true });
  },

  setProfile: (data) => {
    if (data.name !== undefined)  { set('mart_admin_name',  data.name);  setState({ name: data.name }); }
    if (data.email !== undefined) { set('mart_admin_email', data.email); setState({ email: data.email }); }
    if (data.phone !== undefined) { set('mart_admin_phone', data.phone); setState({ phone: data.phone }); }
  },

  setName: (name) => {
    set('mart_admin_name', name);
    setState({ name });
  },

  logout: () => {
    ['mart_admin_token','mart_admin_username','mart_admin_name','mart_admin_email','mart_admin_phone','mart_admin_role','mart_admin_store_id','mart_admin_last_login']
      .forEach(k => localStorage.removeItem(k));
    setState({ token: null, username: null, name: null, email: null, phone: null, role: null, storeId: null, lastLoginAt: null, isAuthenticated: false });
  },
}));
