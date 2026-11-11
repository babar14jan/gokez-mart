import sharp from 'sharp';
import { config } from '../config';

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: 'image/webp';
  extension: 'webp';
}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const image = sharp(input, { failOn: 'error' }).rotate();
  const metadata = await image.metadata();
  if (!['jpeg', 'png', 'webp', 'gif'].includes(metadata.format || '')) {
    throw new Error('Unsupported image format. Allowed: JPEG, PNG, WebP, GIF.');
  }
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  // sharp re-encodes, which strips EXIF metadata.
  const buffer = await image.webp({ quality: config.webpQuality, effort: 4 }).toBuffer();
  const out = await sharp(buffer).metadata();
  return { buffer, width: out.width || width, height: out.height || height, mimeType: 'image/webp', extension: 'webp' };
}

export async function makeThumbnail(input: Buffer, width: number): Promise<Buffer> {
  return sharp(input, { failOn: 'error' })
    .rotate()
    .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 76, effort: 4 })
    .toBuffer();
}
