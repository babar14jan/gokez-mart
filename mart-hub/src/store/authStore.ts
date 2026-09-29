import { create } from 'zustand';

interface AuthState {
  id: string | null;
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
  login: (token: string, data: { id?: string | null; username: string; name: string; email?: string | null; phone?: string | null; role?: string; storeId?: string | null }) => void;
  setProfile: (data: { name?: string; email?: string | null; phone?: string | null }) => void;
  setName: (name: string) => void;
  logout: () => void;
}

const get = (key: string) => localStorage.getItem(key);
const set = (key: string, val: string | null) => val ? localStorage.setItem(key, val) : localStorage.removeItem(key);

// Must stay in sync with ADMIN_ROLES in mart-backend/src/middleware/index.ts.
// 'store_manager' is intentionally listed: the database has never allowed that
// role, so the entry is unreachable rather than a permission grant.
export const KNOWN_ROLES = [
  'super_admin', 'store_owner', 'store_manager', 'sales_manager', 'delivery_staff', 'staff',
] as const;

// No fallback. An unknown or absent role is treated as no access at all — the
// backend stays the authoritative check, this only avoids rendering UI that
// would immediately be rejected.
export const isKnownRole = (role: string | null | undefined): boolean =>
  !!role && (KNOWN_ROLES as readonly string[]).includes(role);

export const useAuthStore = create<AuthState>((setState) => ({
  id:          get('mart_admin_id'),
  token:       get('mart_admin_token'),
  username:    get('mart_admin_username'),
  name:        get('mart_admin_name'),
  email:       get('mart_admin_email'),
  phone:       get('mart_admin_phone'),
  role:        get('mart_admin_role'),
  storeId:     get('mart_admin_store_id'),
  lastLoginAt: get('mart_admin_last_login'),
  isAuthenticated: !!get('mart_admin_token'),
  // Derived from the role claim alone. Previously inferred from the *absence* of a
  // store id, which granted super-admin UI to any token missing that field.
  isSuperAdmin: () => get('mart_admin_role') === 'super_admin',

  login: (token, data) => {
    set('mart_admin_id',       data.id || null);
    set('mart_admin_token',    token);
    set('mart_admin_username', data.username);
    set('mart_admin_name',     data.name);
    set('mart_admin_email',    data.email || null);
    set('mart_admin_phone',    data.phone || null);
    set('mart_admin_role',     data.role || null);
    set('mart_admin_store_id', data.storeId || null);
    setState({ id: data.id || null, token, username: data.username, name: data.name, email: data.email || null, phone: data.phone || null, role: data.role || null, storeId: data.storeId || null, isAuthenticated: true });
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
    ['mart_admin_id','mart_admin_token','mart_admin_username','mart_admin_name','mart_admin_email','mart_admin_phone','mart_admin_role','mart_admin_store_id','mart_admin_last_login']
      .forEach(k => localStorage.removeItem(k));
    setState({ id: null, token: null, username: null, name: null, email: null, phone: null, role: null, storeId: null, lastLoginAt: null, isAuthenticated: false });
  },
}));
