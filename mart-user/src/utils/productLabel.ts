import type { Product } from '../services/api';

/**
 * The two-part product label used across the storefront.
 *
 * `primary` is the catalogue name, falling back to the local name when the
 * catalogue name is missing. `secondary` is the local (Hindi) name, shown in
 * brackets after the primary name so it reads as an alternate label for the
 * same product rather than a second, equally-weighted title. It is omitted
 * when it would only repeat the primary name.
 */
export function productLabelParts(
  product: Pick<Product, 'name' | 'localName'>,
): { primary: string; secondary: string } {
  const name = product.name?.trim() ?? '';
  const localName = product.localName?.trim() ?? '';
  if (!name) return { primary: localName, secondary: '' };
  if (!localName || localName === name) return { primary: name, secondary: '' };
  return { primary: name, secondary: localName };
}
