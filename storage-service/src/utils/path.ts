import path from 'path';
import { config } from '../config';

export function safeResolve(folder: string, filename: string): string {
  const root = path.resolve(config.storageRoot);
  const target = path.resolve(root, folder, filename);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path traversal detected');
  }
  // ensure folder segment is exactly one of allowed top-level folders
  const top = relative.split(path.sep)[0];
  if (!config_allowed(top)) throw new Error('Invalid folder');
  return target;
}

function config_allowed(folder: string): boolean {
  return (['category', 'catalog', 'profile', 'banner', 'other'] as string[]).includes(folder);
}

export function isAllowedFolder(folder: string): boolean {
  return (['category', 'catalog', 'profile', 'banner', 'other'] as string[]).includes(folder);
}
