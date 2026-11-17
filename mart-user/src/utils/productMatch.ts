import type { Product } from '../services/api';

/**
 * Relevance score for a product against an already-lowercased query.
 * 0 is an exact name match, 7 means "no match". Shared by the catalog search
 * sheet and the Categories/Fresh suggestion rows so every search surface
 * ranks results the same way.
 */
export function matchScore(product: Product, query: string): number {
  const name = product.name.trim().toLowerCase();
  const local = (product.localName ?? '').trim().toLowerCase();
  const aliases = (product.searchAliases ?? []).map(alias => alias.toLowerCase());
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (local.startsWith(query)) return 2;
  if (aliases.some(alias => alias.startsWith(query))) return 3;
  if (name.includes(query)) return 4;
  if (local.includes(query)) return 5;
  if (aliases.some(alias => alias.includes(query))) return 6;
  return 7;
}
