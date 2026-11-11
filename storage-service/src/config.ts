import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

export const ALLOWED_FOLDERS = ['category', 'catalog', 'profile', 'banner', 'other'] as const;
export type Folder = (typeof ALLOWED_FOLDERS)[number];

export function isAllowedFolder(folder: string): boolean {
  return (ALLOWED_FOLDERS as readonly string[]).includes(folder);
}

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  env: process.env.NODE_ENV || 'development',
  storageRoot: process.env.STORAGE_ROOT || '/opt/gokez-mart',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'https://images.gokez.com').replace(/\/$/, ''),
  projectId: process.env.STORAGE_PROJECT_ID || 'gokez-mart',
  apiKey: process.env.STORAGE_API_KEY || '',
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES || String(5 * 1024 * 1024), 10),
  corsOrigins: (process.env.CORS_ORIGINS || 'https://mart.gokez.com,https://hub.gokez.com,https://admin.mart.gokez.com')
    .split(',').map(s => s.trim()).filter(Boolean),
  thumbnailWidth: parseInt(process.env.THUMBNAIL_WIDTH || '240', 10),
  webpQuality: parseInt(process.env.WEBP_QUALITY || '82', 10),
  isProd,
};

if (isProd) {
  if (!config.apiKey) throw new Error('STORAGE_API_KEY is required in production');
  if (!config.corsOrigins.length) throw new Error('CORS_ORIGINS is required in production');
}
