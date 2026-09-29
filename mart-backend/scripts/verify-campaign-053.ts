/**
 * DB-backed verification for the migration-053 work.
 *
 * The stub suite in tests/campaign-governance.test.ts proves the service
 * logic; it cannot prove the SQL actually binds. This script runs the real
 * queries against a disposable database built by the full 001..053 chain.
 *
 * Not part of `npm test` — it requires a provisioned database. Run with:
 *   DATABASE_URL=postgresql://<user>@localhost:5432/mart_chain \
 *     node --import tsx scripts/verify-campaign-053.ts
 */
import { query } from '../src/database/db';
import { CampaignService } from '../src/services/campaign.service';

const results: string[] = [];
const check = (name: string, pass: boolean, detail = '') => {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) process.exitCode = 1;
};

const run = async () => {
  // Clear residue from any earlier aborted run so this script is re-runnable.
  await query(
    `DELETE FROM mart_campaign_changes ch USING mart_campaigns c
       WHERE ch.campaign_id = c.id AND c.coupon_code IN ('LIVE20','LIVE25','GOV20','GOV25')`,
  );
  await query(
    `DELETE FROM mart_campaign_uses cu USING mart_campaigns c
       WHERE cu.campaign_id = c.id AND c.coupon_code IN ('LIVE20','LIVE25','GOV20','GOV25')`,
  );
  await query(
    `DELETE FROM mart_campaigns WHERE coupon_code IN ('LIVE20','LIVE25','GOV20','GOV25')`,
  );
  await query(`DELETE FROM mart_orders WHERE order_number = 'GOV-1'`);
  await query(`DELETE FROM mart_customers WHERE phone = '9000000001'`);
  await query(`DELETE FROM mart_admins WHERE username = 'gov_audit'`);
  await query(`DELETE FROM mart_stores WHERE name = 'Gov Store'`);

  const admin = (await query(
    `INSERT INTO mart_admins (username, password_hash, name, role, is_active)
     VALUES ('gov_audit', 'x', 'Gov Audit', 'super_admin', true)
     ON CONFLICT (username) DO UPDATE SET name = 'Gov Audit'
     RETURNING id`,
  )).rows[0];

  const store = (await query(
    `INSERT INTO mart_stores (name, address, is_active) VALUES ('Gov Store', 'Test', true) RETURNING id`,
  )).rows[0];

  const customer = (await query(
    `INSERT INTO mart_customers (phone, name) VALUES ('9000000001', 'Asha Rao') RETURNING id`,
  )).rows[0];

  const campaign = (await query(
    `INSERT INTO mart_campaigns (
       title, discount_type, discount_value, min_order_amount, coupon_code,
       per_customer_limit, store_id, status, eligibility_type
     ) VALUES ('Live Offer', 'percent', 20, 500, 'LIVE20', 1, $1, 'active', 'all')
     RETURNING *`,
    [store.id],
  )).rows[0];

  // ── 1. terms_snapshot binds correctly on the real table ──────────────────
  const order = (await query(
    `INSERT INTO mart_orders (order_number, customer_id, guest_name, guest_phone, guest_address,
                              subtotal, discount_amount, total, payment_method, status, store_id)
     VALUES ('GOV-1', $1, 'Asha Rao', '9000000001', '1 Test Lane', 1000, 200, 800, 'cod', 'confirmed', $2)
     RETURNING id`,
    [customer.id, store.id],
  )).rows[0];

  // Mirrors the exact INSERT issued by order.service at redemption time.
  await query(
    `INSERT INTO mart_campaign_uses (campaign_id, customer_id, order_id, discount_applied, coupon_code_used, terms_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [campaign.id, customer.id, order.id, 200, 'LIVE20',
     JSON.stringify({
       discount_type: campaign.discount_type, discount_value: campaign.discount_value,
       min_order_amount: campaign.min_order_amount, per_customer_limit: campaign.per_customer_limit,
       coupon_code: campaign.coupon_code,
     })],
  );

  const snap = (await query(
    `SELECT terms_snapshot->>'discount_value' AS dv,
            terms_snapshot->>'min_order_amount' AS mo,
            terms_snapshot->>'coupon_code' AS code
     FROM mart_campaign_uses WHERE campaign_id = $1`,
    [campaign.id],
  )).rows[0];
  check('terms_snapshot round-trips through jsonb',
    Number(snap?.dv) === 20 && Number(snap?.mo) === 500 && snap?.code === 'LIVE20',
    `discount=${snap?.dv} min=${snap?.mo} code=${snap?.code}`);

  // ── 2. editing a live, redeemed campaign is permitted ───────────────────
  const before = (await query(`SELECT discount_value, min_order_previous FROM mart_campaigns WHERE id = $1`, [campaign.id])).rows[0];
  await CampaignService.update(campaign.id, { minOrderAmount: 800, adminId: admin.id, changeReason: 'uplift' });
  const after = (await query(
    `SELECT min_order_amount, min_order_previous, min_order_grace_until, updated_at > $2 AS bumped
     FROM mart_campaigns WHERE id = $1`, [campaign.id, before.updated_at ?? '1970-01-01'],
  )).rows[0];
  check('raising the minimum order writes previous + grace',
    Number(after.min_order_amount) === 800 && Number(after.min_order_previous) === 500,
    `min=${after.min_order_amount} previous=${after.min_order_previous}`);
  check('grace deadline is ~6h in the future',
    after.min_order_grace_until instanceof Date
      && Math.abs((after.min_order_grace_until.getTime() - Date.now()) / 3_600_000 - 6) < 0.1,
    String(after.min_order_grace_until));

  // ── 3. audit rows were written with the right shape ─────────────────────
  const audit = (await query(
    `SELECT field, old_value, new_value, reason, changed_by FROM mart_campaign_changes
     WHERE campaign_id = $1 ORDER BY created_at`, [campaign.id],
  )).rows;
  check('audit row written for the changed field',
    audit.length === 1 && audit[0].field === 'min_order_amount'
      && Number(audit[0].old_value) === 500 && Number(audit[0].new_value) === 800,
    JSON.stringify(audit[0] || {}));
  check('audit old/new values are on the same scale (500 → 800, not 500.00 → 800)',
    audit[0]?.old_value === '500' && audit[0]?.new_value === '800',
    `old=${audit[0]?.old_value} new=${audit[0]?.new_value}`);
  check('audit records the acting admin', audit[0]?.changed_by === admin.id);
  check('audit records the reason', audit[0]?.reason === 'uplift');

  // ── 5. getRedemptions runs for real and separates reversed uses ─────────
  const stats1 = await CampaignService.getRedemptions(campaign.id);
  check('stats report 1 active use', Number(stats1.stats.total_uses) === 1, JSON.stringify(stats1.stats));
  check('redemption row joins the customer and order',
    stats1.redemptions.length === 1 && stats1.redemptions[0].customer_name === 'Asha Rao'
      && stats1.redemptions[0].order_id === order.id,
    JSON.stringify(stats1.redemptions[0] || {}));
  check('redemption reports the snapshotted terms',
    Number(stats1.redemptions[0]?.terms_snapshot?.min_order_amount) === 500,
    `snapshot min_order_amount=${stats1.redemptions[0]?.terms_snapshot?.min_order_amount} (must stay 500, not the edited 800)`);

  // Reverse it and re-check.
  await query(`UPDATE mart_campaign_uses SET reversed_at = NOW(), reversal_reason = 'test reversal' WHERE campaign_id = $1`, [campaign.id]);
  const stats2 = await CampaignService.getRedemptions(campaign.id);
  check('reversed use is excluded from active totals',
    Number(stats2.stats.total_uses) === 0 && Number(stats2.stats.reversed_uses) === 1,
    JSON.stringify(stats2.stats));
  check('reversed use is still listed with its snapshot',
    stats2.redemptions.length === 1 && stats2.redemptions[0].reversed_at !== null);

  // ── 6. a reversed-only campaign can now be edited (the original bug) ───
  let edited = true;
  try { await CampaignService.update(campaign.id, { discountValue: 25 }); }
  catch (e) { edited = false; }
  check('campaign with only reversed uses is editable', edited);

  // ── 7. the coupon code is still immutable ──────────────────────────────
  let codeBlocked = false;
  try { await CampaignService.update(campaign.id, { couponCode: 'HACK50' }); }
  catch (e) { codeBlocked = /cannot be changed/i.test((e as Error).message); }
  check('coupon code change is refused', codeBlocked);
  const codeNow = (await query(`SELECT coupon_code FROM mart_campaigns WHERE id = $1`, [campaign.id])).rows[0];
  check('coupon code unchanged in the database', codeNow.coupon_code === 'LIVE20', codeNow.coupon_code);

  // ── 8. supersede carries the live terms to a new version ───────────────
  const replacement = await CampaignService.supersede(campaign.id, { couponCode: 'live25' }, admin.id);
  const fresh = (await query(`SELECT * FROM mart_campaigns WHERE id = $1`, [replacement.id])).rows[0];
  check('replacement keeps the discount value', Number(fresh.discount_value) === 25, String(fresh.discount_value));
  check('replacement keeps the raised minimum', Number(fresh.min_order_amount) === 800, String(fresh.min_order_amount));
  check('replacement keeps the store scope', fresh.store_id === store.id);
  check('replacement keeps the active status', fresh.status === 'active', fresh.status);
  check('replacement has the new code', fresh.coupon_code === 'LIVE25', fresh.coupon_code);
  check('replacement starts with no grace inherited', fresh.min_order_previous === null);

  const old = (await query(`SELECT status, superseded_by FROM mart_campaigns WHERE id = $1`, [campaign.id])).rows[0];
  check('old campaign is expired and linked', old.status === 'expired' && old.superseded_by === replacement.id);

  // ── 9. cleanup so repeat runs stay clean ───────────────────────────────
  await query(`DELETE FROM mart_campaign_changes WHERE campaign_id = ANY($1)`, [[campaign.id, replacement.id]]);
  await query(`DELETE FROM mart_campaign_uses WHERE campaign_id = ANY($1)`, [[campaign.id, replacement.id]]);
  await query(`DELETE FROM mart_campaign_targets WHERE campaign_id = ANY($1)`, [[campaign.id, replacement.id]]);
  await query(`DELETE FROM mart_carousel_slides WHERE campaign_id = ANY($1)`, [[campaign.id, replacement.id]]);
  await query(`DELETE FROM mart_campaigns WHERE id = ANY($1)`, [[campaign.id, replacement.id]]);
  await query(`DELETE FROM mart_orders WHERE id = $1`, [order.id]);
  await query(`DELETE FROM mart_customers WHERE id = $1`, [customer.id]);
  await query(`DELETE FROM mart_admins WHERE id = $1`, [admin.id]);
  await query(`DELETE FROM mart_stores WHERE id = $1`, [store.id]);

  console.log(results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
};

run().catch(e => { console.error('ERROR', e); process.exit(1); });
