/**
 * In-memory stale-while-revalidate cache for API GETs.
 *
 * Every hub page used to re-fetch all of its data from the server on mount, so
 * switching pages flashed a skeleton and hit the database again on every single
 * navigation. This cache sits under the axios instance: a GET that was fetched
 * recently resolves instantly from memory (the page paints immediately), and a
 * GET whose entry is past the fresh window still resolves instantly but also
 * kicks off a background re-fetch so the *next* reader gets current data.
 *
 * Any successful mutation (POST/PUT/PATCH/DELETE) clears the whole cache, so a
 * create/update/delete is always followed by real refetches — nothing can show
 * data that predates the change.
 */

interface CachedResponse {
  data: unknown;
  status: number;
  statusText: string;
  headers: Record<string, unknown>;
}

export interface HttpCacheEntry {
  response: CachedResponse;
  cachedAt: number;
  revalidating: boolean;
}

/** Entries younger than this are served without any network traffic. */
export const CACHE_FRESH_MS = 20_000;

/** Entries older than this are discarded instead of being served stale. */
export const CACHE_MAX_AGE_MS = 5 * 60_000;

const entries = new Map<string, HttpCacheEntry>();

/** Order-insensitive, undefined-dropping stringify so param object shape never splits the key. */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function buildCacheKey(config: { url?: string; method?: string; params?: unknown }): string {
  const method = (config.method || 'get').toLowerCase();
  const params = config.params !== undefined ? stableStringify(config.params) : '';
  return `${method} ${config.url || ''} ${params}`;
}

export function getEntry(key: string): HttpCacheEntry | undefined {
  return entries.get(key);
}

export function setEntry(key: string, response: CachedResponse): void {
  entries.set(key, { response, cachedAt: Date.now(), revalidating: false });
}

export function clearHttpCache(): void {
  entries.clear();
}
