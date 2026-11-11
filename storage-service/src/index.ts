import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config } from './config';
import { ensureRoot } from './services/storage';
import healthRouter from './routes/health';
import filesRouter from './routes/files';

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS origin not allowed'));
  },
  credentials: false,
}));
app.use(express.json({ limit: '1mb' }));

// Public read-only access to files: https://images.gokez.com/catalog/x.webp
app.use('/', express.static(config.storageRoot, {
  index: false,
  dotfiles: 'ignore',
  maxAge: '30d',
  immutable: true,
}));

app.use('/api/v1', healthRouter);
app.use('/api/v1/files', filesRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[storage] error:', err?.message || err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

async function start() {
  await ensureRoot();
  app.listen(config.port, () => {
    console.log(`Gokez storage service running on port ${config.port}`);
    console.log(`Storage root: ${config.storageRoot}`);
    console.log(`Public base: ${config.publicBaseUrl}`);
  });
}

start().catch(err => {
  console.error('Failed to start storage service:', err);
  process.exit(1);
});
