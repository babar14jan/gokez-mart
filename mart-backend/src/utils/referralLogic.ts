import { randomInt } from 'node:crypto';

/**
 * Pure rules shared by the referral service, its controllers and the unit tests.
 * No database or network access lives here so the rules can be exercised without
 * a live Postgres instance.
 */

export const REFERRAL_CODE_LENGTH = 6;
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REFERRAL_RESERVATION_TTL_MINUTES = 30;
export const REFERRAL_DISCOUNT_EXCLUSIVITY_ERROR =
  'Select only one discount: an offer, a coupon code, or a referral reward';

export type RandomInt = (max: number) => number;

const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export function generateReferralCode(nextInt: RandomInt = randomInt): string {
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    code += REFERRAL_CODE_ALPHABET[nextInt(REFERRAL_CODE_ALPHABET.length)];
  }
  return code;
}

/** Case-insensitive input; invalid input is rejected rather than silently changed. */
export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!REFERRAL_CODE_PATTERN.test(code)) return null;
  for (const character of code) {
    if (!REFERRAL_CODE_ALPHABET.includes(character)) return null;
  }
  return code;
}

export function hasDiscountStack(
  input: { campaignId?: unknown; couponCode?: unknown; referralCreditId?: unknown },
): boolean {
  const selected = [input.campaignId, input.couponCode, input.referralCreditId]
    .filter(value => value !== undefined && value !== null && value !== '').length;
  return selected > 1;
}

/** A referrer's cap counts already-issued referrer rewards, including capped claims. */
export function capReached(issuedReferrerRewards: number, maxReferrals: number): boolean {
  return Math.max(0, Number(issuedReferrerRewards) || 0) >= Math.max(0, Number(maxReferrals) || 0);
}

/** `null` or `undefined` expiry days means the credit never expires. */
export function addDays(source: Date | string | number, days: number | null | undefined): Date | null {
  if (days === null || days === undefined) return null;
  const result = new Date(source);
  result.setUTCDate(result.getUTCDate() + Math.max(0, Math.floor(days)));
  return result;
}

export function isExpired(value: Date | string | number | null | undefined, now: Date = new Date()): boolean {
  if (value === null || value === undefined) return false;
  return new Date(value).getTime() <= now.getTime();
}

export function reservationExpiry(now: Date = new Date(), minutes: number = REFERRAL_RESERVATION_TTL_MINUTES): Date {
  return new Date(now.getTime() + Math.max(0, minutes) * 60_000);
}

export function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * `item_subtotal` is the order subtotal after discounts, excluding delivery.
 * `grand_total` is the same figure including the delivery charge.
 */
export function qualifyingOrderValue(
  subtotal: number,
  deliveryCharge: number = 0,
  valueBasis: string = 'item_subtotal',
): number {
  const items = roundMoney(Math.max(0, subtotal));
  return valueBasis === 'grand_total' ? roundMoney(items + Math.max(0, deliveryCharge)) : items;
}

export function referralDiscount(amount: number, subtotal: number): number {
  return roundMoney(Math.min(Math.max(0, Number(amount) || 0), Math.max(0, Number(subtotal) || 0)));
}
