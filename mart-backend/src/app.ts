import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import mongoSanitize from 'express-mongo-sanitize';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import * as Sentry from '@sentry/node';
import { config } from './config';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware';

const app = express();

// ── Sentry (must be first) ────────────────────────────────────────────────────
if (config.env === 'production' && process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: config.env,
    tracesSampleRate: 0.1,
  });
}

app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      config.cors.origins.includes(origin) ||
      /\.gokez\.com$/i.test(origin) ||
      /\.onrender\.com$/i.test(origin) ||
      (config.env === 'development' && /localhost/.test(origin))
    ) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control'],
}));

// ── Body parsing BEFORE rate limiters so req.body is available ────────────────
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// ── Input sanitization ────────────────────────────────────────────────────────
app.use(mongoSanitize());
app.use(hpp());

// ── Rate limiting ─────────────────────────────────────────────────────────────
const isProd = config.env === 'production';

// 1. General API — 300 req / 15 min per IP
app.use('/api/v1', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 300 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
  skip: (req) => req.path === '/health',
}));

// 2. OTP send — 3 req / 15 min per phone number (falls back to IP)
app.use('/api/v1/auth/send-otp', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 3 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many OTP requests. Please wait 15 minutes before trying again.' },
  keyGenerator: (req) => {
    const phone = req.body?.phone?.replace(/\D/g, '');
    return phone && phone.length === 10 ? `otp_send_${phone}` : req.ip || 'unknown';
  },
}));

// 3. OTP verify — 5 req / 15 min per phone (DB also enforces 5 attempts)
app.use('/api/v1/auth/verify-otp', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 5 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many verification attempts. Please request a new OTP.' },
  keyGenerator: (req) => {
    const phone = req.body?.phone?.replace(/\D/g, '');
    return phone && phone.length === 10 ? `otp_verify_${phone}` : req.ip || 'unknown';
  },
}));

// 4. Admin login — 5 req / 15 min per IP + username combo
app.use('/api/v1/admin/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 5 : 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Please try again in 15 minutes.' },
  keyGenerator: (req) => {
    const username = req.body?.username?.toLowerCase().trim();
    return username ? `admin_login_${username}_${req.ip}` : req.ip || 'unknown';
  },
}));

// 5. Order placement — 10 orders / 5 min per IP (prevent order spam)
app.use('/api/v1/orders', rateLimit({
  windowMs: 5 * 60 * 1000,
  max: isProd ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many orders placed. Please wait a few minutes.' },
  skip: (req) => req.method !== 'POST',
}));

// ── Compression & logging ─────────────────────────────────────────────────────
app.use(compression());
if (config.env !== 'test') {
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({ name: 'Gokez Mart API', status: 'running', health: '/api/v1/health' }));
app.use('/api/v1', routes);

// ── Error handlers ────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
