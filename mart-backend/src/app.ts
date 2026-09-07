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
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// General API — 200 req / 15 min
app.use('/api/v1', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.env === 'production' ? 200 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
  skip: (req) => req.path === '/health',
}));

// Auth endpoints — 10 req / 15 min
app.use('/api/v1/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.env === 'production' ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many authentication attempts, please try again later' },
  keyGenerator: (req) => req.body?.phone || req.ip || 'unknown',
}));

// Admin login — 5 req / 15 min
app.use('/api/v1/admin/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.env === 'production' ? 5 : 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts, please try again later' },
}));

// ── Body parsing (strict size limits) ────────────────────────────────────────
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// ── Input sanitization ────────────────────────────────────────────────────────
app.use(mongoSanitize());  // prevent NoSQL injection via $ operators
app.use(hpp());            // prevent HTTP parameter pollution

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
