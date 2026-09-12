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

export const authenticate = (req: AdminRequest, res: Response, next: NextFunction): void => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'No token provided' });
    return;
  }
  try {
    const payload = jwt.verify(auth.slice(7), config.jwt.secret) as any;
    req.admin = {
      id: payload.id,
      username: payload.username,
      role: payload.role || 'super_admin',
      storeId: payload.storeId || null,
    };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
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

export const authenticateCustomer = async (req: CustomerRequest, res: Response, next: NextFunction): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'No token provided' }); return; }
  try {
    const payload = jwt.verify(auth.slice(7), config.jwt.secret) as any;
    if (payload.type !== 'customer') throw new Error('Not a customer token');
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
