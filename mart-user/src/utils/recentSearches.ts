const STORAGE_KEY = 'mart_recent_searches';
const MAX_ITEMS = 8;

export function loadRecentSearches(): string[] {
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

export function recordRecentSearch(term: string): string[] {
  const trimmed = term.trim();
  if (!trimmed) return loadRecentSearches();
  try {
    const current = loadRecentSearches().filter(item => item.toLowerCase() !== trimmed.toLowerCase());
    const next = [trimmed, ...current].slice(0, MAX_ITEMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('mart:recent-searches'));
    return next;
  } catch {
    return loadRecentSearches();
  }
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('mart:recent-searches'));
  } catch {
    // noop
  }
}
