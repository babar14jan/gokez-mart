import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  REFERRAL_DISCOUNT_EXCLUSIVITY_MESSAGE,
  REFERRAL_LINK_CODE_KEY,
  availableReferralBalance,
  buildReferralLink,
  buildReferralShareMessage,
  buildWhatsAppReferralLink,
  calculateOrderSavings,
  calculateOrderTotals,
  canApplyCampaignDiscount,
  canApplyReferralDiscount,
  discountConflictMessage,
  getOrderReferralDiscount,
  isReferralReservationExpired,
  normalizeReferralCode,
  referralCodeFromSearch,
} = await import('../src/utils/referral');

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function assertIncludes(path: string, needles: string[]): string {
  const text = source(path);
  for (const needle of needles) {
    assert.ok(text.includes(needle), `${path} is missing: ${needle}`);
  }
  return text;
}

describe('referral link helpers', () => {
  test('normalizes codes by trimming and uppercasing', () => {
    assert.equal(normalizeReferralCode(' k7p9x2 '), 'K7P9X2');
    assert.equal(normalizeReferralCode('K7P9X2'), 'K7P9X2');
  });

  test('rejects codes that are not exactly six alphanumeric characters', () => {
    assert.equal(normalizeReferralCode(''), '');
    assert.equal(normalizeReferralCode('ABC'), '');
    assert.equal(normalizeReferralCode('K7P9X22'), '');
    assert.equal(normalizeReferralCode('K7P9X-'), '');
    assert.equal(normalizeReferralCode(null), '');
  });

  test('extracts ref from the query string and ignores other parameters', () => {
    assert.equal(referralCodeFromSearch('?ref=k7p9x2'), 'K7P9X2');
    assert.equal(referralCodeFromSearch('?embed=1&ref=%20k7p9x2%20&ch=qr'), 'K7P9X2');
    assert.equal(referralCodeFromSearch('?ch=qr'), '');
    assert.equal(referralCodeFromSearch('?ref=bad'), '');
  });

  test('builds only a ref link with no tracking parameters', () => {
    const link = buildReferralLink('k7p9x2', 'https://mart.gokez.com');
    assert.equal(link, 'https://mart.gokez.com/?ref=K7P9X2');
    assert.ok(!link.includes('utm_'));
    assert.ok(!link.includes('ch='));
    assert.equal(buildReferralLink('bad', 'https://mart.gokez.com'), '');
  });

  test('share message contains the code, the link and the reward copy', () => {
    const link = buildReferralLink('k7p9x2', 'https://mart.gokez.com');
    const message = buildReferralShareMessage('k7p9x2', link);
    assert.ok(message.includes('K7P9X2'));
    assert.ok(message.includes(link));
    assert.ok(message.includes('₹50'));
    assert.ok(message.includes('successfully delivered'));
  });

  test('WhatsApp link encodes the full message', () => {
    const link = buildReferralLink('k7p9x2', 'https://mart.gokez.com');
    const message = buildReferralShareMessage('k7p9x2', link);
    const whatsapp = buildWhatsAppReferralLink(message);
    assert.ok(whatsapp.startsWith('https://wa.me/?text='));
    assert.equal(decodeURIComponent(whatsapp.split('?text=')[1]), message);
  });
});

describe('referral discount rules', () => {
  test('referral rewards cannot stack with a campaign or coupon', () => {
    assert.equal(canApplyReferralDiscount({}), true);
    assert.equal(canApplyReferralDiscount({ campaignApplied: true }), false);
    assert.equal(canApplyReferralDiscount({ couponApplied: true }), false);
    assert.equal(canApplyReferralDiscount({ campaignApplied: true, couponApplied: true }), false);
  });

  test('campaigns and coupons cannot stack with an applied referral reward', () => {
    assert.equal(canApplyCampaignDiscount({}), true);
    assert.equal(canApplyCampaignDiscount({ referralApplied: true }), false);
    assert.equal(discountConflictMessage(), REFERRAL_DISCOUNT_EXCLUSIVITY_MESSAGE);
    assert.equal(REFERRAL_DISCOUNT_EXCLUSIVITY_MESSAGE, 'Remove your existing offer/coupon first — only one discount per order');
  });

  test('totals include referral rewards and never go negative', () => {
    assert.equal(calculateOrderTotals({ subtotal: 500, deliveryCharge: 30 }), 530);
    assert.equal(calculateOrderTotals({ subtotal: 500, deliveryCharge: 30, campaignDiscount: 50 }), 480);
    assert.equal(calculateOrderTotals({ subtotal: 500, deliveryCharge: 30, referralDiscount: 20 }), 510);
    assert.equal(calculateOrderTotals({ subtotal: 100, deliveryCharge: 0, campaignDiscount: 50, referralDiscount: 20 }), 30);
    assert.equal(calculateOrderTotals({ subtotal: 100, deliveryCharge: 0, referralDiscount: 500 }), 0);
    assert.equal(calculateOrderTotals({ subtotal: 100.4, deliveryCharge: 0, referralDiscount: 20 }), 81);
  });

  test('savings include item cuts, free delivery, campaigns and referral rewards', () => {
    assert.equal(calculateOrderSavings({ itemSavings: 40, freeDeliverySaving: 30, campaignDiscount: 50, referralDiscount: 20 }), 140);
    assert.equal(calculateOrderSavings({ referralDiscount: 20 }), 20);
  });

  test('only available credits contribute to the spendable balance', () => {
    const credits = [
      { id: 'a', amount: 20, status: 'available' },
      { id: 'b', amount: 20, status: 'pending' },
      { id: 'c', amount: 20, status: 'available' },
      { id: 'd', amount: 20, status: 'expired' },
    ];
    assert.equal(availableReferralBalance(credits), 40);
    assert.equal(availableReferralBalance([]), 0);
  });

  test('expired reservations are detected', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    assert.equal(isReferralReservationExpired('2025-12-31T23:59:59.000Z', now), true);
    assert.equal(isReferralReservationExpired('2026-01-01T00:00:01.000Z', now), false);
    assert.equal(isReferralReservationExpired(null, now), false);
  });

  test('order referral discount reads explicit fields before the credit fallback', () => {
    assert.equal(getOrderReferralDiscount({ referralDiscount: 20 }), 20);
    assert.equal(getOrderReferralDiscount({ referralRewardDiscount: 20 }), 20);
    assert.equal(getOrderReferralDiscount({ referralCreditId: 'credit-1' }), 0);
    assert.equal(getOrderReferralDiscount({ referralDiscount: 0, referralCreditId: 'credit-1' }), 0);
    assert.equal(getOrderReferralDiscount(null), 0);
  });
});

describe('referral integration points', () => {
  test('api service calls the exact backend contract', () => {
    const api = assertIncludes('src/services/api.ts', [
      "api.post('/auth/verify-otp'",
      'referralCode?: string',
      'referralCode }',
      "api.get<{ success: boolean; data: ReferralMeData }>('/referrals/me')",
      "api.post<{ success: boolean; data: ReferralValidateData }>('/referrals/validate', { code })",
      "api.post<{ success: boolean; data: ReferralClaimData }>('/referrals/claim', { code })",
      "api.get<{ data: { items: ReferralCredit[]; total: number } }>('/referrals/credits'",
      "api.post<{ data: ReferralReservation }>('/referrals/credits/reserve', { creditId, idempotencyKey })",
      '/referrals/credits/${encodeURIComponent(id)}/release',
      'referralCreditId?: string',
    ]);
    assert.ok(api.indexOf('referralCode?: string') < api.indexOf('referralApi ='));
  });

  test('app boot captures ref before the existing query-stripping redirect', () => {
    assert.ok(source('src/utils/referral.ts').includes(`REFERRAL_LINK_CODE_KEY = '${REFERRAL_LINK_CODE_KEY}'`));
    const app = assertIncludes('src/App.tsx', [
      'referralCodeFromSearch(window.location.search)',
      'REFERRAL_LINK_CODE_KEY',
      "window.history.replaceState({}, '', '/account')",
      "if (referralLinkCode) return 'account';",
    ]);
    assert.ok(app.indexOf('referralCodeFromSearch(window.location.search)') < app.indexOf("window.history.replaceState({}, '', VIEW_PATH[storedView])"));
  });

  test('login flow stores and forwards the optional code', () => {
    assertIncludes('src/components/LoginFlow.tsx', [
      'id="login-referral-code"',
      '(optional)',
      'normalizeReferralCode(referralCode || readLinkReferralCode())',
      'readTrackingTokens(), codeForSignup || undefined',
      'clearLinkReferralCode()',
      'setReferralCode(next || null)',
    ]);
    assertIncludes('src/store/loginFlowStore.ts', [
      'referralCode: string | null',
      'setReferralCode: (code: string | null) => void',
      'referralCode,',
    ]);
  });

  test('account page exposes a logged-in referral card and sheet', () => {
    assertIncludes('src/pages/AccountPage.tsx', [
      '{isLoggedIn && (',
      'Refer & Earn',
      'setReferOpen(true)',
      '<ReferEarnSheet',
    ]);
    assertIncludes('src/components/ReferEarnSheet.tsx', [
      'Earn {rupees(reward)}',
      'Copy Code',
      'Copy Link',
      'WhatsApp',
      'buildReferralLink(code, window.location.origin)',
      'Successful referrals',
      'Pending referrals',
      'Total rewards earned',
      'Available to use',
      'Reversed',
      'Pending rewards are not spendable',
      'Your credits',
      'Referral history',
      'eligibleForCode',
      'referralApi.claim(code)',
      'role="alert"',
      'role="status"',
    ]);
  });

  test('checkout reserves, applies and releases referral credits exclusively', () => {
    assertIncludes('src/pages/CheckoutPage.tsx', [
      'Referral Rewards',
      'Available balance: ₹',
      'referralApi.reserve(credit.id, crypto.randomUUID())',
      'referralApi.release(referralApplied.creditId)',
      'crypto.randomUUID()',
      'creditId: referralSelected',
      'canApplyReferralDiscount(',
      'canApplyCampaignDiscount(',
      'discountConflictMessage()',
      'setReferralSelected(null)',
      'setReferralApplied(null)',
      'isReferralReservationExpired(',
      'referralCreditId: referralApplied?.creditId || undefined',
      'calculateOrderTotals(',
      'calculateOrderSavings(',
      'Referral Reward Discount',
      'confirmedCampaignDiscount + confirmedReferralDiscount',
    ]);
  });

  test('order history and printed receipts show the referral bill line', () => {
    assertIncludes('src/pages/OrderHistoryPage.tsx', ['getOrderReferralDiscount(order)', 'Referral Reward Discount']);
    assertIncludes('src/utils/printReceipt.ts', ['getOrderReferralDiscount(order)', 'Referral Reward Discount']);
  });

  test('no new dependencies were added', () => {
    const pkg = JSON.parse(source('package.json'));
    for (const name of ['react-toastify', 'sonner', 'react-hot-toast', 'notistack']) {
      assert.ok(!(name in pkg.dependencies), `${name} must not be added`);
    }
  });
});
