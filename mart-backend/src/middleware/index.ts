import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../database/db';

export interface AdminRequest extends Request {
  admin?: { id: string; username: string; role: string; storeId: string | null };
}

export interface CustomerRequest extends Request {
  customer?: { id: string; phone: string };
}

// ── Token typing ──────────────────────────────────────────────────────────────
// Admin and customer tokens are signed with the same secret, so the signed `type`
// claim is the only thing keeping the two audiences apart. Do not infer a type
// from the presence of other claims: a token with no type is rejected, never
// promoted.
export const ADMIN_TOKEN_TYPE = 'admin';
export const CUSTOMER_TOKEN_TYPE = 'customer';

// Mirrors the mart_admins_role_check constraint applied in migration 056.
//
// This list is the single source of truth for "is this a role the system
// accepts". Every write path that accepts a role from a request body must go
// through isValidAdminRole rather than keeping its own copy: the previous
// arrangement had adminCreateUser validating against a list wider than the
// database constraint, so creating a store_manager passed validation and then
// died on a Postgres check violation surfaced to the user as a bare 500.
//
// The database constraint remains the backstop. This list exists so an invalid
// role is rejected with a 400 and a readable message instead of a 500.
export const ADMIN_ROLES = [
  'super_admin',
  'store_owner',
  'store_manager',
  'delivery_staff',
  'staff',
] as const;

export type AdminRole = typeof ADMIN_ROLES[number];

/** True when `value` is a role this system accepts. */
export const isValidAdminRole = (value: unknown): value is AdminRole =>
  typeof value === 'string' && (ADMIN_ROLES as readonly string[]).includes(value);

/** Human-readable list for error messages, so the API never lies about what is allowed. */
export const ADMIN_ROLE_LIST = ADMIN_ROLES.join(', ');

function bearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
}

export const authenticate = (req: AdminRequest, res: Response, next: NextFunction): void => {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ success: false, error: 'No token provided' });
    return;
  }
  let payload: any;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' });
    return;
  }
  // A customer token must never be usable as an admin token. Previously this
  // middleware defaulted a missing role to 'super_admin', which meant any
  // verified customer token satisfied requireSuperAdmin.
  if (payload.type !== ADMIN_TOKEN_TYPE) {
    res.status(401).json({ success: false, error: 'Admin token required' });
    return;
  }
  // Fail closed: an absent or unrecognised role is a rejection, never an elevation.
  if (!ADMIN_ROLES.includes(payload.role)) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return;
  }
  req.admin = {
    id: payload.id,
    username: payload.username,
    role: payload.role,
    storeId: payload.storeId || null,
  };
  next();
};

// Require super_admin role
export const requireSuperAdmin = (req: AdminRequest, res: Response, next: NextFunction): void => {
  if (req.admin?.role !== 'super_admin') {
    res.status(403).json({ success: false, error: 'Super admin access required' });
    return;
  }
  next();
};

// Require one of the specified roles
export const requireRole = (...roles: string[]) => (req: AdminRequest, res: Response, next: NextFunction): void => {
  if (!req.admin || !roles.includes(req.admin.role)) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return;
  }
  next();
};

// ── Store scoping ─────────────────────────────────────────────────────────────
// Routes that carry `:storeId` must never take the path parameter at face value:
// it is caller-controlled. Super admins may target any store. Every other role
// must either match the store embedded in their own token or hold an active row in
// mart_admin_store_assignments — which is what lets delivery staff work across
// several stores without that becoming a general-purpose bypass.
async function hasStoreAssignment(adminId: string, storeId: string): Promise<boolean> {
  const { rows } = await query(
    `SELECT 1 FROM mart_admin_store_assignments
     WHERE admin_id = $1 AND store_id = $2 AND is_active = true
     LIMIT 1`,
    [adminId, storeId]
  );
  return rows.length > 0;
}

export const requireStoreAccess = (req: AdminRequest, res: Response, next: NextFunction): void => {
  const admin = req.admin;
  if (!admin) {
    res.status(401).json({ success: false, error: 'No token provided' });
    return;
  }
  if (admin.role === 'super_admin') { next(); return; }
  const requestedStoreId = req.params.storeId;
  if (!requestedStoreId) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return;
  }
  if (admin.storeId && admin.storeId === requestedStoreId) { next(); return; }
  hasStoreAssignment(admin.id, requestedStoreId)
    .then(allowed => {
      if (allowed) return next();
      res.status(403).json({ success: false, error: 'Access denied' });
    })
    .catch(() => res.status(500).json({ success: false, error: 'Something went wrong' }));
};

export const authenticateCustomer = async (req: CustomerRequest, res: Response, next: NextFunction): Promise<void> => {
  const token = bearerToken(req);
  if (!token) { res.status(401).json({ success: false, error: 'No token provided' }); return; }
  try {
    const payload = jwt.verify(token, config.jwt.secret) as any;
    if (payload.type !== CUSTOMER_TOKEN_TYPE) throw new Error('Not a customer token');
    // Check token blacklist (logout)
    if (payload.jti) {
      const blacklisted = await query(
        `SELECT 1 FROM mart_token_blacklist WHERE jti = $1 AND expires_at > NOW()`,
        [payload.jti]
      );
      if (blacklisted.rows.length) { res.status(401).json({ success: false, error: 'Token revoked' }); return; }
    }
    req.customer = { id: payload.id, phone: payload.phone };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

// Guest checkout remains available, but financial benefits require a verified
// customer identity. Invalid supplied tokens are rejected rather than ignored.
export const authenticateCustomerIfPresent = async (req: CustomerRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.headers.authorization) { next(); return; }
  await authenticateCustomer(req, res, next);
};

export const asyncHandler = (fn: (req: any, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction): void => {
  console.error('[MartAPI Error]', err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    error: status < 500 ? err.message : 'Something went wrong',
  });
};

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ success: false, error: 'Route not found' });
};
