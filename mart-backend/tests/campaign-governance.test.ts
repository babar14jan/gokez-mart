/**
 * Campaign live-editing governance tests (migration 053).
 *
 * Covers the behaviour that replaced the old "cannot edit after redemption"
 * block: commercial terms are editable on a running campaign, each change is
 * audited, the published coupon code is superseded rather than mutated, a
 * raised minimum order grandfathers carts already in progress, and a reversed
 * redemption no longer counts as a use.
 *
 * Harness matches tests/security.test.ts — Node's `node:test` via `tsx`, with
 * `pg.Pool.prototype.connect` stubbed so the real service code runs against
 * scripted rows and the real SQL is captured for assertion.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

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
      if (/SELECT id FROM mart_campaigns WHERE coupon_code/.test(text)) {
        return { rows: couponClash };
      }
      if (/SELECT \* FROM mart_campaigns WHERE id/.test(text)) {
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
  eligibility_type: 'all', inactive_days: null, priority: 5,
  superseded_by: null, superseded_at: null,
  min_order_previous: null, min_order_grace_until: null,
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

// ── Grandfathering a raised minimum order ────────────────────────────────────
describe('raising the minimum order grandfathers carts in progress', () => {
  test('a raise records the previous threshold and a grace deadline', async () => {
    await CampaignService.update('campaign-1', { minOrderAmount: 800 });
    const update = findCall(/^UPDATE mart_campaigns SET/)!;
    const sql = update.text;
    assert.match(sql, /min_order_previous = \$\d+/, 'previous threshold is persisted');
    assert.match(sql, /min_order_grace_until = \$\d+/, 'grace deadline is persisted');
    const graceIdx = [...sql.matchAll(/min_order_previous = \$(\d+)/g)][0][1];
    assert.equal(update.params[Number(graceIdx) - 1], 500, 'carries the old 500 threshold');
  });

  test('the grace window is six hours', async () => {
    await CampaignService.update('campaign-1', { minOrderAmount: 800 });
    const update = findCall(/^UPDATE mart_campaigns SET/)!;
    const sql = update.text;
    const prevIdx = Number([...sql.matchAll(/min_order_previous = \$(\d+)/g)][0][1]);
    const graceIdx = Number([...sql.matchAll(/min_order_grace_until = \$(\d+)/g)][0][1]);
    const grace = update.params[graceIdx - 1] as Date;
    const hours = (grace.getTime() - Date.now()) / 3_600_000;
    assert.ok(hours > 5.9 && hours <= 6, `grace is ~6h, got ${hours.toFixed(2)}h`);
    assert.notEqual(update.params[prevIdx - 1], grace, 'previous threshold is stored separately');
  });

  test('lowering the minimum order opens no grace window', async () => {
    await CampaignService.update('campaign-1', { minOrderAmount: 200 });
    const update = findCall(/^UPDATE mart_campaigns SET/)!;
    assert.ok(!/min_order_grace_until/.test(update.text), 'no grace when the bar is lowered');
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
});
