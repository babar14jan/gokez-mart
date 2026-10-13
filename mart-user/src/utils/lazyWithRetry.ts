import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Recovers silently from "the page needs a refresh" after a deploy.
 *
 * A page is loaded with `lazy(() => import(...))`, so its code lives in a
 * hashed chunk (e.g. OrderHistoryPage-a1b2c3.js). When we deploy, that file is
 * replaced by a new hash. A customer who still has the previous build open and
 * opens one of these pages asks the server for a chunk that no longer exists,
 * and the import rejects with "Failed to fetch dynamically imported module".
 * That is not a bug and needs no announcement: the fix is simply to load the
 * current build. We do that silently instead of showing the "something went
 * wrong" screen.
 *
 * Two things keep it safe:
 *  - `recoverFromChunkError` reloads at most once per LOOP_WINDOW_MS, so a chunk
 *    that is genuinely missing cannot put the app in a reload loop.
 *  - The flag is cleared as soon as any chunk loads, so a later deploy in the
 *    same session can still recover silently.
 */

const RELOAD_FLAG = 'gokez:chunk-reload-at';
const LOOP_WINDOW_MS = 10_000;

// Messages the major browsers/Vite produce when a hashed chunk is gone. Kept
// narrow so a real render bug is never mistaken for a stale-chunk reload.
const CHUNK_ERROR_PATTERNS: RegExp[] = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading chunk \d+ failed/i,
  /Loading CSS chunk \d+ failed/i,
];

export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    /* sessionStorage can be unavailable in private mode; nothing to clear */
  }
}

/** Silent, de-duplicated reload for a stale-chunk error. Returns true if the reload was started. */
export function recoverFromChunkError(): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
  } catch {
    return false;
  }
  if (Date.now() - last < LOOP_WINDOW_MS) return false;
  try {
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    factory()
      .then((module) => {
        clearChunkReloadFlag();
        return module;
      })
      .catch((error) => {
        if (isChunkLoadError(error) && recoverFromChunkError()) {
          // Reloading; never resolve so Suspense stays pending and the error
          // boundary does not flash its fallback first.
          return new Promise<{ default: T }>(() => {});
        }
        throw error;
      }),
  );
}
