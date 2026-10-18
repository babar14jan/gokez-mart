const DEFAULT_COUNTRY_CODE = '91';

/**
 * Normalizes a store/WhatsApp number to digits-only E.164 (no '+').
 * Numbers saved without a country code (10-digit Indian mobiles) get '91' prepended.
 * Returns '' for empty/invalid input.
 */
export function normalizeWhatsAppNumber(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  // Already has a country code (11+ digits) or is a short-code — use as-is.
  if (digits.length >= 11) return digits;
  // 10-digit Indian mobile without country code.
  if (digits.length === 10) return DEFAULT_COUNTRY_CODE + digits;
  return digits;
}

export function buildWhatsAppLink(raw: string | null | undefined, message?: string): string {
  const number = normalizeWhatsAppNumber(raw);
  if (!number) return '';
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${number}${text}`;
}
