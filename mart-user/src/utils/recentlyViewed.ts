const STORAGE_KEY = 'mart_recently_viewed';
const MAX_ITEMS = 12;

export function loadRecentlyViewedIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

export function recordRecentlyViewed(productId: string): void {
  if (!productId) return;
  try {
    const current = loadRecentlyViewedIds().filter(id => id !== productId);
    const next = [productId, ...current].slice(0, MAX_ITEMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('mart:recently-viewed'));
  } catch {
    // noop
  }
}
