import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config, ALLOWED_FOLDERS, isAllowedFolder } from '../config';
import { FileRecord, UploadResult } from '../types';
import { processImage, makeThumbnail } from './image';
import { safeResolve } from '../utils/path';

const INDEX_FILE = path.join(config.storageRoot, '.index.json');

let lock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn, fn);
  lock = next.then(() => undefined, () => undefined);
  return next;
}

async function readIndex(): Promise<FileRecord[]> {
  try {
    const raw = await fs.readFile(INDEX_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(records: FileRecord[]): Promise<void> {
  const tmp = INDEX_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(records, null, 2), 'utf8');
  await fs.rename(tmp, INDEX_FILE);
}

export async function ensureRoot(): Promise<void> {
  await fs.mkdir(config.storageRoot, { recursive: true });
  for (const folder of ALLOWED_FOLDERS) {
    await fs.mkdir(path.join(config.storageRoot, folder), { recursive: true });
  }
}

export async function uploadFile(params: {
  folder: string;
  originalName: string;
  buffer: Buffer;
  projectId: string;
}): Promise<UploadResult> {
  const { folder, originalName, buffer, projectId } = params;
  if (!isAllowedFolder(folder)) throw new Error('Invalid folder');
  if (buffer.length > config.maxUploadBytes) throw new Error(`File too large. Max ${config.maxUploadBytes} bytes.`);
  if (buffer.length === 0) throw new Error('Empty file');

  const processed = await processImage(buffer);
  const id = uuidv4();
  const base = (originalName.replace(/\.[^.]+$/, '') || 'image').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'image';
  const filename = `${id}-${base}.webp`;
  const thumbnailFilename = `${id}-${base}-thumb.webp`;

  const filePath = safeResolve(folder, filename);
  const thumbPath = safeResolve(folder, thumbnailFilename);

  await fs.writeFile(filePath, processed.buffer);
  const thumbBuffer = await makeThumbnail(buffer, config.thumbnailWidth);
  await fs.writeFile(thumbPath, thumbBuffer);

  const record: FileRecord = {
    id,
    projectId,
    folder,
    filename,
    originalName,
    mimeType: processed.mimeType,
    size: processed.buffer.length,
    width: processed.width,
    height: processed.height,
    thumbnailFilename,
    url: `${config.publicBaseUrl}/${folder}/${filename}`,
    thumbnailUrl: `${config.publicBaseUrl}/${folder}/${thumbnailFilename}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await withLock(async () => {
    const records = await readIndex();
    records.push(record);
    await writeIndex(records);
  });

  return {
    id: record.id,
    folder: record.folder,
    filename: record.filename,
    url: record.url,
    thumbnailUrl: record.thumbnailUrl,
    mimeType: record.mimeType,
    size: record.size,
    width: record.width,
    height: record.height,
  };
}

export async function listFiles(params: { folder?: string; search?: string; limit?: number; offset?: number }): Promise<{ items: FileRecord[]; total: number }> {
  const { folder, search, limit = 50, offset = 0 } = params;
  return withLock(async () => {
    let records = await readIndex();
    if (folder) records = records.filter(r => r.folder === folder);
    if (search) {
      const q = search.toLowerCase();
      records = records.filter(r => r.originalName.toLowerCase().includes(q) || r.filename.toLowerCase().includes(q));
    }
    const total = records.length;
    const items = records.slice(offset, offset + limit);
    return { items, total };
  });
}

export async function getFile(id: string): Promise<FileRecord | null> {
  return withLock(async () => {
    const records = await readIndex();
    return records.find(r => r.id === id) || null;
  });
}

export async function replaceFile(id: string, buffer: Buffer, originalName: string): Promise<FileRecord> {
  return withLock(async () => {
    const records = await readIndex();
    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) throw new Error('File not found');
    const rec = records[idx];

    if (buffer.length > config.maxUploadBytes) throw new Error(`File too large. Max ${config.maxUploadBytes} bytes.`);
    if (buffer.length === 0) throw new Error('Empty file');

    const processed = await processImage(buffer);
    const filePath = safeResolve(rec.folder, rec.filename);
    const thumbPath = rec.thumbnailFilename ? safeResolve(rec.folder, rec.thumbnailFilename) : null;

    await fs.writeFile(filePath, processed.buffer);
    if (thumbPath) {
      const thumbBuffer = await makeThumbnail(buffer, config.thumbnailWidth);
      await fs.writeFile(thumbPath, thumbBuffer);
    }

    rec.originalName = originalName;
    rec.mimeType = processed.mimeType;
    rec.size = processed.buffer.length;
    rec.width = processed.width;
    rec.height = processed.height;
    rec.updatedAt = new Date().toISOString();
    records[idx] = rec;
    await writeIndex(records);
    return rec;
  });
}

export async function deleteFile(id: string): Promise<void> {
  await withLock(async () => {
    const records = await readIndex();
    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) throw new Error('File not found');
    const rec = records[idx];
    const filePath = safeResolve(rec.folder, rec.filename);
    try { await fs.unlink(filePath); } catch { /* ignore */ }
    if (rec.thumbnailFilename) {
      const thumbPath = safeResolve(rec.folder, rec.thumbnailFilename);
      try { await fs.unlink(thumbPath); } catch { /* ignore */ }
    }
    records.splice(idx, 1);
    await writeIndex(records);
  });
}
