export const REFERRAL_LINK_CODE_KEY = 'mart_referral_link_code';
export const CHECKOUT_REFERRAL_SELECTION_KEY = 'mart_checkout_referral_selection';
export const REFERRAL_CODE_LENGTH = 6;
export const REFERRAL_DISCOUNT_EXCLUSIVITY_MESSAGE = 'Remove your existing offer/coupon first — only one discount per order';

const CODE_PATTERN = /^[A-Z0-9]{6}$/;

export interface CheckoutReferralSelection {
  creditId: string;
  amount: number;
}

export interface ReferralCreditLike {
  id: string;
  amount: number;
  status: string;
  redeemableNow?: boolean;
}

export interface ReferralStageLike {
  stage: number;
  amount: number;
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

export function buildReferralShareMessage(
  code: string,
  link: string,
  stages: Array<ReferralStageLike> = [],
): string {
  const ordered = [...stages].sort((a, b) => finite(a.stage) - finite(b.stage));
  const firstStage = ordered.find(stage => finite(stage.stage) === 1) ?? ordered[0];
  if (!firstStage) {
    return `Join Gokez Mart and use my referral code ${normalizeReferralCode(code)} to unlock referral rewards. ${link}`;
  }
  const first = Math.max(0, finite(firstStage.amount));
  const remaining = ordered
    .filter(stage => stage !== firstStage)
    .reduce((sum, stage) => sum + Math.max(0, finite(stage.amount)), 0);
  const rewardText = remaining > 0
    ? `Get ₹${first} off your first order, then unlock ₹${remaining} after it is delivered`
    : `Get ₹${first} off your first order`;
  return `Join Gokez Mart and use my referral code ${normalizeReferralCode(code)}. ${rewardText}! ${link}`;
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

export function readCheckoutReferralSelection(): CheckoutReferralSelection | null {
  try {
    const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(CHECKOUT_REFERRAL_SELECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const creditId = typeof parsed?.creditId === 'string' ? parsed.creditId.trim() : '';
    const amount = Number(parsed?.amount);
    if (!creditId || !Number.isFinite(amount) || amount < 0) return null;
    return { creditId, amount };
  } catch {
    return null;
  }
}

export function saveCheckoutReferralSelection(selection: CheckoutReferralSelection | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (!selection?.creditId) {
      sessionStorage.removeItem(CHECKOUT_REFERRAL_SELECTION_KEY);
      return;
    }
    const amount = Number(selection.amount);
    sessionStorage.setItem(CHECKOUT_REFERRAL_SELECTION_KEY, JSON.stringify({
      creditId: selection.creditId,
      amount: Number.isFinite(amount) ? Math.max(0, amount) : 0,
    }));
  } catch {}
}

export function clearCheckoutReferralSelection(): void {
  saveCheckoutReferralSelection(null);
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

export function redeemableReferralBalance(credits: Array<ReferralCreditLike> | null | undefined): number {
  return (credits || []).reduce((sum, credit) => (
    credit.status === 'available' && credit.redeemableNow !== false
      ? sum + Math.max(0, finite(credit.amount)) : sum
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
