import dotenv from 'dotenv';
import path from 'path';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
}

const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.MART_JWT_SECRET;
const configuredOrigins = (process.env.MART_CORS_ORIGIN || (isProduction ? '' : 'http://localhost:5177,http://localhost:5178'))
  .split(',').map(origin => origin.trim()).filter(Boolean);

if (isProduction) {
  if (!jwtSecret || jwtSecret === 'mart-dev-secret-change-in-production' || jwtSecret === 'change_this_in_production' || jwtSecret.length < 32) {
    throw new Error('MART_JWT_SECRET must be a unique secret of at least 32 characters in production');
  }
  if (configuredOrigins.length === 0 || configuredOrigins.some(origin => !/^https:\/\//.test(origin))) {
    throw new Error('MART_CORS_ORIGIN must contain one or more HTTPS origins in production');
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3004', 10),
  env: process.env.NODE_ENV || 'development',
  jwt: {
    secret: (() => {
      if (!jwtSecret) {
        if (isProduction) throw new Error('MART_JWT_SECRET env var is required in production');
        return 'mart-dev-secret-change-in-prod';
      }
      return jwtSecret;
    })(),
    expiresIn: process.env.MART_JWT_EXPIRES_IN || '90d',
  },
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    bucket: process.env.SUPABASE_BUCKET || 'mart-products',
  },
  cors: {
    origins: configuredOrigins,
  },
  vapid: {
    publicKey:  process.env.VAPID_PUBLIC_KEY  || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject:    process.env.VAPID_SUBJECT     || 'mailto:support@gokez.com',
  },
  sentry: {
    dsn: process.env.SENTRY_DSN || '',
  },
  geocoding: {
    baseUrl: process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org',
    userAgent: process.env.NOMINATIM_USER_AGENT || 'GokezMart/1.0 (support@gokez.com)',
  },
};
