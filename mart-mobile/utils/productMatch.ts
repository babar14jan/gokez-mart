import type { Product } from '@/services/api';

export function matchScore(product: Product, query: string): number {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return 7;
  const name = String(product.name ?? '').trim().toLowerCase();
  const local = String(product.localName ?? '').trim().toLowerCase();
  const aliases = (product.searchAliases ?? []).map(alias => String(alias).trim().toLowerCase());
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (local.startsWith(q)) return 2;
  if (aliases.some(alias => alias.startsWith(q))) return 3;
  if (name.includes(q)) return 4;
  if (local.includes(q)) return 5;
  if (aliases.some(alias => alias.includes(q))) return 6;
  return 7;
}

export function matchesProduct(product: Product, query: string): boolean {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  if (matchScore(product, q) < 7) return true;
  return String(product.categoryName ?? '').trim().toLowerCase().includes(q);
}

export function sortProductsForCustomer(products: Product[]): Product[] {
  return [...products].sort((a, b) => {
    const aOutOfStock = a.availabilityStatus === 'out_of_stock' || !a.isAvailable ? 1 : 0;
    const bOutOfStock = b.availabilityStatus === 'out_of_stock' || !b.isAvailable ? 1 : 0;
    if (aOutOfStock !== bOutOfStock) return aOutOfStock - bOutOfStock;
    const aSortOrder = Number.isFinite(a.sortOrder) ? a.sortOrder as number : 0;
    const bSortOrder = Number.isFinite(b.sortOrder) ? b.sortOrder as number : 0;
    return aSortOrder - bSortOrder || a.name.localeCompare(b.name);
  });
}

export function searchProducts(products: Product[], query: string): Product[] {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return sortProductsForCustomer(products);
  return sortProductsForCustomer(products.filter(product => matchesProduct(product, q)))
    .sort((a, b) => matchScore(a, q) - matchScore(b, q));
}
