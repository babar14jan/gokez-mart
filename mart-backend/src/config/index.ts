import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3004', 10),
  env: process.env.NODE_ENV || 'development',
  jwt: {
    secret: (() => {
      if (!process.env.MART_JWT_SECRET) {
        if (process.env.NODE_ENV === 'production') throw new Error('MART_JWT_SECRET env var is required in production');
        return 'mart-dev-secret-change-in-prod';
      }
      return process.env.MART_JWT_SECRET;
    })(),
    expiresIn: process.env.MART_JWT_EXPIRES_IN || '30d',
  },
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    bucket: process.env.SUPABASE_BUCKET || 'mart-products',
  },
  cors: {
    origins: (process.env.MART_CORS_ORIGIN || 'http://localhost:5177,http://localhost:5178')
      .split(',').map(o => o.trim()),
  },
  vapid: {
    publicKey:  process.env.VAPID_PUBLIC_KEY  || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject:    process.env.VAPID_SUBJECT     || 'mailto:support@gokez.com',
  },
  sentry: {
    dsn: process.env.SENTRY_DSN || '',
  },
};
