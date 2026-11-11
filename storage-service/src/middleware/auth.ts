import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function requireProjectAccess(req: Request, res: Response, next: NextFunction): void {
  const project = req.headers['x-project-id'];
  if (typeof project !== 'string' || project !== config.projectId) {
    res.status(403).json({ success: false, error: 'Project access denied' });
    return;
  }
  next();
}

export function requireWriteAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing bearer token' });
    return;
  }
  const token = auth.slice(7);
  if (!config.apiKey || token !== config.apiKey) {
    res.status(401).json({ success: false, error: 'Invalid storage API key' });
    return;
  }
  next();
}
