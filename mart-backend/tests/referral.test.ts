import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_DISCOUNT_EXCLUSIVITY_ERROR,
  REFERRAL_RESERVATION_TTL_MINUTES,
  addDays,
  capReached,
  generateReferralCode,
  hasDiscountStack,
  isExpired,
  normalizeReferralCode,
  qualifyingOrderValue,
  referralDiscount,
  reservationExpiry,
  roundMoney,
} from '../src/utils/referralLogic';

describe('referral code generation', () => {
  test('produces six uppercase characters from the unambiguous alphabet', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 500; seed += 1) {
      let cursor = seed;
      const code = generateReferralCode((max) => (cursor = (cursor * 31 + 17) % max));
      assert.equal(code.length, REFERRAL_CODE_LENGTH);
      for (const character of code) {
        assert.ok(REFERRAL_CODE_ALPHABET.includes(character), `${character} must be allowed`);
        seen.add(character);
      }
    }
    assert.equal(seen.size, REFERRAL_CODE_ALPHABET.length);
  });

  test('excludes visually ambiguous characters', () => {
    for (const ambiguous of ['0', 'O', '1', 'I']) {
      assert.equal(REFERRAL_CODE_ALPHABET.includes(ambiguous), false);
    }
  });

  test('normalises case-insensitive input but rejects malformed codes', () => {
    assert.equal(normalizeReferralCode('  ab23cd  '), 'AB23CD');
    assert.equal(normalizeReferralCode('ABC123'), null);
    assert.equal(normalizeReferralCode('AB01CD'), null);
    assert.equal(normalizeReferralCode('ABCDE'), null);
    assert.equal(normalizeReferralCode(null), null);
  });
});

describe('referral discount exclusivity', () => {
  test('allows no discount or exactly one discount', () => {
    assert.equal(hasDiscountStack({}), false);
    assert.equal(hasDiscountStack({ referralCreditId: 'credit-1' }), false);
    assert.equal(hasDiscountStack({ campaignId: 'campaign-1', couponCode: '' }), false);
  });

  test('rejects a referral credit combined with an offer or a coupon', () => {
    assert.equal(hasDiscountStack({ referralCreditId: 'credit-1', campaignId: 'campaign-1' }), true);
    assert.equal(hasDiscountStack({ referralCreditId: 'credit-1', couponCode: 'SAVE10' }), true);
    assert.equal(REFERRAL_DISCOUNT_EXCLUSIVITY_ERROR,
      'Select only one discount: an offer, a coupon code, or a referral reward');
  });
});

describe('referral reward caps', () => {
  test('caps only after the configured number of issued referrer rewards', () => {
    assert.equal(capReached(9, 10), false);
    assert.equal(capReached(10, 10), true);
    assert.equal(capReached(11, 10), true);
  });

  test('handles legacy negative counts safely', () => {
    assert.equal(capReached(-1, 0), true);
  });
});

describe('referral expiry and reservation maths', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');

  test('adds configured days and treats NULL as never', () => {
    assert.equal(addDays(start, 90)?.toISOString(), '2026-04-01T00:00:00.000Z');
    assert.equal(addDays(start, null), null);
    assert.equal(addDays(start, undefined), null);
  });

  test('expires credits at or before the expiry instant', () => {
    const expiry = addDays(start, 90)!;
    assert.equal(isExpired(expiry, expiry), true);
    assert.equal(isExpired(expiry, new Date(expiry.getTime() - 1)), false);
    assert.equal(isExpired(null, start), false);
  });

  test('reserves a credit for thirty minutes by default', () => {
    assert.equal(reservationExpiry(start).toISOString(), '2026-01-01T00:30:00.000Z');
    assert.equal(REFERRAL_RESERVATION_TTL_MINUTES, 30);
  });
});

describe('referral discount amounts', () => {
  test('uses the item subtotal by default and never includes delivery', () => {
    assert.equal(qualifyingOrderValue(200, 40), 200);
    assert.equal(qualifyingOrderValue(200, 40, 'grand_total'), 240);
  });

  test('clamps the credit to the order and to two decimal places', () => {
    assert.equal(referralDiscount(20, 149), 20);
    assert.equal(referralDiscount(20, 10), 10);
    assert.equal(roundMoney(10.005), 10.01);
  });
});
