import AsyncStorage from '@react-native-async-storage/async-storage';

export const REFERRAL_LINK_CODE_KEY = 'mart_referral_link_code';
export const CHECKOUT_REFERRAL_SELECTION_KEY = 'mart_checkout_referral_selection';
export const REFERRAL_CODE_LENGTH = 6;
export const REFERRAL_DISCOUNT_EXCLUSIVITY_MESSAGE = 'Remove your existing offer/coupon first — only one discount per order';

const CODE_PATTERN = /^[A-Z0-9]{6}$/;
const CODE_IN_TEXT = /[A-Z0-9]{6}/g;

export interface CheckoutReferralSelection {
  creditId: string;
  amount: number;
}

export interface ReferralCreditLike {
  id?: string;
  amount?: number | string | null;
  status?: string | null;
  redeemableNow?: boolean;
  benefitType?: string | null;
  redemptionMinOrderAmount?: number | string | null;
  expiresAt?: string | null;
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

export function parseReferralCode(input: string | null | undefined): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const direct = normalizeReferralCode(raw);
  if (direct) return direct;

  const candidatePatterns = [
    /[?&#/]ref[/=:]([A-Za-z0-9]{6})\b/i,
    /\bref(?:erral)?(?:Code)?[:=]([A-Za-z0-9]{6})\b/i,
    /\/ref\/([A-Za-z0-9]{6})\b/i,
  ];
  for (const pattern of candidatePatterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      const code = normalizeReferralCode(match[1]);
      if (code) return code;
    }
  }

  try {
    const url = new URL(raw);
    const fromQuery = normalizeReferralCode(url.searchParams.get('ref'));
    if (fromQuery) return fromQuery;
    const fromPath = normalizeReferralCode(url.pathname.split('/').filter(Boolean).pop());
    if (fromPath) return fromPath;
  } catch {}

  const tokens = raw.match(CODE_IN_TEXT) ?? [];
  for (const token of tokens) {
    const code = normalizeReferralCode(token);
    if (code && !/^[0-9]{6}$/.test(code)) return code;
  }
  return '';
}

export function buildReferralLink(code: string, baseUrl: string): string {
  const normalized = normalizeReferralCode(code);
  if (!normalized || !baseUrl) return '';
  return `${baseUrl.replace(/\/+$/, '')}/?ref=${normalized}`;
}

export function buildReferralShareMessage(
  code: string,
  link: string,
  stages: ReferralStageLike[] = [],
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

let storedCode = '';
let hydratePromise: Promise<void> | null = null;

function hydrateStoredCode(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = AsyncStorage.getItem(REFERRAL_LINK_CODE_KEY)
      .then(value => { storedCode = normalizeReferralCode(value); })
      .catch(() => undefined);
  }
  return hydratePromise;
}

void hydrateStoredCode();

export function readStoredReferralCode(): string {
  void hydrateStoredCode();
  return storedCode;
}

export function writeStoredReferralCode(raw: string | null | undefined): void {
  storedCode = normalizeReferralCode(raw);
  void AsyncStorage.setItem(REFERRAL_LINK_CODE_KEY, storedCode).catch(() => undefined);
}

export function clearStoredReferralCode(): void {
  storedCode = '';
  void AsyncStorage.removeItem(REFERRAL_LINK_CODE_KEY).catch(() => undefined);
}

let checkoutSelection: CheckoutReferralSelection | null = null;
let hydrateSelectionPromise: Promise<void> | null = null;

function hydrateCheckoutSelection(): Promise<void> {
  if (!hydrateSelectionPromise) {
    hydrateSelectionPromise = AsyncStorage.getItem(CHECKOUT_REFERRAL_SELECTION_KEY)
      .then(value => {
        if (!value) return;
        const parsed = JSON.parse(value);
        const creditId = typeof parsed?.creditId === 'string' ? parsed.creditId.trim() : '';
        const amount = Number(parsed?.amount);
        checkoutSelection = creditId && Number.isFinite(amount) && amount >= 0
          ? { creditId, amount }
          : null;
      })
      .catch(() => undefined);
  }
  return hydrateSelectionPromise;
}

void hydrateCheckoutSelection();

export function readCheckoutReferralSelection(): CheckoutReferralSelection | null {
  void hydrateCheckoutSelection();
  return checkoutSelection;
}

export function saveCheckoutReferralSelection(selection: CheckoutReferralSelection | null): void {
  checkoutSelection = selection?.creditId
    ? { creditId: selection.creditId, amount: Math.max(0, finite(selection.amount)) }
    : null;
  if (!checkoutSelection) {
    void AsyncStorage.removeItem(CHECKOUT_REFERRAL_SELECTION_KEY).catch(() => undefined);
    return;
  }
  void AsyncStorage.setItem(CHECKOUT_REFERRAL_SELECTION_KEY, JSON.stringify(checkoutSelection)).catch(() => undefined);
}

export function clearCheckoutReferralSelection(): void {
  saveCheckoutReferralSelection(null);
}

export function sortReferralCredits<T extends ReferralCreditLike>(credits: T[] | null | undefined): T[] {
  const usable = (credit: T) => credit.status === 'available' && credit.redeemableNow !== false;
  return [...(credits ?? [])].sort((a, b) => {
    const aUsable = usable(a) ? 0 : 1;
    const bUsable = usable(b) ? 0 : 1;
    if (aUsable !== bUsable) return aUsable - bUsable;
    const aFirst = String(a.benefitType ?? '') === 'first_order' ? 0 : 1;
    const bFirst = String(b.benefitType ?? '') === 'first_order' ? 0 : 1;
    if (aFirst !== bFirst) return aFirst - bFirst;
    const amountDiff = finite(b.amount) - finite(a.amount);
    if (amountDiff !== 0) return amountDiff;
    const aExpiry = Date.parse(a.expiresAt ?? '') || Number.MAX_SAFE_INTEGER;
    const bExpiry = Date.parse(b.expiresAt ?? '') || Number.MAX_SAFE_INTEGER;
    return aExpiry - bExpiry;
  });
}

export function canUseReferralCredit(
  credit: ReferralCreditLike | null | undefined,
  subtotal: number,
  isFirstOrder?: boolean,
): boolean {
  if (!credit) return false;
  if (credit.status !== 'available') return false;
  if (credit.redeemableNow === false) return false;
  const amount = finite(credit.amount);
  if (amount <= 0) return false;
  const firstOrder = isFirstOrder === true || String(credit.benefitType ?? '') === 'first_order';
  if (firstOrder) return true;
  const minimum = Math.max(0, finite(credit.redemptionMinOrderAmount));
  return Math.max(0, finite(subtotal)) >= minimum;
}

export function referralDiscountFor(
  credit: ReferralCreditLike | null | undefined,
  subtotal: number,
  campaignApplied: boolean,
): number {
  if (campaignApplied) return 0;
  if (!canUseReferralCredit(credit, subtotal)) return 0;
  return Math.min(Math.max(0, finite(credit?.amount)), Math.max(0, finite(subtotal)));
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

export function availableReferralBalance(credits: ReferralCreditLike[] | null | undefined): number {
  return (credits ?? []).reduce((sum, credit) => (
    credit.status === 'available' ? sum + Math.max(0, finite(credit.amount)) : sum
  ), 0);
}

export function redeemableReferralBalance(credits: ReferralCreditLike[] | null | undefined): number {
  return (credits ?? []).reduce((sum, credit) => (
    credit.status === 'available' && credit.redeemableNow !== false
      ? sum + Math.max(0, finite(credit.amount)) : sum
  ), 0);
}

export function isReferralReservationExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at <= now;
}

export function getOrderReferralDiscount(order: Record<string, unknown> | null | undefined): number {
  if (!order) return 0;
  const explicit = order.referralDiscount ?? order.referralRewardDiscount ?? null;
  if (explicit !== null && explicit !== undefined && explicit !== '') {
    return Math.max(0, finite(explicit as number | string));
  }
  return 0;
}

export function referralCreditTotal(order: Record<string, unknown> | null | undefined): number {
  return Math.max(0, finite((order?.campaignDiscount as number | string | undefined) ?? 0))
    + getOrderReferralDiscount(order);
}
