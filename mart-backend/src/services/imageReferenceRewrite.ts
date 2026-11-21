import type { HostingerFileRecord } from './hostingerStorage.service';

export interface FileTokens {
  exact: Set<string>;
  aliases: Set<string>;
}

export interface FileIndex {
  byId: Map<string, HostingerFileRecord>;
  exact: Map<string, Set<string>>;
  aliases: Map<string, Set<string>>;
}

export interface JsonRewrite {
  value: unknown;
  changed: boolean;
}

const VARIANT_URL_KEYS = [
  'url', 'imageUrl', 'image_url', 'photoUrl', 'photo_url',
  'smallUrl', 'small_url', 'thumbnailUrl', 'thumbnail_url',
  'largeUrl', 'large_url', 'mediumUrl', 'medium_url',
];

const tokenCache = new Map<string, { key: string; tokens: FileTokens }>();

function decodeSafely(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function normalizeImageValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let result = value.trim();
  if (!result) return null;
  result = result.split(/[?#]/)[0];
  if (/^https?:\/\//i.test(result)) {
    try { result = new URL(result).pathname; } catch {}
  }
  result = decodeSafely(result).replace(/\\/g, '/').replace(/^\/+/, '');
  result = result.replace(/^uploads\//i, '');
  result = result.replace(/^images\//i, '');
  result = result.replace(/^photos\//i, '');
  result = result.replace(/^files\//i, '');
  result = result.replace(/^media\//i, '');
  result = result.replace(/^img\//i, '');
  result = result.replace(/^object\/public\/[^/]+\//i, '');
  result = result.replace(/^storage\/v1\/object\/(?:public|private|sign)\/[^/]+\//i, '');
  result = result.replace(/^api\/v1\/files\//i, '');
  result = result.replace(/^\.\//, '');
  return result || null;
}

export function filenameAliases(filename: string): string[] {
  const aliases = new Set<string>([filename]);
  const withoutUuid = filename.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '');
  if (withoutUuid !== filename) {
    aliases.add(withoutUuid);
    aliases.add(withoutUuid.replace(/^(?:products|product|catalog)[-_]/i, ''));
  }
  return [...aliases];
}

function getFileTokens(file: HostingerFileRecord): FileTokens {
  const key = JSON.stringify([file.url, file.thumbnailUrl, file.filename, file.thumbnailFilename]);
  const cached = tokenCache.get(file.id);
  if (cached && cached.key === key) return cached.tokens;
  const exact = new Set<string>();
  const paths = [
    file.url,
    file.thumbnailUrl,
    file.filename ? `${file.folder}/${file.filename}` : null,
    file.thumbnailFilename ? `${file.folder}/${file.thumbnailFilename}` : null,
  ];
  for (const value of paths) {
    const normalized = normalizeImageValue(value);
    if (normalized) exact.add(normalized);
  }
  const aliases = new Set<string>();
  for (const name of [file.filename, file.thumbnailFilename]) {
    if (!name) continue;
    for (const alias of filenameAliases(name)) aliases.add(alias);
  }
  const tokens = { exact, aliases };
  tokenCache.set(file.id, { key, tokens });
  return tokens;
}

function addToken(map: Map<string, Set<string>>, token: string, id: string): void {
  const ids = map.get(token) || new Set<string>();
  ids.add(id);
  map.set(token, ids);
}

export function buildFileIndex(files: HostingerFileRecord[]): FileIndex {
  const index: FileIndex = {
    byId: new Map(),
    exact: new Map(),
    aliases: new Map(),
  };
  for (const file of files) {
    index.byId.set(file.id, file);
    const tokens = getFileTokens(file);
    for (const token of tokens.exact) addToken(index.exact, token, file.id);
    for (const token of tokens.aliases) addToken(index.aliases, token, file.id);
  }
  return index;
}

export function matchingFiles(value: unknown, index: FileIndex): HostingerFileRecord[] {
  const normalized = normalizeImageValue(value);
  if (!normalized) return [];
  const exactIds = index.exact.get(normalized);
  const ids = exactIds?.size ? exactIds : normalized.includes('/') ? null : index.aliases.get(normalized);
  if (!ids?.size) return [];
  return [...ids].map(id => index.byId.get(id)).filter((file): file is HostingerFileRecord => Boolean(file));
}

export function isFileValue(value: unknown, file: HostingerFileRecord): boolean {
  return matchingFiles(value, buildFileIndex([file])).length > 0;
}

export function walkJson(value: unknown, currentPath: string, visit: (path: string, leaf: string) => void): void {
  if (typeof value === 'string') {
    visit(currentPath, value);
    const trimmed = value.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try { walkJson(JSON.parse(trimmed), currentPath, visit); } catch {}
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJson(item, `${currentPath}[${index}]`, visit));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      walkJson(nested, currentPath ? `${currentPath}.${key}` : key, visit);
    }
  }
}

export function parseStorageIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(id => String(id)).filter(Boolean);
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(id => String(id)).filter(Boolean);
    } catch {}
  }
  return [trimmed];
}

export function isVariantObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && VARIANT_URL_KEYS.some(key => key in (value as Record<string, unknown>)));
}

export function variantMatches(value: Record<string, unknown>, index: FileIndex): boolean {
  return VARIANT_URL_KEYS.some(key => matchingFiles(value[key], index).length > 0);
}

export function rewriteJsonValue(value: unknown, index: FileIndex, dropVariantObjects = false): JsonRewrite {
  if (dropVariantObjects && isVariantObject(value) && variantMatches(value, index)) {
    return { value: null, changed: true };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const nested = rewriteJsonValue(JSON.parse(trimmed), index, dropVariantObjects);
        if (!nested.changed) return { value, changed: false };
        return { value: JSON.stringify(nested.value), changed: true };
      } catch {}
    }
    return matchingFiles(value, index).length > 0 ? { value: null, changed: true } : { value, changed: false };
  }
  if (Array.isArray(value)) {
    const next: unknown[] = [];
    let changed = false;
    for (const item of value) {
      const rewritten = rewriteJsonValue(item, index, dropVariantObjects);
      if (rewritten.changed) changed = true;
      if (rewritten.changed && rewritten.value === null) continue;
      next.push(rewritten.value);
    }
    return { value: next, changed };
  }
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    let changed = false;
    for (const [key, nested] of Object.entries(next)) {
      const rewritten = rewriteJsonValue(nested, index, dropVariantObjects);
      if (!rewritten.changed) continue;
      changed = true;
      next[key] = rewritten.value;
    }
    return { value: next, changed };
  }
  return { value, changed: false };
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function cartTotals(value: unknown): { itemCount: number; subtotal: number } {
  const items = Array.isArray(value) ? value : [];
  let itemCount = 0;
  let subtotal = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const quantity = Math.max(0, Math.min(99, Math.round(finiteNumber(row.quantity))));
    const price = Math.max(0, finiteNumber(row.price));
    itemCount += quantity;
    subtotal += price * quantity;
  }
  return { itemCount, subtotal: Number(subtotal.toFixed(2)) };
}
