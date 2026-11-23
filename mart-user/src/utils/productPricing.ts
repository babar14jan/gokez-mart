import type { Product } from '../services/api';

export function getLinePricing(product: Product, unit?: string) {
  const options = product.weightOptions?.length ? product.weightOptions : null;
  const selected = unit && options
    ? options.find(option => option.label === unit) || null
    : null;
  const unitMatches = unit
    ? (options ? Boolean(selected) : unit === product.unit)
    : true;
  const primary = options?.find(option => option.label === product.unit) || null;
  const chosen = selected || primary || options?.[0] || null;
  const base = chosen ? chosen.price : product.price;
  const discount = chosen
    ? (chosen.label === product.unit
      ? (chosen.discountPercent ?? product.discountPercent ?? 0)
      : (chosen.discountPercent ?? 0))
    : (product.discountPercent || 0);
  const price = discount > 0 ? Math.round(base * (1 - discount / 100)) : base;
  return { price, mrp: Math.max(base, price), discountPercent: discount > 0 ? discount : 0, unitMatches };
}

export const getDiscountedPrice = (product: Product) => getLinePricing(product).price;
