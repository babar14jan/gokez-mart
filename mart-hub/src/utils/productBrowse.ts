export interface BrowseProduct {
  id: string;
  name: string;
  productCode?: string;
  localName?: string | null;
  searchAliases?: string[] | null;
  categoryId?: string | null;
  price: number;
  unit?: string;
  discountPercent?: number;
  weightOptions?: Array<{ label: string; price: number; discountPercent?: number | null }> | null;
  availabilityStatus?: string;
  isAvailable?: boolean;
  stockQuantity?: number | null;
  lowStockThreshold?: number | null;
  sortOrder?: number;
  createdAt?: string | null;
}

export type ProductStatusFilter = 'available' | 'hidden' | 'out_of_stock';
export type ProductPreset = 'all' | 'top10' | 'top10_discounted' | 'below30' | 'low_stock' | 'hidden' | 'out_of_stock';
export type ProductBrowseSort = 'manual' | 'discount' | 'price_asc' | 'price_desc' | 'newest' | 'stock' | 'az';

export const PRODUCT_PRESETS: Array<{ id: ProductPreset; label: string; defaultSort: ProductBrowseSort }> = [
  { id: 'all', label: 'All', defaultSort: 'manual' },
  { id: 'top10', label: 'Top 10', defaultSort: 'manual' },
  { id: 'top10_discounted', label: 'Top 10 discounted', defaultSort: 'discount' },
  { id: 'below30', label: 'Below ₹30', defaultSort: 'price_asc' },
  { id: 'low_stock', label: 'Low stock', defaultSort: 'stock' },
  { id: 'hidden', label: 'Hidden', defaultSort: 'manual' },
  { id: 'out_of_stock', label: 'Out of stock', defaultSort: 'manual' },
];

export type CustomerOrderMode = Extract<ProductPreset, 'all' | 'top10' | 'top10_discounted' | 'below30'>;

export const CUSTOMER_ORDER_MODES: Array<{ id: CustomerOrderMode; label: string; sort: ProductBrowseSort; limit?: number }> = [
  { id: 'all', label: 'Manual', sort: 'manual' },
  { id: 'top10', label: 'Top 10', sort: 'manual', limit: 10 },
  { id: 'top10_discounted', label: 'Top 10 discounted', sort: 'discount', limit: 10 },
  { id: 'below30', label: 'Below ₹30', sort: 'price_asc' },
];

export const PRODUCT_SORT_LABELS: Record<ProductBrowseSort, string> = {
  manual: 'Manual order',
  discount: 'Biggest discount',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  newest: 'Newest first',
  stock: 'Low stock first',
  az: 'Name: A → Z',
};

export function getDiscountedPrice(product: BrowseProduct): number {
  const options = product.weightOptions?.length ? product.weightOptions : null;
  const primaryOption = options?.find(option => option.label === product.unit) || null;
  const firstOption = primaryOption || options?.[0] || null;
  const price = Number(firstOption ? firstOption.price : product.price);
  const discount = Number(firstOption
    ? (firstOption === primaryOption ? (firstOption.discountPercent ?? product.discountPercent ?? 0) : (firstOption.discountPercent ?? 0))
    : (product.discountPercent || 0));
  if (!Number.isFinite(price)) return 0;
  if (!Number.isFinite(discount) || discount <= 0) return price;
  return Math.round(price * (1 - discount / 100));
}

export function getProductStatus(product: BrowseProduct): ProductStatusFilter {
  if (product.availabilityStatus === 'hidden') return 'hidden';
  if (product.availabilityStatus === 'out_of_stock' || product.isAvailable === false) return 'out_of_stock';
  return 'available';
}

export function getStockState(product: BrowseProduct): 'untracked' | 'out' | 'low' | 'ok' {
  if (product.stockQuantity == null) return 'untracked';
  if (product.stockQuantity <= 0) return 'out';
  if (product.lowStockThreshold != null && product.stockQuantity <= product.lowStockThreshold) return 'low';
  return 'ok';
}

export interface BrowseOptions {
  query?: string;
  categoryId?: string;
  statuses?: ProductStatusFilter[];
  preset?: ProductPreset;
  sort?: ProductBrowseSort;
  excludedIds?: string[];
  minDiscount?: number;
  maxDiscountedPrice?: number;
  limit?: number;
}

export function browseProducts<T extends BrowseProduct>(products: T[], options: BrowseOptions = {}): T[] {
  const query = (options.query || '').trim().toLowerCase();
  const statuses = options.statuses?.length ? options.statuses : (['available'] as ProductStatusFilter[]);
  const statusSet = new Set<ProductStatusFilter>(statuses);
  const excluded = new Set(options.excludedIds || []);
  const preset = options.preset || 'all';
  const sort = options.sort || PRODUCT_PRESETS.find(item => item.id === preset)?.defaultSort || 'manual';

  let list = products.filter(product => {
    if (excluded.has(product.id)) return false;
    if (options.categoryId && options.categoryId !== 'all') {
      if (options.categoryId === '__uncat__') {
        if (product.categoryId) return false;
      } else if (product.categoryId !== options.categoryId) return false;
    }
    if (query) {
      const matches = product.name.toLowerCase().includes(query)
        || (product.productCode || '').toLowerCase().includes(query)
        || (product.localName || '').toLowerCase().includes(query)
        || (product.searchAliases || []).some(alias => alias.toLowerCase().includes(query));
      if (!matches) return false;
    }
    if (preset === 'hidden' || preset === 'out_of_stock') {
      if (getProductStatus(product) !== preset) return false;
    } else if (!statusSet.has(getProductStatus(product))) return false;
    if (preset === 'top10_discounted' && (product.discountPercent || 0) <= 0) return false;
    if (preset === 'below30' && getDiscountedPrice(product) >= 30) return false;
    if (preset === 'low_stock' && getStockState(product) !== 'low') return false;
    if (typeof options.minDiscount === 'number' && (product.discountPercent || 0) < options.minDiscount) return false;
    if (typeof options.maxDiscountedPrice === 'number' && getDiscountedPrice(product) >= options.maxDiscountedPrice) return false;
    return true;
  });

  const byPrice = (a: T, b: T) => getDiscountedPrice(a) - getDiscountedPrice(b);
  if (sort === 'discount') list = list.sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));
  else if (sort === 'price_asc') list = list.sort(byPrice);
  else if (sort === 'price_desc') list = list.sort((a, b) => byPrice(b, a));
  else if (sort === 'newest') list = list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  else if (sort === 'stock') {
    const order = { out: 0, low: 1, ok: 2, untracked: 3 };
    list = list.sort((a, b) => order[getStockState(a)] - order[getStockState(b)]);
  } else if (sort === 'az') list = list.sort((a, b) => a.name.localeCompare(b.name));
  else list = list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  return typeof options.limit === 'number' && options.limit > 0 ? list.slice(0, options.limit) : list;
}

export function combineProductOrders<T extends BrowseProduct>(
  products: T[],
  modes: CustomerOrderMode[],
  options: Omit<BrowseOptions, 'preset' | 'sort' | 'limit'> = {},
): T[] {
  const selected = modes.length > 0 ? modes : (['all'] as CustomerOrderMode[]);
  const seen = new Set<string>();
  const ordered: T[] = [];

  for (const id of selected) {
    const mode = CUSTOMER_ORDER_MODES.find(item => item.id === id);
    if (!mode) continue;
    for (const product of browseProducts(products, {
      ...options,
      preset: id,
      sort: mode.sort,
      limit: mode.limit,
    })) {
      if (seen.has(product.id)) continue;
      seen.add(product.id);
      ordered.push(product);
    }
  }

  const remaining = browseProducts(products, { ...options, preset: 'all', sort: 'manual' });
  for (const product of remaining) {
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    ordered.push(product);
  }

  return ordered;
}
