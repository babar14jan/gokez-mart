/**
 * Campaign live-editing governance tests (migration 053).
 *
 * Covers the behaviour that replaced the old "cannot edit after redemption"
 * block: commercial terms are editable on a running campaign, each change is
 * audited, the published coupon code is superseded rather than mutated, a
 * minimum-order changes take effect immediately, and a reversed redemption no
 * longer counts as a use.
 *
 * Harness matches tests/security.test.ts — Node's `node:test` via `tsx`, with
 * `pg.Pool.prototype.connect` stubbed so the real service code runs against
 * scripted rows and the real SQL is captured for assertion.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'campaign-governance-test-secret';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

const require = createRequire(__filename);

// ── Scripted database ────────────────────────────────────────────────────────
type Row = Record<string, any>;
interface Call { text: string; params: unknown[] }

const calls: Call[] = [];
/** Rows returned for the next `SELECT * FROM mart_campaigns WHERE id = $1`. */
let campaignRow: Row | null = null;
/** Rows returned for the coupon-code uniqueness probe. */
let couponClash: Row[] = [];
/** Rows returned for existing targeted customers. */
let existingTargets: Row[] = [];
/** Rows returned for existing category scope. */
let existingCategoryIds: Row[] = [];
/** Rows returned for the category scope loaded during coupon validation. */
let categoryScopeRows: Row[] = [];
/** Rows returned for public welcome offer projections. */
let publicCampaignRows: Row[] = [];
/** Simulated failure of audit inserts, to prove they are non-fatal. */
let auditInsertFails = false;

const pg = require('pg');
(pg.Pool.prototype as any).connect = async function () {
  return {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/INSERT INTO mart_campaign_changes/.test(text)) {
        if (auditInsertFails) throw new Error('simulated audit failure');
        return { rows: [] };
      }
      if (/FROM mart_campaign_targets WHERE campaign_id/.test(text)) {
        return { rows: existingTargets };
      }
      if (/FROM mart_campaigns c/.test(text)) {
        return { rows: publicCampaignRows };
      }
      if (/FROM mart_campaign_categories cc/.test(text)) {
        return { rows: categoryScopeRows };
      }
      if (/FROM mart_campaign_categories WHERE campaign_id/.test(text)) {
        return { rows: existingCategoryIds };
      }
      if (/SELECT id FROM mart_campaigns WHERE coupon_code/.test(text)) {
        return { rows: couponClash };
      }
      if (/SELECT \* FROM mart_campaigns\s+WHERE (id|coupon_code)/.test(text)) {
        return { rows: campaignRow ? [campaignRow] : [] };
      }
      if (/^UPDATE mart_campaigns SET/.test(text)) {
        return { rows: [campaignRow] };
      }
      if (/^INSERT INTO mart_campaigns \(/.test(text)) {
        return { rows: [{ ...(campaignRow || {}), id: 'campaign-new', coupon_code: params[8] }] };
      }
      return { rows: [] };
    },
    release: () => {},
  };
};

const { CampaignService } = require('../src/services/campaign.service') as
  { CampaignService: any };

const ADMIN = 'admin-1';

/** A live campaign that has already been redeemed. */
const liveCampaign = (over: Row = {}): Row => ({
  id: 'campaign-1',
  title: 'Weekend Offer',
  subtitle: null, description: null, badge_text: null,
  discount_type: 'percent', discount_value: 20, max_discount: 200,
  min_order_amount: 500,
  coupon_code: 'WEEKEND20',
  new_customers_only: false,
  per_customer_limit: 1, usage_limit: 100, usage_count: 3,
  store_id: 'store-1',
  show_in_carousel: true, carousel_image_url: '/banner.webp',
  carousel_gradient: 'from-emerald-500', carousel_sort_order: 1,
  status: 'active', valid_from: null, valid_until: null,
  eligibility_type: 'all', inactive_days: null, allow_redemption_until_used: false, priority: 5,
  requires_scheduled_delivery: true, exclude_first_hour_after_open: true,
  superseded_by: null, superseded_at: null,
  ...over,
});

const ran = (re: RegExp) => calls.some(c => re.test(c.text));
const findCall = (re: RegExp) => calls.find(c => re.test(c.text));

/**
 * Read an `INSERT INTO mart_campaigns (...)` call as a column-keyed row, so
 * assertions bind to column names rather than positional indexes and cannot
 * silently drift if the INSERT is reordered.
 */
const insertedRow = (): Record<string, unknown> => {
  const call = findCall(/^INSERT INTO mart_campaigns \(/);
  assert.ok(call, 'an INSERT INTO mart_campaigns was issued');
  const start = call!.text.indexOf('(');
  const end = call!.text.indexOf(')', start);
  const cols = call!.text.slice(start + 1, end).split(',').map(s => s.trim());
  const out: Record<string, unknown> = {};
  cols.forEach((c, i) => { out[c] = call!.params[i]; });
  return out;
};

beforeEach(() => {
  calls.length = 0;
  campaignRow = liveCampaign();
  couponClash = [];
  existingTargets = [];
  existingCategoryIds = [];
  categoryScopeRows = [];
  publicCampaignRows = [];
  auditInsertFails = false;
});

// ── The original defect ──────────────────────────────────────────────────────
describe('a redeemed campaign can be edited', () => {
  test('changing the minimum order is allowed even with redemptions', async () => {
    const result = await CampaignService.update('campaign-1', { minOrderAmount: 800 });
    assert.ok(result, 'update should succeed');
    assert.ok(ran(/^UPDATE mart_campaigns SET/), 'the campaign row is written');
  });

  test('the old blanket rejection message is gone', async () => {
    await CampaignService.update('campaign-1', { minOrderAmount: 800, discountValue: 25 });
    assert.ok(!ran(/has been redeemed/), 'no redemption-lock query is issued');
  });

  test('discount, limits and eligibility are all editable while live', async () => {
    await CampaignService.update('campaign-1', {
      discountType: 'flat', discountValue: 150, maxDiscount: 300,
      perCustomerLimit: 3, usageLimit: 500, eligibilityType: 'inactive_customers', inactiveDays: 30,
    });
    assert.ok(ran(/^UPDATE mart_campaigns SET/), 'terms are written through');
  });

  test('a cosmetic-only edit does not require any redemption check', async () => {
    await CampaignService.update('campaign-1', { title: 'Weekend Sale' });
    assert.ok(!ran(/mart_campaign_uses/), 'redemptions are not read at all');
  });
});

describe('financial campaign guardrails', () => {
  test('rejects percentage discounts above 100 before updating the campaign', async () => {
    await assert.rejects(
      CampaignService.update('campaign-1', { discountValue: 101 }),
      /no more than 100/i,
    );
    assert.ok(!ran(/^UPDATE mart_campaigns SET/), 'invalid terms never reach the database');
  });

  test('rejects negative campaign amounts and non-positive limits', async () => {
    await assert.rejects(
      CampaignService.update('campaign-1', { minOrderAmount: -1 }),
      /cannot be negative/i,
    );
    await assert.rejects(
      CampaignService.update('campaign-1', { usageLimit: 0 }),
      /limits must be positive/i,
    );
  });

  test('rejects campaign validity windows that end before they start', async () => {
    await assert.rejects(
      CampaignService.update('campaign-1', {
        validFrom: '2026-10-05T10:00:00.000Z',
        validUntil: '2026-10-05T09:00:00.000Z',
      }),
      /end time must be after/i,
    );
  });

  test('locks a first-order campaign to one use per customer', async () => {
    await assert.rejects(
      CampaignService.update('campaign-1', { eligibilityType: 'first_order', perCustomerLimit: 2 }),
      /per-customer limit of 1/i,
    );
  });

  test('allows the existing FIRST50-style one-use campaign terms', async () => {
    campaignRow = liveCampaign({ eligibility_type: 'first_order', new_customers_only: true });
    const result = await CampaignService.update('campaign-1', { perCustomerLimit: 1 });
    assert.ok(result, 'valid first-order campaign remains editable');
  });
});

// ── Audit trail ──────────────────────────────────────────────────────────────
describe('term changes are audited', () => {
  test('each changed field is recorded with its old and new value', async () => {
    await CampaignService.update('campaign-1', { minOrderAmount: 800, discountValue: 25 });
    const audits = calls.filter(c => /INSERT INTO mart_campaign_changes/.test(c.text));
    assert.equal(audits.length, 2, 'one audit row per changed field');
    const fields = audits.map(a => a.params[1]).sort();
    assert.deepEqual(fields, ['discount_value', 'min_order_amount']);
    const minOrderAudit = audits.find(a => a.params[1] === 'min_order_amount')!;
    assert.equal(minOrderAudit.params[2], '500', 'old value captured');
    assert.equal(minOrderAudit.params[3], '800', 'new value captured');
  });

  test('the acting admin and reason are recorded', async () => {
    await CampaignService.update('campaign-1', { minOrderAmount: 800, adminId: ADMIN, changeReason: 'margin pressure' });
    const audit = findCall(/INSERT INTO mart_campaign_changes/)!;
    assert.equal(audit.params[5], ADMIN, 'changed_by is the admin');
    assert.equal(audit.params[4], 'margin pressure', 'reason is kept');
  });

  test('a no-op edit writes no audit rows', async () => {
    await CampaignService.update('campaign-1', { minOrderAmount: 500 });
    assert.ok(!ran(/INSERT INTO mart_campaign_changes/), 'unchanged value is not audited');
  });

  test('numeric old/new values are recorded on the same scale', async () => {
    // pg returns NUMERIC as "500.00" while the request carries 800; both sides
    // are normalised so the trail reads "500 → 800", not "500.00 → 800".
    campaignRow = liveCampaign({ discount_value: '20.00', min_order_amount: '500.00' });
    await CampaignService.update('campaign-1', { minOrderAmount: 800, discountValue: 25 });
    const audits = calls.filter(c => /INSERT INTO mart_campaign_changes/.test(c.text));
    const minOrderAudit = audits.find(a => a.params[1] === 'min_order_amount')!;
    const discountAudit = audits.find(a => a.params[1] === 'discount_value')!;
    assert.equal(minOrderAudit.params[2], '500');
    assert.equal(minOrderAudit.params[3], '800');
    assert.equal(discountAudit.params[2], '20');
    assert.equal(discountAudit.params[3], '25');
  });

  test('clearing a nullable term records null on both sides', async () => {
    campaignRow = liveCampaign({ usage_limit: 250 });
    await CampaignService.update('campaign-1', { usageLimit: null });
    const audit = findCall(/INSERT INTO mart_campaign_changes/)!;
    assert.equal(audit.params[1], 'usage_limit');
    assert.equal(audit.params[2], '250', 'old value');
    assert.equal(audit.params[3], null, 'new value is null, not "null" or 0');
  });

  test('an audit failure does not fail the save (the row is already committed)', async () => {
    auditInsertFails = true;
    const result = await CampaignService.update('campaign-1', { minOrderAmount: 800 });
    assert.ok(result, 'the campaign update still succeeds');
    assert.ok(ran(/^UPDATE mart_campaigns SET/), 'the campaign row was written');
  });
});

// ── Minimum-order changes take effect immediately ───────────────────────────
describe('minimum-order changes take effect immediately', () => {
  test('a raise writes only the current threshold with no grace state', async () => {
    await CampaignService.update('campaign-1', { minOrderAmount: 800 });
    const update = findCall(/^UPDATE mart_campaigns SET/)!;
    const sql = update.text;
    assert.match(sql, /min_order_amount = \$\d+/, 'current threshold is persisted');
    assert.doesNotMatch(sql, /min_order_previous|min_order_grace_until/, 'no previous threshold or grace deadline is written');
    assert.equal(update.params[0], 800, 'the new threshold takes effect immediately');
  });

  test('lowering the minimum order also writes no grace state', async () => {
    await CampaignService.update('campaign-1', { minOrderAmount: 200 });
    const update = findCall(/^UPDATE mart_campaigns SET/)!;
    assert.doesNotMatch(update.text, /min_order_previous|min_order_grace_until/, 'no grace state is written');
    assert.equal(update.params[0], 200, 'the lowered threshold is persisted');
  });
});

describe('customer-aware carousel slides', () => {
  test('hides a campaign slide after the signed-in customer has redeemed it', async () => {
    await CampaignService.getCarouselSlides(true, 'customer-1');
    const carouselQuery = findCall(/FROM mart_carousel_slides cs/)!;
    assert.match(carouselQuery.text, /cs\.is_active = true/, 'only active slides are returned');
    assert.match(carouselQuery.text, /NOT EXISTS \(\s*SELECT 1 FROM mart_campaign_uses cu/, 'redeemed campaign slides are excluded');
    assert.match(carouselQuery.text, /cu\.customer_id = \$1/, 'the exclusion is scoped to the signed-in customer');
    assert.match(carouselQuery.text, /cu\.reversed_at IS NULL/, 'reversed redemptions do not hide the slide');
    assert.deepEqual(carouselQuery.params, ['customer-1'], 'the customer ID is bound as a query parameter');
  });

  test('keeps the guest carousel public without a customer-use filter', async () => {
    await CampaignService.getCarouselSlides(true);
    const carouselQuery = findCall(/FROM mart_carousel_slides cs/)!;
    assert.doesNotMatch(carouselQuery.text, /mart_campaign_uses cu/, 'guests can still see welcome campaign slides');
    assert.deepEqual(carouselQuery.params, [], 'no customer identity is required');
  });
});

// ── The coupon code stays immutable ──────────────────────────────────────────
describe('the published coupon code is never mutated', () => {
  test('changing the code is refused with a pointer to supersede', async () => {
    await assert.rejects(
      () => CampaignService.update('campaign-1', { couponCode: 'NEWCODE' }),
      (err: Error) => {
        assert.match(err.message, /cannot be changed/i);
        assert.match(err.message, /[Ss]upersede/);
        return true;
      },
    );
  });

  test('re-sending the identical code is not treated as a change', async () => {
    // Same value in a different case/whitespace must not trip the guard.
    await CampaignService.update('campaign-1', { couponCode: ' weekend20 ' });
    assert.ok(ran(/^UPDATE mart_campaigns SET/), 'a no-op code round-trip is allowed');
  });

  test('no row is written when the code change is refused', async () => {
    await CampaignService.update('campaign-1', { couponCode: 'NEWCODE' }).catch(() => {});
    assert.ok(!ran(/^UPDATE mart_campaigns SET/), 'nothing is persisted');
  });
});

// ── Supersede ────────────────────────────────────────────────────────────────
describe('supersede mints a new version without losing the offer', () => {
  test('every commercial term is carried forward, not reset to defaults', async () => {
    await CampaignService.supersede('campaign-1', { couponCode: 'weekend25' }, ADMIN);
    const row = insertedRow();
    assert.equal(row.title, 'Weekend Offer', 'title carried');
    assert.equal(row.discount_type, 'percent', 'discount_type carried (not defaulted to flat)');
    assert.equal(row.discount_value, 20, 'discount_value carried (not reset to 0)');
    assert.equal(row.max_discount, 200, 'max_discount carried');
    assert.equal(row.min_order_amount, 500, 'min_order_amount carried (not reset to 0)');
    assert.equal(row.coupon_code, 'WEEKEND25', 'the NEW code is used');
    assert.equal(row.per_customer_limit, 1, 'per_customer_limit carried');
    assert.equal(row.usage_limit, 100, 'usage_limit carried');
    assert.equal(row.store_id, 'store-1', 'store scope carried (not widened to all stores)');
    assert.equal(row.status, 'active', 'status carried (not reset to draft)');
    assert.equal(row.eligibility_type, 'all', 'eligibility carried');
    assert.equal(row.show_in_carousel, true, 'carousel flag carried');
    assert.equal(row.priority, 5, 'priority carried');
    assert.equal(row.exclude_first_hour_after_open, true, 'opening-hour exclusion carried');
  });

  test('an explicit override wins over the carried value', async () => {
    await CampaignService.supersede('campaign-1', { couponCode: 'weekend25', discountValue: 30 }, ADMIN);
    assert.equal(insertedRow().discount_value, 30, 'the requested new term is used');
  });

  test('the outgoing campaign is expired and linked to its replacement', async () => {
    await CampaignService.supersede('campaign-1', { couponCode: 'weekend25' }, ADMIN);
    const retire = findCall(/superseded_by = \$\d+/)!;
    assert.match(retire.text, /status = 'expired'/, 'old campaign is retired');
    assert.equal(retire.params[0], 'campaign-1', 'retires the right campaign');
    assert.ok(ran(/UPDATE mart_carousel_slides SET is_active = false/), 'old carousel slide is hidden');
  });

  test('superseding is itself recorded in the audit log', async () => {
    await CampaignService.supersede('campaign-1', { couponCode: 'weekend25' }, ADMIN);
    const audit = findCall(/INSERT INTO mart_campaign_changes/)!;
    assert.match(audit.text, /'superseded_by'/, 'the change is filed as a supersede');
    assert.equal(audit.params[0], 'campaign-1', 'logged against the old campaign');
    assert.equal(audit.params[1], 'WEEKEND20', 'old code recorded');
    assert.equal(audit.params[2], 'WEEKEND25', 'new code recorded');
  });

  test('a code already in use is refused before anything is written', async () => {
    couponClash = [{ id: 'campaign-other' }];
    await assert.rejects(
      () => CampaignService.supersede('campaign-1', { couponCode: 'TAKEN' }, ADMIN),
      /already in use/,
    );
    assert.ok(!ran(/^INSERT INTO mart_campaigns \(/), 'no replacement is created');
  });

  test('superseding an already-superseded campaign is refused', async () => {
    campaignRow = liveCampaign({ superseded_by: 'campaign-2' });
    await assert.rejects(
      () => CampaignService.supersede('campaign-1', { couponCode: 'weekend25' }, ADMIN),
      /already been superseded/,
    );
  });

  test('reusing the current code is refused', async () => {
    await assert.rejects(
      () => CampaignService.supersede('campaign-1', { couponCode: 'WEEKEND20' }, ADMIN),
      /must differ/,
    );
  });

  test('a missing new code is refused', async () => {
    await assert.rejects(
      () => CampaignService.supersede('campaign-1', {}, ADMIN),
      /new coupon code is required/,
    );
  });

  test('targeted audiences are copied to the replacement', async () => {
    campaignRow = liveCampaign({ eligibility_type: 'targeted_customers' });
    existingTargets = [{ customer_id: 'cust-1' }, { customer_id: 'cust-2' }];
    await CampaignService.supersede('campaign-1', { couponCode: 'weekend25' }, ADMIN);
    assert.equal(insertedRow().eligibility_type, 'targeted_customers', 'eligibility carried');
    const inserts = calls.filter(c => /INSERT INTO mart_campaign_targets/.test(c.text));
    assert.equal(inserts.length, 2, 'both existing targets are re-created');
    assert.deepEqual(inserts.map(i => i.params[1]).sort(), ['cust-1', 'cust-2']);
  });

  test('category scope is copied to the replacement', async () => {
    existingCategoryIds = [{ category_id: 'category-1' }, { category_id: 'category-2' }];
    await CampaignService.supersede('campaign-1', { couponCode: 'weekend25' }, ADMIN);
    const inserts = calls.filter(c => /INSERT INTO mart_campaign_categories/.test(c.text));
    assert.equal(inserts.length, 2, 'both existing categories are re-created');
    assert.deepEqual(inserts.map(i => i.params[1]).sort(), ['category-1', 'category-2']);
  });

  test('inactive-days eligibility keeps its threshold', async () => {
    campaignRow = liveCampaign({ eligibility_type: 'inactive_customers', inactive_days: 45 });
    await CampaignService.supersede('campaign-1', { couponCode: 'weekend25' }, ADMIN);
    const row = insertedRow();
    assert.equal(row.eligibility_type, 'inactive_customers', 'eligibility carried');
    assert.equal(row.inactive_days, 45, 'inactive_days carried');
  });

  test('a first-order campaign stays first-order', async () => {
    campaignRow = liveCampaign({ eligibility_type: 'first_order', new_customers_only: true });
    await CampaignService.supersede('campaign-1', { couponCode: 'weekend25' }, ADMIN);
    const row = insertedRow();
    assert.equal(row.eligibility_type, 'first_order', 'eligibility carried');
    assert.equal(row.new_customers_only, true, 'new_customers_only derived from eligibility');
  });

  test('a welcome offer remains available until its first use', async () => {
    campaignRow = liveCampaign({
      eligibility_type: 'first_order',
      new_customers_only: true,
      allow_redemption_until_used: true,
    });
    await CampaignService.supersede('campaign-1', { couponCode: 'welcome25' }, ADMIN);
    assert.equal(insertedRow().allow_redemption_until_used, true, 'welcome redemption policy carried');
  });

  test('welcome campaigns persist category scope without scheduled delivery', async () => {
    campaignRow = liveCampaign({ eligibility_type: 'first_order', requires_scheduled_delivery: false });
    await CampaignService.create({
      title: 'Welcome Offer',
      eligibilityType: 'first_order',
      discountType: 'flat',
      discountValue: 50,
      minOrderAmount: 0,
      perCustomerLimit: 1,
      categoryIds: ['category-1', 'category-2'],
    }, ADMIN);
    const inserts = calls.filter(c => /INSERT INTO mart_campaign_categories/.test(c.text));
    assert.deepEqual(inserts.map(i => i.params[1]).sort(), ['category-1', 'category-2']);
  });

  test('non-scoped campaigns ignore categoryIds on create', async () => {
    await CampaignService.create({
      title: 'Open Offer',
      eligibilityType: 'all',
      discountType: 'flat',
      discountValue: 50,
      minOrderAmount: 0,
      perCustomerLimit: 1,
      categoryIds: ['category-1'],
    }, ADMIN);
    assert.ok(!ran(/INSERT INTO mart_campaign_categories/), 'no scope is written for an unscoped campaign');
    assert.equal(insertedRow().requires_scheduled_delivery, false);
  });

  test('editing a welcome campaign replaces its category scope', async () => {
    campaignRow = liveCampaign({ eligibility_type: 'first_order', requires_scheduled_delivery: false, exclude_first_hour_after_open: false });
    await CampaignService.update('campaign-1', { title: 'Welcome Offer', categoryIds: ['category-3'] });
    assert.ok(ran(/DELETE FROM mart_campaign_categories/), 'old scope is cleared');
    const inserts = calls.filter(c => /INSERT INTO mart_campaign_categories/.test(c.text));
    assert.deepEqual(inserts.map(i => i.params[1]), ['category-3']);
  });

  test('editing away from welcome and scheduled delivery clears stale category scope', async () => {
    campaignRow = liveCampaign({ eligibility_type: 'all', requires_scheduled_delivery: false, exclude_first_hour_after_open: false });
    await CampaignService.update('campaign-1', { title: 'Open Offer' });
    assert.ok(ran(/DELETE FROM mart_campaign_categories/), 'stale scope is cleared');
    assert.ok(!ran(/INSERT INTO mart_campaign_categories/), 'no new scope is written');
  });

  test('category-scoped minimum uses only selected-category product value', async () => {
    publicCampaignRows = [liveCampaign({
      min_order_amount: 199,
      requires_scheduled_delivery: false,
      categoryIds: ['fresh-vegetables'],
      categoryNames: ['Fresh Vegetables'],
    })];
    const cartItems = [
      { categoryId: 'dairy', price: 100, quantity: 1 },
      { categoryId: 'fresh-vegetables', price: 60, quantity: 2 },
    ];
    const offers = await CampaignService.getPublicWelcomeOffers(220, 'store-1', null, null, cartItems);
    assert.equal(offers.length, 0, '₹120 of selected-category products does not meet ₹199 even though full cart is ₹220');

    publicCampaignRows = [liveCampaign({
      min_order_amount: 199,
      requires_scheduled_delivery: false,
      categoryIds: ['fresh-vegetables'],
      categoryNames: ['Fresh Vegetables'],
    })];
    const qualifyingItems = [
      { categoryId: 'dairy', price: 100, quantity: 1 },
      { categoryId: 'fresh-vegetables', price: 100, quantity: 2 },
    ];
    const qualifyingOffers = await CampaignService.getPublicWelcomeOffers(300, 'store-1', null, null, qualifyingItems);
    assert.equal(qualifyingOffers.length, 1, '₹200 of selected-category products meets ₹199 even though full cart is ₹300');
  });

  test('welcome teaser is still shown when there is no cart context', async () => {
    publicCampaignRows = [liveCampaign({
      min_order_amount: 199,
      requires_scheduled_delivery: false,
      categoryIds: ['fresh-vegetables'],
      categoryNames: ['Fresh Vegetables'],
    })];
    const teaser = await CampaignService.getPublicWelcomeOffers(0, '', null, null, []);
    assert.equal(teaser.length, 1, 'the post-login welcome step has no cart, so it must still advertise the offer');
  });

  test('validateCode explains why a matched coupon is not eligible', async () => {
    categoryScopeRows = [{ category_id: 'fresh-vegetables', name: 'Fresh Vegetables' }];
    campaignRow = liveCampaign({ min_order_amount: 0, store_id: 'store-1' });

    await assert.rejects(
      CampaignService.validateCode('WEEKEND20', null, 100, 'store-1', null, [{ categoryId: 'dairy', price: 100, quantity: 1 }]),
      /Add an item from Fresh Vegetables to use this coupon/,
    );

    campaignRow = liveCampaign({ min_order_amount: 199, store_id: 'store-1' });
    await assert.rejects(
      CampaignService.validateCode('WEEKEND20', null, 60, 'store-1', null, [{ categoryId: 'fresh-vegetables', price: 60, quantity: 1 }]),
      /Add ₹139 more in Fresh Vegetables to use this coupon \(minimum order ₹199 for these categories\)/,
    );
  });

  test('getEligible filters on scoped subtotal and keeps legacy no-context callers', async () => {
    publicCampaignRows = [liveCampaign({
      coupon_code: null,
      eligibility_type: 'all',
      min_order_amount: 100,
      categoryIds: ['cat-1'],
      categoryNames: ['Fresh Vegetables'],
    })];

    const legacy = await CampaignService.getEligible(null, 200, 'store-1', null, null);
    assert.equal(legacy.length, 1, 'callers without cart items keep the old unfiltered behaviour');

    const wrongCategory = await CampaignService.getEligible(null, 200, 'store-1', null, [
      { categoryId: 'dairy', price: 200, quantity: 1 },
    ]);
    assert.equal(wrongCategory.length, 0, 'value outside the selected categories does not qualify');

    const eligible = await CampaignService.getEligible(null, 200, 'store-1', null, [
      { categoryId: 'cat-1', price: 100, quantity: 1 },
    ]);
    assert.equal(eligible.length, 1, 'value inside the selected categories qualifies');
  });

  test('welcome offers are sliced after scoped filtering', async () => {
    publicCampaignRows = Array.from({ length: 5 }, (_, index) => liveCampaign({
      id: `fail-${index}`,
      coupon_code: `FAIL${index}`,
      eligibility_type: 'all',
      min_order_amount: 100,
      categoryIds: ['wrong-category'],
      categoryNames: ['Dairy'],
      priority: 10 - index,
    })).concat(liveCampaign({
      id: 'pass',
      coupon_code: 'PASS',
      eligibility_type: 'all',
      min_order_amount: 100,
      categoryIds: ['cat-1'],
      categoryNames: ['Fresh Vegetables'],
      priority: 0,
    }));

    const offers = await CampaignService.getPublicWelcomeOffers(200, 'store-1', null, null, [
      { categoryId: 'cat-1', price: 100, quantity: 1 },
    ]);
    assert.deepEqual(offers.map((offer: Row) => offer.coupon_code), ['PASS']);

    const legacy = await CampaignService.getPublicWelcomeOffers(200, 'store-1', null, null, null);
    assert.equal(legacy.length, 5, 'legacy callers still receive the five highest-priority offers');
  });

  test('validateCode keeps legacy callers working without cart items', async () => {
    categoryScopeRows = [{ category_id: 'cat-1', name: 'Fresh Vegetables' }];
    campaignRow = liveCampaign({ min_order_amount: 100, eligibility_type: 'all' });
    const campaign = await CampaignService.validateCode('WEEKEND20', null, 200, 'store-1', null, null);
    assert.equal(campaign.categorySubtotal, 200);
  });

  test('calculateDiscount caps discounts by the scoped subtotal', () => {
    assert.equal(CampaignService.calculateDiscount({
      discount_type: 'flat', discount_value: 50, categorySubtotal: 20,
    }, 200), 20);
    assert.equal(CampaignService.calculateDiscount({
      discount_type: 'percent', discount_value: 50, categorySubtotal: 20,
    }, 200), 10);
    assert.equal(CampaignService.calculateDiscount({
      discount_type: 'percent', discount_value: 50,
    }, 200), 100, 'unscoped campaigns still use the cart total');
  });

  test('welcome category scope is wired through the hub and customer apps', () => {
    const hub = readFileSync(join(__dirname, '..', '..', 'mart-hub', 'src', 'pages', 'CampaignsPage.tsx'), 'utf8');
    assert.match(hub, /const canScopeCategories\s*=\s*form\.requiresScheduledDelivery \|\| form\.eligibilityType === 'first_order'/);
    assert.ok(hub.includes('categoryIds: canScopeCategories ? form.categoryIds : []'));
    assert.ok(hub.includes('{canScopeCategories && ('));

    const customer = readFileSync(join(__dirname, '..', '..', 'mart-user', 'src', 'pages', 'CheckoutPage.tsx'), 'utf8');
    assert.ok(customer.includes('{categoryNames.length > 0 && ('));
    assert.ok(customer.includes('eligible item'));
    assert.ok(customer.includes('const campaignMinimumSubtotal = appliedCampaign ? scopedSubtotal(appliedCampaign, sub) : sub;'));
    assert.ok(customer.includes('offerMinimumShortfall'), 'the unlock notice uses the shortfall reported by the server');
    assert.match(customer, /\{notice\s*&&\s*!codeError\s*&&\s*\(/,
      'the unlock notice is shown alongside the coupon code field even when no offers survive the filter');
    assert.ok(customer.includes('categoryNames?.length ? ` in ${categoryNames.join(\', \')}`'), 'the notice names the eligible categories');
    assert.ok(customer.includes('useState<string[] | null>(null)'), 'an unknown category scope keeps the server shortfall');
    assert.ok(customer.includes('offerMinimumSubtotal === null || offerMinimumCategoryIds === null'),
      'the live shortfall recompute is skipped when the rejected coupon is filtered out of the offer list');
    assert.ok(customer.includes('const scopedIds = scopedCampaign ? campaignCategoryIds(scopedCampaign) : null;'),
      'a failed code with no matching campaign does not fall back to the full-cart minimum');

    const campaignService = readFileSync(join(__dirname, '..', '..', 'mart-backend', 'src', 'services', 'campaign.service.ts'), 'utf8');
    assert.match(campaignService, /campaign\.categorySubtotal = cartItems === null \? cartTotal : scopedCartSubtotal/);
    const orderService = readFileSync(join(__dirname, '..', '..', 'mart-backend', 'src', 'services', 'order.service.ts'), 'utf8');
    assert.match(orderService, /const minOrderMet = campaign\.categorySubtotal >= Number\(campaign\.min_order_amount\)/);
    assert.match(orderService, /more\$\{scope\} to use this coupon/, 'the order recheck names the eligible categories too');
  });
});
