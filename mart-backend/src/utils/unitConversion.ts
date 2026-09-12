/**
 * Parse a selling unit string like "100g", "500g", "1kg", "250ml", "1 litre", "6 pcs", "1 dozen"
 * and return how much to deduct from base stock per 1 ordered quantity.
 *
 * Returns: { deductionPerQty: number, baseUnit: string }
 *
 * Examples:
 *   "100g"    → { deductionPerQty: 0.1,  baseUnit: 'kg' }
 *   "500g"    → { deductionPerQty: 0.5,  baseUnit: 'kg' }
 *   "1 kg"    → { deductionPerQty: 1,    baseUnit: 'kg' }
 *   "250ml"   → { deductionPerQty: 0.25, baseUnit: 'litre' }
 *   "1 litre" → { deductionPerQty: 1,    baseUnit: 'litre' }
 *   "6 pcs"   → { deductionPerQty: 6,    baseUnit: 'pcs' }
 *   "1 dozen" → { deductionPerQty: 12,   baseUnit: 'pcs' }
 *   "1 bunch" → { deductionPerQty: 1,    baseUnit: 'bunch' }
 *   "1 packet"→ { deductionPerQty: 1,    baseUnit: 'packet' }
 */
export function parseSellingUnit(unit: string): { deductionPerQty: number; baseUnit: string } {
  const u = unit.trim().toLowerCase();

  // Extract leading number (e.g. "500" from "500g", "1" from "1 kg")
  const numMatch = u.match(/^(\d+\.?\d*)/);
  const num = numMatch ? parseFloat(numMatch[1]) : 1;

  if (u.includes('kg')) return { deductionPerQty: num, baseUnit: 'kg' };
  if (u.includes('g'))  return { deductionPerQty: num / 1000, baseUnit: 'kg' };
  if (u.includes('litre') || u.includes('liter') || u.includes('ltr')) return { deductionPerQty: num, baseUnit: 'litre' };
  if (u.includes('ml')) return { deductionPerQty: num / 1000, baseUnit: 'litre' };
  if (u.includes('dozen')) return { deductionPerQty: num * 12, baseUnit: 'pcs' };
  if (u.includes('pcs') || u.includes('pc')) return { deductionPerQty: num, baseUnit: 'pcs' };
  if (u.includes('bunch')) return { deductionPerQty: num, baseUnit: 'bunch' };
  if (u.includes('packet')) return { deductionPerQty: num, baseUnit: 'packet' };

  // Fallback — treat as count
  return { deductionPerQty: num, baseUnit: 'pcs' };
}

/**
 * Format a stock quantity + unit for display.
 * e.g. (4.6, 'kg') → "4.6 kg"
 *      (0.5, 'kg') → "500 g"   (auto-convert small kg to grams for readability)
 *      (30, 'pcs') → "30 pcs"
 */
export function formatStock(qty: number, unit: string): string {
  if (unit === 'kg' && qty < 1 && qty > 0) {
    return `${Math.round(qty * 1000)} g`;
  }
  if (unit === 'litre' && qty < 1 && qty > 0) {
    return `${Math.round(qty * 1000)} ml`;
  }
  // Round to 3 decimal places max, strip trailing zeros
  const rounded = parseFloat(qty.toFixed(3));
  return `${rounded} ${unit}`;
}
