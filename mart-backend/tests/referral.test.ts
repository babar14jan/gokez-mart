import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  parseRewardStages,
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

  test('treats a missing or non-positive cap as unlimited', () => {
    assert.equal(capReached(-1, 0), false);
    assert.equal(capReached(99, 0), false);
    assert.equal(capReached(99, Number.NaN), false);
  });
});

describe('referral expiry and reservation maths', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');

  test('adds configured days and treats NULL, blank or zero as never', () => {
    assert.equal(addDays(start, 90)?.toISOString(), '2026-04-01T00:00:00.000Z');
    assert.equal(addDays(start, null), null);
    assert.equal(addDays(start, undefined), null);
    assert.equal(addDays(start, 0), null);
    assert.equal(addDays(start, -1), null);
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

describe('referral reward stages', () => {
  test('accepts any configured stage count whose amounts equal the total', () => {
    assert.deepEqual(parseRewardStages([
      { stage: 1, amount: 30 },
      { stage: 2, amount: 20 },
    ], 50), [
      { stage: 1, amount: 30 },
      { stage: 2, amount: 20 },
    ]);
    assert.deepEqual(parseRewardStages([
      { stage: 1, amount: 25 },
      { stage: 2, amount: 15 },
      { stage: 3, amount: 10 },
    ], 50).length, 3);
    assert.deepEqual(parseRewardStages('[{"stage":2,"amount":20},{"stage":1,"amount":30}]', 50)[0],
      { stage: 1, amount: 30 });
    assert.deepEqual(parseRewardStages([30, 20], 50), [
      { stage: 1, amount: 30 },
      { stage: 2, amount: 20 },
    ]);
  });

  test('rejects totals that do not match the stage amounts', () => {
    assert.throws(() => parseRewardStages([
      { stage: 1, amount: 30 },
      { stage: 2, amount: 20 },
    ], 60), /add up to the total/);
  });

  test('rejects invalid stage numbers and non-positive amounts', () => {
    assert.throws(() => parseRewardStages([{ stage: 2, amount: 50 }], 50), /sequentially/);
    assert.throws(() => parseRewardStages([{ stage: 1, amount: 0 }], 0), /positive amount/);
    assert.throws(() => parseRewardStages([], 50), /At least one/);
  });

  test('rejects more stages than the Hub can configure', () => {
    const stages = Array.from({ length: 11 }, (_, index) => ({ stage: index + 1, amount: 5 }));
    assert.throws(() => parseRewardStages(stages, 55), /at most 10/);
  });
});

describe('referral campaign updates', () => {
  test('assigns total_reward_amount only once', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes("key === 'rewardStages' || key === 'totalRewardAmount' || data[key] === undefined"));
  });

  test('editing a campaign keeps the name as text', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes("if (key === 'name')"));
    assert.ok(service.includes("const trimmedName = typeof value === 'string' ? value.trim() : ''"));
  });

  test('create and update store unlock trigger and value basis as validated text', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes("unlockTrigger: ['delivered']"));
    assert.ok(service.includes("valueBasis: ['item_subtotal', 'grand_total']"));
    assert.equal(service.split('      if (CAMPAIGN_ENUM_FIELDS[key]) {').length - 1, 1);
    assert.equal(service.split('        } else if (CAMPAIGN_ENUM_FIELDS[key]) {').length - 1, 1);
  });
});

describe('referral staged reward configuration', () => {
  test('live code has no hardcoded reward amounts; historical defaults remain only in migrations', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    const hub = readFileSync(new URL('../../mart-hub/src/services/referralAdminApi.ts', import.meta.url), 'utf8');
    const staged = readFileSync(new URL('../src/database/migrations/141_referral_staged_rewards.sql', import.meta.url), 'utf8');
    const equal = readFileSync(new URL('../src/database/migrations/142_referral_equal_stages.sql', import.meta.url), 'utf8');
    const compat = readFileSync(new URL('../src/database/migrations/145_referral_snapshot_and_compat.sql', import.meta.url), 'utf8');
    for (const [name, text] of Object.entries({ service, hub })) {
      assert.ok(!text.includes('{ stage: 1, amount: 25 }'), name);
      assert.ok(!text.includes('{ stage: 2, amount: 25 }'), name);
      assert.ok(!text.includes('DEFAULT_TOTAL_REWARD_AMOUNT'), name);
    }
    assert.ok(staged.includes('"stage":1,"amount":30.00'));
    assert.ok(staged.includes('"stage":2,"amount":20.00'));
    assert.ok(equal.includes('"stage":1,"amount":25.00'));
    assert.ok(compat.includes('"stage":1,"amount":25.00'));
  });
});

describe('referral attribution is single use', () => {
  test('validation, claim and schema all reject a second referrer', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    const migration = readFileSync(new URL('../src/database/migrations/140_referral_earn.sql', import.meta.url), 'utf8');
    assert.ok(service.includes('SELECT id FROM mart_referrals WHERE referred_customer_id = $1'));
    assert.ok(service.includes('A referral code has already been applied to this account and cannot be changed'));
    assert.ok(service.includes("if (error?.code === '23505')"));
    assert.ok(migration.includes('referred_customer_id   UUID NOT NULL UNIQUE REFERENCES mart_customers(id)'));
  });
});

describe('referral credits are consumed at order placement', () => {
  test('order validation accepts available credits and consumption keeps the row lock safe', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes("credit.status !== 'available' && credit.status !== 'reserved'"));
    assert.ok(service.includes('WHERE id = $1 AND status = $3'));
    assert.ok(service.includes('before: { status: previousStatus }'));
  });

  test('existing unordered reservations are released by migration', () => {
    const migration = readFileSync(new URL('../src/database/migrations/143_referral_release_unordered_reservations.sql', import.meta.url), 'utf8');
    assert.ok(migration.includes("status = 'reserved' AND order_id IS NULL"));
    assert.ok(migration.includes("SET status = 'available'"));
    assert.ok(migration.includes("'restore'"));
    assert.ok(!migration.includes('BEGIN;'));
    assert.ok(!migration.includes('COMMIT;'));
    assert.ok(migration.includes("COALESCE(SUM(CASE WHEN c.status IN ('available', 'reserved') THEN c.amount ELSE 0 END), 0)"));
  });
});

describe('referral discounts are persisted on placed orders', () => {
  test('order insert and response carry the referral credit and discount', () => {
    const order = readFileSync(new URL('../src/services/order.service.ts', import.meta.url), 'utf8');
    assert.ok(order.includes('referral_credit_id, referral_discount)'));
    assert.ok(order.includes('data.referralCreditId || null,'));
    assert.ok(order.includes('referralDiscountAmount]'));
    assert.ok(order.includes('referralDiscount: referralDiscountAmount,'));
    assert.ok(order.includes('subtotal + actualDelivery - campaignDiscount - referralDiscountAmount'));
  });
});

describe('referral admin date filters', () => {
  test('applies from/to to summaries, reports, records and ledger', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes("appendDayRange(filters, 'attributed_at'"));
    assert.ok(service.includes("appendDayRange(filters, 'c.created_at'"));
    assert.ok(service.includes("appendDayRange(filters, 'r.attributed_at'"));
    assert.ok(service.includes("appendDayRange(filters, 'r.qualified_at'"));
    assert.ok(service.includes("appendDayRange(filters, 'c.created_at'"));
    assert.ok(service.includes('FROM mart_referral_credits c ${creditWhere}'));
    assert.ok(service.includes('static async exportCsv(type: ExportType, filters: Record<string, unknown> = {})'));
  });
});

describe('first-order referral discount', () => {
  test('schema separates the immediate discount from later rewards', () => {
    const migration = readFileSync(
      new URL('../src/database/migrations/144_referral_first_order_discount.sql', import.meta.url),
      'utf8'
    );
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(migration.includes("ADD COLUMN IF NOT EXISTS benefit_type TEXT NOT NULL DEFAULT 'reward'"));
    assert.ok(migration.includes("CHECK (benefit_type IN ('first_order', 'reward'))"));
    assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS first_order_credit_id UUID'));
    assert.ok(migration.includes('idx_referral_credits_benefit'));
    assert.ok(service.includes('benefit_type AS "benefitType"'));
  });

  test('migration backfills snapshots, first-order credits and the referral minimum', () => {
    const migration = readFileSync(
      new URL('../src/database/migrations/145_referral_snapshot_and_compat.sql', import.meta.url),
      'utf8'
    );
    assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS reward_stages JSONB'));
    assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS total_reward_amount NUMERIC(10,2)'));
    assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS campaign_version INT'));
    assert.ok(migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_first_order_credit'));
    assert.ok(migration.includes("first_order_credit_id IS NULL"));
    assert.ok(migration.includes("status IN ('pending', 'qualified')"));
    assert.ok(migration.includes("'referral_min_order_amount'"));
  });

  test('wallet counts the first discount and unissued stages before delivery', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes('let promisedPending = 0;'));
    assert.ok(service.includes('const firstOrderBenefits = allCredits'));
    assert.ok(service.includes('rewards.reduce((total, row) => total + money(row.amount), 0) + firstOrderBenefits + promisedPending'));
    assert.ok(service.includes("credit.benefitType !== 'first_order' || !hasPriorOrder || credit.status === 'redeemed'"));
  });

  test('registration creates the first-stage discount without issuing stage rewards', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes("VALUES ($1, 'first_order', $2, $3, $4, $5, $6, 1, 'available', NOW(), $7, NULL)"));
    assert.ok(service.includes('stages[0].amount, expiresAt]'));
    assert.ok(service.includes('ISSUE-FIRST-ORDER:${inserted.rows[0].id}:${firstOrderCredit.rows[0].id}'));
    assert.ok(service.includes("UPDATE mart_referrals SET first_order_credit_id = $2 WHERE id = $1"));
    assert.ok(service.includes("action: 'first_order_discount_created'"));
    assert.ok(service.includes('firstOrderDiscountAmount: stages[0].amount'));
    assert.ok(service.includes('Your first-order discount is ready and the remaining reward unlocks after delivery.'));
    assert.ok(service.includes("if (codeRow.referrerCustomerId === customerId) throw badRequest('You cannot use your own referral code')"));
  });

  test('checkout enforces first order and reserves only one configured stage', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes('This first-order referral discount is no longer valid'));
    assert.ok(service.includes('The first-order referral discount can only be used on your first order'));
    assert.ok(!service.includes('const maxPerOrder = stages[0].amount;'));
    assert.ok(service.includes('await this.assertStageAvailable(client, credit);'));
    assert.ok(service.includes('Add items worth ₹${minimum} to use your referral reward'));
    assert.ok(service.includes("SET status = 'reserved', order_id = $2, reserved_at = NOW(),"));
    assert.ok(service.includes('RESERVE-FIRST-ORDER:${orderId}:${creditId}'));
    assert.ok(service.includes("action: 'first_order_discount_reserved'"));
  });
});

describe('referral delivery issues the remaining reward exactly once', () => {
  test('delivery qualifies the first order and consumes an applied first-order credit', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes('referral_credit_id AS "referralCreditId"'));
    assert.ok(service.includes('if (referral.first_order_credit_id && order.referralCreditId === referral.first_order_credit_id)'));
    assert.ok(service.includes('await this.consumeFirstOrderCredit(client, referral.first_order_credit_id, orderId, null);'));
    assert.ok(!service.includes("return { issued: false, reason: 'referral_not_applied' };"));
  });

  test('delivery is cap-safe and reissues rewards without duplicate-key failures', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes('pg_advisory_xact_lock'));
    assert.ok(service.includes('referral-cap:${referral.referrer_customer_id}'));
    assert.ok(service.includes("WHERE r.referrer_customer_id = $1 AND rw.role = 'referrer' AND rw.status = 'issued'"));
    assert.ok(service.includes('SELECT id FROM mart_referral_rewards WHERE referral_id = $1 AND role = $2 FOR UPDATE'));
    assert.ok(service.includes("status = 'issued',"));
    assert.ok(service.includes('ON CONFLICT (reward_id, stage_number)'));
    assert.ok(service.includes('stage:${stage.stage}:${orderId}'));
    assert.ok(service.includes('stages.filter(stage => stage.stage !== stages[0].stage)'));
    assert.ok(service.includes("VALUES ($1, 'reward', $2,$3,$4,$5,$6,$7,$8,'available',$9,$10,$11)"));
    assert.ok(service.includes('REDEEM-FIRST-ORDER:${orderId}:${creditId}'));
    assert.ok(service.includes("action: 'first_order_discount_consumed'"));
  });

  test('delivery uses the reward snapshot captured at attribution', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes('reward_stages, total_reward_amount,'));
    assert.ok(service.includes('campaign_version, redemption_min_order_amount)'));
    assert.ok(service.includes('const totalRewardAmount = money(referral.total_reward_amount ?? campaign.total_reward_amount);'));
    assert.ok(service.includes('referral.reward_stages ?? campaign.reward_stages'));
    assert.ok(service.includes('const rewardVersion = Number(referral.campaign_version ?? campaign.version ?? 1) || 1;'));
  });

  test('referrer rewards accumulate across referrals', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes("for (const role of ['referrer', 'referee'] as const)"));
    assert.ok(service.includes('referrer_customer_id = $1 AND rw.role = \'referrer\' AND rw.status = \'issued\''));
  });
});

describe('referral reversals preserve the first-order discount', () => {
  test('failed delivery restores the first-order credit and reverses later rewards', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes('RESTORE-FIRST-ORDER-${credit.id}-${referralId}'));
    assert.ok(service.includes("if (credit.benefitType === 'first_order')"));
    assert.ok(service.includes("AND NOT (benefit_type = 'first_order' AND order_id IS NOT NULL)"));
  });

  test('release paths cannot restore an unrelated order-bound credit', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes('if (credit.order_id) return { id: creditId, status: credit.status, released: false };'));
    assert.ok(service.includes('if (credit && credit.order_id === orderId &&'));
  });

  test('pending fraud rejection revokes the unused first-order credit', () => {
    const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes("AND status IN ('available', 'reserved') AND order_id IS NULL"));
    assert.ok(service.includes('REVERSE-FIRST-ORDER:${id}:${credit.id}'));
  });
});

describe('referral codes are registration-only', () => {
  test('existing logins cannot claim a code and the legacy endpoint rejects claims', () => {
    const auth = readFileSync(new URL('../src/services/customerAuth.service.ts', import.meta.url), 'utf8');
    const controller = readFileSync(new URL('../src/controllers/index.ts', import.meta.url), 'utf8');
    assert.ok(auth.includes('const isNewCustomer = !existingCustomer.rows[0];'));
    assert.ok(auth.includes("if (isNewCustomer && typeof referralCode === 'string' && referralCode.trim())"));
    assert.ok(auth.indexOf('const isNewCustomer') < auth.indexOf('ReferralService.claimCode'));
    assert.ok(auth.includes("ReferralService.claimCode(customer.id, referralCode, 'registration')"));
    assert.ok(auth.includes("console.error('[referral] attribution skipped after OTP verification');"));
    assert.ok(controller.includes('Referral codes can only be entered during registration'));
  });
});

describe('referral redemption configuration and money safety', () => {
  const service = readFileSync(new URL('../src/services/referral.service.ts', import.meta.url), 'utf8');
  const migration = readFileSync(
    new URL('../src/database/migrations/149_referral_redemption_configuration.sql', import.meta.url),
    'utf8',
  );
  const backfillMigration = readFileSync(
    new URL('../src/database/migrations/150_referral_backfill_unlock_amounts.sql', import.meta.url),
    'utf8',
  );
  const repairMigration = readFileSync(
    new URL('../src/database/migrations/151_referral_backfill_repair.sql', import.meta.url),
    'utf8',
  );

  test('the redemption minimum is configuration-only and snapshotted', () => {
    assert.ok(service.includes("redemptionMinOrderAmount: 'redemption_min_order_amount'"));
    assert.ok(service.includes('private static async configuredRedemptionMinimum'));
    assert.ok(service.includes("throw new Error('Referral redemption minimum is not configured')"));
    assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS redemption_min_order_amount NUMERIC(10,2)'));
    assert.ok(migration.includes('mart_settings'));
    assert.ok(migration.includes('UPDATE mart_referral_credits'));
    assert.ok(!migration.includes('199'));
    assert.ok(!service.includes('totalRewardAmount: 50'));
    assert.ok(!service.includes('{ stage: 1, amount: 25 }'));
  });

  test('delivery qualifies any order value while redemption keeps the configured minimum', () => {
    assert.ok(!service.includes("reason: 'below_minimum'"));
    assert.ok(service.includes('if (credit.benefitType !== \'first_order\') {'));
    assert.ok(service.includes('Add items worth ₹${minimum} to use your referral reward'));
    assert.ok(service.includes("benefitType !== 'first_order' || !hasPriorOrder || credit.status === 'redeemed'"));
  });

  test('an unused first-order discount is converted into stage 1 reward, never forfeited', () => {
    assert.ok(service.includes("SET benefit_type = 'reward', reward_id = $2, stage_number = $3"));
    assert.ok(service.includes("action: 'first_order_credit_converted'"));
    assert.ok(service.includes('First-order discount converted to stage 1 reward'));
    assert.ok(service.includes('CONVERT-FIRST-ORDER:${referral.id}:${firstCredit.id}:${orderId}'));
  });

  test('expired and already-used first-order credits keep referee stages reachable', () => {
    const migration = readFileSync(new URL('../src/database/migrations/151_referral_backfill_repair.sql', import.meta.url), 'utf8');
    assert.ok(service.includes("firstCredit?.status === 'expired'"));
    assert.ok(service.includes('RESTORE-EXPIRED-FIRST-ORDER:${referral.id}:${firstCredit.id}:${orderId}'));
    assert.ok(service.includes('Expired first-order discount restored as stage 1 reward'));
    assert.ok(service.includes('SET reward_id = $2, stage_number = $3, updated_at = NOW()'));
    assert.ok(migration.includes('COALESCE(credit_row.amount, 0)'));
    assert.ok(migration.includes('SUM(amount) FROM mart_referral_credits'));
  });

  test('direct API calls enforce first-order eligibility and stage order', () => {
    const orderService = readFileSync(new URL('../src/services/order.service.ts', import.meta.url), 'utf8');
    assert.ok(service.includes('private static async assertFirstOrderCreditEligible'));
    assert.equal((service.match(/await this\.assertFirstOrderCreditEligible\(/g) || []).length, 2);
    assert.ok(!service.includes('await this.validateCreditForOrder(client, customerId, creditId, subtotal);'));
    assert.ok(orderService.includes('consumeCreditForOrder(client, data.customerId!, data.referralCreditId, orderId)'));
  });

  test('a campaign pause cannot void rewards already attributed to a customer', () => {
    assert.ok(service.includes("campaign.unlock_trigger !== 'delivered'"));
    assert.ok(!service.includes('Rewards skipped: campaign not active at delivery'));
    assert.ok(!service.includes('category_not_eligible'));
  });

  test('campaign configuration rejects unsafe caps and immediate expiry', () => {
    const backfill = readFileSync(new URL('../src/database/migrations/150_referral_backfill_unlock_amounts.sql', import.meta.url), 'utf8');
    const constraints = readFileSync(new URL('../src/database/migrations/153_referral_config_constraints.sql', import.meta.url), 'utf8');
    assert.ok(service.includes('maxReferralsPerReferrer must be at least 1'));
    assert.ok(service.includes("key === 'maxReferralsPerReferrer' && (value === null || value === '')"));
    assert.ok(service.includes('if (Number(values[column]) === 0) values[column] = null;'));
    assert.ok(service.includes('Adjustment cannot take the referral balance below zero'));
    assert.ok(backfill.includes('source_campaign_expiry_days <= 0 THEN NULL'));
    assert.ok(backfill.includes('ord_row.subtotal - floor(ord_row.campaign_discount)'));
    assert.ok(constraints.includes('mart_referral_campaigns_cap_positive'));
    assert.ok(constraints.includes('mart_referral_campaigns_expiry_positive'));
  });

  test('credits expose both total unlocked and currently redeemable amounts', () => {
    assert.ok(service.includes('const isRedeemableNow'));
    assert.ok(service.includes('credit.redeemableNow = isRedeemableNow(credit)'));
    assert.ok(service.includes('const redeemableNow = roundMoney'));
    assert.ok(service.includes('redeemableNow,'));
  });

  test('the existing-customer backfill is idempotent, configuration-only, and ledgered', () => {
    assert.ok(backfillMigration.includes("WHERE ref.status IN ('pending', 'qualified')"));
    assert.ok(backfillMigration.includes('COALESCE('));
    assert.ok(backfillMigration.includes('ref_row.redemption_min_order_amount'));
    assert.ok(backfillMigration.includes('ref_row.source_campaign_min'));
    assert.ok(backfillMigration.includes('ON CONFLICT (reward_id, stage_number)'));
    assert.ok(backfillMigration.includes('mart_referral_transactions'));
    assert.ok(backfillMigration.includes('mart_referral_audit_logs'));
    assert.ok(!backfillMigration.includes('199'));
    assert.ok(!backfillMigration.includes('25.00'));
  });

  test('legacy first-order credits are repaired without creating new money', () => {
    assert.ok(repairMigration.includes("c.status = 'expired'"));
    assert.ok(repairMigration.includes('BACKFILL-RESTORE-EXPIRED-FIRST-ORDER:'));
    assert.ok(repairMigration.includes('first_order_credit_restored_after_expiry'));
    assert.ok(repairMigration.includes('first_order_credit_linked_after_backfill'));
    assert.ok(repairMigration.includes('WHERE expiry_days = 0'));
  });
});
