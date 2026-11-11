import { Router, Request, Response } from 'express';
import multer from 'multer';
import { config, isAllowedFolder } from '../config';
import { requireProjectAccess, requireWriteAuth } from '../middleware/auth';
import { uploadLimiter, readLimiter } from '../middleware/rateLimit';
import * as storage from '../services/storage';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

const router = Router();

router.use(requireProjectAccess);

// List
router.get('/', readLimiter, async (req: Request, res: Response) => {
  try {
    const folder = typeof req.query.folder === 'string' ? req.query.folder : undefined;
    if (folder && !isAllowedFolder(folder)) {
      res.status(400).json({ success: false, error: 'Invalid folder' });
      return;
    }
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);
    const result = await storage.listFiles({ folder, search, limit, offset });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Get one
router.get('/:id', readLimiter, async (req: Request, res: Response) => {
  try {
    const rec = await storage.getFile(req.params.id);
    if (!rec) { res.status(404).json({ success: false, error: 'Not found' }); return; }
    res.json({ success: true, data: rec });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Upload
router.post('/upload', uploadLimiter, requireWriteAuth, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const folder = String(req.body?.folder || '').trim();
    if (!isAllowedFolder(folder)) {
      res.status(400).json({ success: false, error: 'Invalid or missing folder' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file uploaded' });
      return;
    }
    const result = await storage.uploadFile({
      folder,
      originalName: req.file.originalname,
      buffer: req.file.buffer,
      projectId: config.projectId,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    const msg = (err as Error).message;
    const status = /too large|Unsupported|Empty|Invalid/i.test(msg) ? 400 : 500;
    res.status(status).json({ success: false, error: msg });
  }
});

// Replace
router.put('/:id', uploadLimiter, requireWriteAuth, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file uploaded' });
      return;
    }
    const rec = await storage.replaceFile(req.params.id, req.file.buffer, req.file.originalname);
    res.json({ success: true, data: rec });
  } catch (err) {
    const msg = (err as Error).message;
    const status = /not found/i.test(msg) ? 404 : /too large|Unsupported|Empty/i.test(msg) ? 400 : 500;
    res.status(status).json({ success: false, error: msg });
  }
});

// Delete
router.delete('/:id', uploadLimiter, requireWriteAuth, async (req: Request, res: Response) => {
  try {
    await storage.deleteFile(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    const msg = (err as Error).message;
    const status = /not found/i.test(msg) ? 404 : 500;
    res.status(status).json({ success: false, error: msg });
  }
});

export default router;
