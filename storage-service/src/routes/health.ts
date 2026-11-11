import { Router, Request, Response } from 'express';
import { config } from '../config';
import { ensureRoot } from '../services/storage';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  try {
    await ensureRoot();
    res.json({ success: true, status: 'ok', storageRoot: config.storageRoot, env: config.env });
  } catch (err) {
    res.status(500).json({ success: false, status: 'error', error: (err as Error).message });
  }
});

export default router;
