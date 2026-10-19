/**
 * In-memory stale-while-revalidate cache + in-flight de-duplication for GETs.
 *
 * Every component used to re-fetch its data from the server on mount, so
 * switching tabs flashed a skeleton and hit the backend again on every visit.
 * This cache sits under the axios instance: a GET answered recently resolves
 * instantly from memory (the page paints immediately), and a GET whose entry is
 * past the fresh window still resolves instantly but also kicks off a
 * background re-fetch so the next reader gets current data.
 *
 * Concurrent identical GETs share one network request — the checkout overlay
 * mounts twice (mobile sheet + desktop drawer, split by CSS), which used to
 * double every request it made.
 *
 * Any successful mutation (POST/PUT/PATCH/DELETE) clears the whole cache, so a
 * create/update/delete is always followed by real refetches.
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

export interface InflightRecord {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const inflight = new Map<string, InflightRecord>();

// Bumped every time the cache is cleared by a mutation. A GET records the
// generation it started in, and a response is only written back if the
// generation is unchanged — so a read that began before a mutation cannot
// complete afterwards and re-seed the cache with pre-mutation data.
let generation = 0;

/** The current cache generation; see `clearHttpCache`. */
export function getCacheGeneration(): number {
  return generation;
}

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

export function getInflight(key: string): InflightRecord | undefined {
  return inflight.get(key);
}

/** Registers an in-flight record for `key`, cleared when the promise settles. */
export function startInflight(key: string): InflightRecord {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  const record: InflightRecord = { promise, resolve, reject };
  inflight.set(key, record);
  const clear = () => { if (inflight.get(key) === record) inflight.delete(key); };
  promise.then(clear, clear);
  return record;
}

export function clearHttpCache(): void {
  generation++;
  entries.clear();
  // In-flight records are settled, not merely forgotten. Their promise is handed
  // to every joiner that de-duplicated onto them, and the api layer can only
  // settle it via getInflight(): if we dropped the map while a request was in
  // flight, a joiner's promise would never resolve and that caller would hang
  // forever. Rejecting lets each joiner fail fast and retry against the (now
  // empty) cache. Owners still complete normally and repopulate their entry.
  for (const record of inflight.values()) {
    record.reject(new Error('mart http cache cleared'));
  }
  inflight.clear();
}
