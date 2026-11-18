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
  clearCheckoutReferralSelection,
  discountConflictMessage,
  getOrderReferralDiscount,
  isReferralReservationExpired,
  normalizeReferralCode,
  readCheckoutReferralSelection,
  referralCodeFromSearch,
  saveCheckoutReferralSelection,
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
    assert.ok(message.includes('₹25'));
    assert.ok(message.includes('first qualifying order'));
    assert.ok(message.includes('delivered'));
    assert.ok(!message.includes('₹50'));
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

  test('checkout referral selection survives reloads and clears on remove or order', () => {
    const values = new Map<string, string>();
    (globalThis as any).sessionStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    assert.equal(readCheckoutReferralSelection(), null);
    saveCheckoutReferralSelection({ creditId: 'credit-1', amount: 30 });
    assert.deepEqual(readCheckoutReferralSelection(), { creditId: 'credit-1', amount: 30 });
    clearCheckoutReferralSelection();
    assert.equal(readCheckoutReferralSelection(), null);
    saveCheckoutReferralSelection({ creditId: 'credit-2', amount: Number.NaN });
    assert.deepEqual(readCheckoutReferralSelection(), { creditId: 'credit-2', amount: 0 });
    clearCheckoutReferralSelection();
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
      "benefitType: 'first_order' | 'reward';",
      'referralId: string | null;',
      "role: 'referrer' | 'referee';",
      'firstOrderCreditId: string | null;',
      "api.get<{ data: { items: ReferralCredit[]; total: number } }>('/referrals/credits'",
      'reservationExpiresAt: string | null;',
      "api.post<{ data: ReferralReservation }>('/referrals/credits/reserve', { creditId, idempotencyKey })",
      '/referrals/credits/${encodeURIComponent(id)}/release',
      'referralCreditId?: string',
    ]);
    assert.ok(api.indexOf('referralCode?: string') < api.indexOf('referralApi ='));
    assert.ok(!api.includes('/referrals/claim'), 'referral codes must be claimed only during registration');
    assert.ok(!api.includes('ReferralClaimData'), 'the removed claim API type must not be used');
  });

  test('app boot opens the login view for ref links', () => {
    assert.ok(source('src/utils/referral.ts').includes(`REFERRAL_LINK_CODE_KEY = '${REFERRAL_LINK_CODE_KEY}'`));
    const app = assertIncludes('src/App.tsx', [
      'referralCodeFromSearch(window.location.search)',
      'REFERRAL_LINK_CODE_KEY',
      "window.history.replaceState({}, '', '/login')",
      "if (referralLinkCode) return 'login';",
      "if (path === '/login') return 'login';",
      'useAccountLoginStore.getState().openLogin()',
    ]);
    assert.ok(app.indexOf('referralCodeFromSearch(window.location.search)') < app.indexOf("window.history.replaceState({}, '', VIEW_PATH[storedView])"));
    assertIncludes('src/utils/seo.ts', ['| \'account\' | \'login\'', 'login: {']);
  });

  test('login flow stores and forwards the optional code', () => {
    assertIncludes('src/components/LoginFlow.tsx', [
      'id="login-referral-code"',
      'Have Referral code?',
      'placeholder="Enter Referral code"',
      'const [referralOpen, setReferralOpen] = useState(() => Boolean(referralCode))',
      'const clearReferral = () => {',
      '(optional)',
      'normalizeReferralCode(referralCode || readLinkReferralCode())',
      'readTrackingTokens(), codeForSignup || undefined',
      'clearLinkReferralCode()',
      'setReferralCode(next || null)',
    ]);
    const login = source('src/components/LoginFlow.tsx');
    assert.ok(!login.includes('referralApi.validate('), 'login must not expose referral validation to the customer');
    assert.ok(!login.includes('referralApi.claim('), 'login must not claim codes outside registration');
    assert.ok(!login.includes('already been applied'), 'existing attribution must not surface as a login error');
    assert.ok(!login.includes('cannot use your own referral code'), 'self-referral details must not surface during login');
    assertIncludes('src/store/loginFlowStore.ts', [
      'referralCode: string | null',
      'setReferralCode: (code: string | null) => void',
      'referralCode,',
    ]);
  });

  test('account page exposes a logged-in referral card and subpage navigation', () => {
    assertIncludes('src/pages/AccountPage.tsx', [
      '{isLoggedIn && (',
      'Refer & Earn',
      'normalizeReferralCode(referralData?.code) || \'—\'',
      'Available referral balance:',
      'formatReferralRupees(referralData?.stats?.available ?? availableReferralBalance(referralData?.credits || []))',
      'handleShareReferral',
      'Share',
      'View details',
      "navigate('/referrals')",
    ]);
    assert.ok(!source('src/pages/AccountPage.tsx').includes('<ReferEarnSheet'), 'the referral flow should open a subpage, not a sheet');
    assertIncludes('src/pages/ReferralPage.tsx', [
      'How it works',
      'Your referral benefit',
      'Your progress',
      'Rewards wallet',
      'Your credits',
      'Referral history',
      'role="alert"',
      'role="status"',
    ]);
  });

  test('checkout selects the next referral credit locally until the order is placed', () => {
    const checkout = assertIncludes('src/pages/CheckoutPage.tsx', [
      'Total referral balance: ₹',
      'You can avail ₹',
      "'Apply'",
      "'Remove'",
      'nextReferralCredit',
      'nextReferralAmount',
      'availableReferralBalance(referralCredits)',
      'creditId: credit.id',
      'const formId = `checkout-form-${useId().replace(/:/g, \'\')}`;',
      '<form id={formId}',
      'form={formId}',
      'useState(() => readCheckoutReferralSelection())',
      'saveCheckoutReferralSelection(selection)',
      'clearCheckoutReferralSelection()',
      'setReferralApplied(null)',
      'canApplyReferralDiscount(',
      'canApplyCampaignDiscount(',
      'discountConflictMessage()',
      'referralCreditId: referralApplied?.creditId || undefined',
      'calculateOrderTotals(',
      'calculateOrderSavings(',
      "credit.benefitType === 'first_order'",
      'First-order referral discount: ₹',
      'Apply to your first eligible order; minimum product subtotal applies.',
      'Referral Reward',
      'confirmedCampaignDiscount + confirmedReferralDiscount',
    ]);
    assert.ok(!checkout.includes('referralApi.reserve('), 'checkout must not reserve before order placement');
    assert.ok(!checkout.includes('referralApi.release('), 'checkout must not release a local selection');
    assert.ok(!checkout.includes('id="checkout-form"'), 'mobile and desktop checkout forms must not share an id');
    assert.ok(!checkout.includes('form="checkout-form"'), 'the submit button must target its own checkout form');
    assert.ok(!checkout.includes('isReferralReservationExpired('), 'checkout must not track reservation expiry');
    assert.ok(!checkout.includes('referralApplying'), 'local selection needs no loading state');
    assert.ok(checkout.includes('Offers &amp; coupons'));
    assert.ok(checkout.includes('referralSection={referralSection}'));
    assert.ok(checkout.includes('rounded-xl border border-gokez-200 bg-gokez-50 px-2.5 py-2 dark:border-gokez-800 dark:bg-slate-900/60'));
    assert.ok(checkout.indexOf('{referralSection &&') < checkout.indexOf('Have a coupon code?'), 'referral balance must render inside offers before the coupon field');
    assert.ok(!checkout.includes('type="checkbox"'), 'checkout must not ask customers to pick a referral credit');
    assert.ok(!checkout.includes('Referral Rewards'), 'checkout must not repeat a referral section label');
    assert.ok(checkout.includes('flex h-[34px] shrink-0 items-center rounded-lg px-2.5 text-[11px] font-bold text-white'));
    assert.ok(checkout.includes('bg-gokez-700 hover:bg-gokez-800'));
    assert.ok(checkout.includes('bg-red-600 hover:bg-red-700'));
    assert.ok(!checkout.includes('We apply your next available referral reward automatically.'));
    assert.ok(!checkout.includes('referral reward applied'));
    assert.ok(!checkout.includes('Referral reward removed.'));
    assert.ok(!checkout.includes('Held until'));
    assert.ok(!checkout.includes('Reserved for this order'));
    const rejectReferralConflict = checkout.match(/const rejectReferralConflict = \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
    assert.ok(rejectReferralConflict.includes('setReferralError(discountConflictMessage())'));
    assert.ok(!rejectReferralConflict.includes('setCouponError('));
    assert.ok(!rejectReferralConflict.includes('setOfferNotice('));
    const removeCampaign = checkout.match(/const removeCampaign = \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
    assert.ok(removeCampaign.includes("setReferralError('')"));
    assert.ok(removeCampaign.includes("setOfferNotice('')"));
  });

  test('order history and printed receipts show the referral bill line', () => {
    assertIncludes('src/pages/OrderHistoryPage.tsx', ['getOrderReferralDiscount(order)', 'Referral Reward']);
    assertIncludes('src/utils/printReceipt.ts', ['getOrderReferralDiscount(order)', 'Referral Reward']);
  });

  test('no new dependencies were added', () => {
    const pkg = JSON.parse(source('package.json'));
    for (const name of ['react-toastify', 'sonner', 'react-hot-toast', 'notistack']) {
      assert.ok(!(name in pkg.dependencies), `${name} must not be added`);
    }
  });
});
