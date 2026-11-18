export const REFERRAL_LINK_CODE_KEY = 'mart_referral_link_code';
export const REFERRAL_CODE_LENGTH = 6;
export const REFERRAL_DISCOUNT_EXCLUSIVITY_MESSAGE = 'Remove your existing offer/coupon first — only one discount per order';

const CODE_PATTERN = /^[A-Z0-9]{6}$/;

export interface ReferralCreditLike {
  id: string;
  amount: number;
  status: string;
}

export interface OrderTotalsInput {
  subtotal: number;
  deliveryCharge: number;
  campaignDiscount?: number;
  referralDiscount?: number;
}

export interface ReferralDiscountState {
  campaignApplied?: boolean;
  couponApplied?: boolean;
  referralApplied?: boolean;
}

function finite(value: number | string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeReferralCode(raw: string | null | undefined): string {
  const code = String(raw ?? '').trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : '';
}

export function referralCodeFromSearch(search: string): string {
  try {
    return normalizeReferralCode(new URLSearchParams(search).get('ref'));
  } catch {
    return '';
  }
}

export function buildReferralLink(code: string, origin: string): string {
  const normalized = normalizeReferralCode(code);
  if (!normalized || !origin) return '';
  return `${origin.replace(/\/+$/, '')}/?ref=${normalized}`;
}

export function buildReferralShareMessage(code: string, link: string, reward = 50): string {
  return `Join Gokez Mart and use my referral code ${normalizeReferralCode(code)}. Both of us can earn ₹${finite(reward)} after your first qualifying order is successfully delivered! ${link}`;
}

export function buildWhatsAppReferralLink(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function readLinkReferralCode(): string {
  try {
    return normalizeReferralCode(typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(REFERRAL_LINK_CODE_KEY));
  } catch {
    return '';
  }
}

export function saveLinkReferralCode(code: string): void {
  try {
    sessionStorage.setItem(REFERRAL_LINK_CODE_KEY, normalizeReferralCode(code));
  } catch {}
}

export function clearLinkReferralCode(): void {
  try {
    sessionStorage.removeItem(REFERRAL_LINK_CODE_KEY);
  } catch {}
}

export function canApplyReferralDiscount(state: ReferralDiscountState): boolean {
  return !state.campaignApplied && !state.couponApplied;
}

export function canApplyCampaignDiscount(state: ReferralDiscountState): boolean {
  return !state.referralApplied;
}

export function discountConflictMessage(): string {
  return REFERRAL_DISCOUNT_EXCLUSIVITY_MESSAGE;
}

export function calculateOrderTotals(input: OrderTotalsInput): number {
  const subtotal = Math.max(0, finite(input.subtotal));
  const delivery = Math.max(0, finite(input.deliveryCharge));
  const discounts = Math.max(0, finite(input.campaignDiscount)) + Math.max(0, finite(input.referralDiscount));
  return Math.ceil(Math.max(0, subtotal + delivery - discounts));
}

export function calculateOrderSavings(input: {
  itemSavings?: number;
  freeDeliverySaving?: number;
  campaignDiscount?: number;
  referralDiscount?: number;
}): number {
  return Math.max(0, finite(input.itemSavings))
    + Math.max(0, finite(input.freeDeliverySaving))
    + Math.max(0, finite(input.campaignDiscount))
    + Math.max(0, finite(input.referralDiscount));
}

export function availableReferralBalance(credits: Array<ReferralCreditLike> | null | undefined): number {
  return (credits || []).reduce((sum, credit) => (
    credit.status === 'available' ? sum + Math.max(0, finite(credit.amount)) : sum
  ), 0);
}

export function isReferralReservationExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at <= now;
}

export function getOrderReferralDiscount(order: any): number {
  if (!order) return 0;
  const explicit = order.referralDiscount ?? order.referralRewardDiscount ?? null;
  if (explicit !== null && explicit !== undefined && explicit !== '') {
    return Math.max(0, finite(explicit));
  }
  return 0;
}

export function referralCreditTotal(order: any): number {
  return Math.max(0, finite(order?.campaignDiscount)) + getOrderReferralDiscount(order);
}
