/**
 * Code-review follow-ups for the hub order reports: one canonical store scope
 * shared by the list/counts and analytics, validated report windows, partial
 * UUID search, and a payment breakdown that covers every delivered order.
 */

import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'report-window-test-secret';

const require = createRequire(__filename);
const read = (rel: string) => require('fs').readFileSync(require('path').join(__dirname, '..', rel), 'utf8');

interface Call { text: string; params: unknown[] }
const calls: Call[] = [];
let summaryRow: Record<string, unknown> = {};
let rowsFor: ((text: string) => any[]) | null = null;

const pg = require('pg');
(pg.Pool.prototype as any).connect = async function () {
  return {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return { rows: rowsFor ? rowsFor(text) : /FROM mart_orders o/.test(text) ? [summaryRow] : [] };
    },
    release: () => undefined,
    end: async () => undefined,
  };
};

const { buildOrderWindow, OrderService } = require('../src/services/order.service');

const storeId = '00000000-0000-0000-0000-000000000001';
const zoneStoreId = '00000000-0000-0000-0000-000000000002';
const fulfilmentPredicate = /mart_order_store_fulfilments f[\s\S]*?f\.store_id = ANY\(\$\d+::uuid\[\]\)/;

beforeEach(() => {
  calls.length = 0;
  summaryRow = {};
  rowsFor = null;
});

describe('Canonical store scope and report windows', () => {
  test('buildOrderWindow refuses a custom range without both bounds', () => {
    assert.throws(() => buildOrderWindow('custom', undefined, undefined), (err: any) => err.status === 400);
    assert.throws(() => buildOrderWindow('custom', '2026-11-01', undefined), (err: any) => err.status === 400);
    assert.throws(() => buildOrderWindow('custom', undefined, '2026-11-02'), (err: any) => err.status === 400);
  });

  test('the fulfilment branch reuses one uuid[] placeholder', () => {
    const scoped = buildOrderWindow('all', undefined, undefined, [storeId, zoneStoreId], {
      includeFulfilmentStores: true,
      startIndex: 3,
    });
    assert.match(scoped.clause, fulfilmentPredicate);
    assert.equal((scoped.clause.match(/\$3::uuid\[\]/g) || []).length, 2);
    assert.equal(scoped.params.length, 1);
    assert.deepEqual(scoped.params[0], [storeId, zoneStoreId]);
    assert.ok(!scoped.clause.includes('$4'));
    assert.ok(!scoped.clause.includes('viewerStoreId'));

    const plain = buildOrderWindow('all', undefined, undefined, [storeId], { startIndex: 3 });
    assert.ok(plain.clause.includes('o.store_id = ANY($3::uuid[])'));
    assert.ok(!plain.clause.includes('mart_order_store_fulfilments'));
  });

  test('every hub order report goes through the shared window helper and canonical scope', () => {
    const controller = read('src/controllers/index.ts');
    for (const handler of [
      'adminGetOrders', 'adminGetAnalyticsSummary', 'adminGetCustomerAggregates',
      'adminGetTopSellingProducts', 'adminGetOrderInsights', 'adminGetProductLeaders',
    ]) {
      const body = controller.slice(controller.indexOf(`export const ${handler} =`));
      assert.ok(body.slice(0, 1400).includes('reportWindowParams('), `${handler} must use the shared window helper`);
    }
    assert.match(controller, /new Set\(\['today', 'yesterday', '5d', '7d', '10d', '30d', 'last_month', 'all', 'custom'\]\)/);
    assert.match(controller, /if \(range === 'custom' && !isValidReportDateRange\(from, to\)\)/);
    assert.match(controller, /if \(range === 'yesterday'\) \{ from = istDayKey\(-1\); to = from; range = 'custom'; \}/);
    assert.match(controller, /dateBasis: req\.query\.dateBasis === 'created' \? 'created' as const : 'browse' as const/);
    const orders = controller.slice(
      controller.indexOf('export const adminGetOrders ='),
      controller.indexOf('export const adminLookupRestorableOrder'),
    );
    assert.ok(orders.includes('getAnalyticsStoreIds(resolveStoreId(req))'));
    assert.ok(orders.includes('includeFulfilmentStores: true'));
    assert.ok(orders.includes('canManageMaster'));
    assert.equal((controller.match(/includeFulfilmentStores: true/g) || []).length >= 6, true);
  });

  test('partial UUIDs use the same wildcard term and the viewer predicate is gone', () => {
    const service = read('src/services/order.service.ts');
    assert.ok(service.includes('o.id::text ILIKE $${i + 1}'));
    assert.ok(!service.includes('o.id::text = $${i + 1}'));
    assert.ok(service.includes('params.push(pattern, pattern);'));
    assert.ok(service.includes('regexp_replace(o.guest_phone'));
    assert.ok(service.includes('const isMemberView = Boolean(filters?.restrictItems && viewerStoreId'));
    assert.ok(!service.includes('if (filters?.viewerStoreId) {\n      conditions.push'));
  });
});

describe('Delivered-order payment breakdown', () => {
  test('summary SQL buckets null, blank and legacy methods as unknown', async () => {
    summaryRow = {
      placed: 3, delivered: 3, revenue: 300, delivered_revenue: 300,
      cod_count: 1, cod_revenue: 100,
      upi_count: 1, upi_revenue: 100,
      phonepay_count: 0, phonepay_revenue: 0,
      unknown_count: 1, unknown_revenue: 100,
    };
    const summary = await OrderService.getSummary('all', undefined, undefined, [storeId], {
      dateBasis: 'browse',
      includeFulfilmentStores: true,
    });

    const sql = calls[0].text;
    assert.match(sql, /CASE LOWER\(TRIM\(COALESCE\(o\.payment_method, ''\)\)\)/);
    assert.match(sql, /ELSE 'unknown'\s*END/);
    assert.ok(sql.includes("= 'unknown')::int AS unknown_count"));
    assert.ok(sql.includes("= 'unknown'), 0)::float AS unknown_revenue"));
    assert.match(sql, fulfilmentPredicate);
    assert.deepEqual(calls[0].params, [[storeId]]);

    assert.equal(summary.revenue, 300);
    assert.deepEqual(summary.paymentBreakdown.map((bucket: any) => bucket.method), ['cod', 'upi', 'phonepay', 'unknown']);
    assert.equal(summary.paymentBreakdown.reduce((sum: number, bucket: any) => sum + bucket.count, 0), summary.delivered);
    assert.equal(summary.paymentBreakdown.reduce((sum: number, bucket: any) => sum + bucket.revenue, 0), summary.revenue);
  });

  test('unknown bucket is always present even with no rows', async () => {
    const summary = await OrderService.getSummary('all');
    assert.deepEqual(summary.paymentBreakdown, [
      { method: 'cod', count: 0, revenue: 0 },
      { method: 'upi', count: 0, revenue: 0 },
      { method: 'phonepay', count: 0, revenue: 0 },
      { method: 'unknown', count: 0, revenue: 0 },
    ]);
  });
});

describe('Dashboard KPI aggregates are not capped by the order list', () => {
  test('scheduled value and coupon totals are server-side sums over every scheduled order', async () => {
    summaryRow = { scheduled_value: 4567, scheduled_coupon_amount: 123 };
    const summary = await OrderService.getSummary('all', undefined, undefined, [storeId], {
      dateBasis: 'browse',
      includeFulfilmentStores: true,
      activeScheduled: true,
    });

    const sql = calls[0].text;
    assert.ok(sql.includes("o.delivery_preference = 'scheduled'"));
    assert.ok(sql.includes('AS scheduled_value'));
    assert.ok(sql.includes('AS scheduled_coupon_amount'));
    assert.ok(!/LIMIT\s+\$/i.test(sql));
    assert.ok(!/OFFSET\s+\$/i.test(sql));
    assert.deepEqual(calls[0].params, [[storeId]]);
    assert.equal(summary.scheduledValue, 4567);
    assert.equal(summary.scheduledCouponAmount, 123);
  });

  test('new and repeat totals count every customer; top-N only limits the top list', async () => {
    rowsFor = text => text.includes('FROM active_customers')
      ? [{ total: 120, new_customers: 40, repeat_customers: 80, delivered_orders: 300 }]
      : [];
    const agg = await OrderService.getCustomerAggregates('all', undefined, undefined, [storeId], 10, {
      dateBasis: 'browse',
      includeFulfilmentStores: true,
      activeScheduled: true,
    });

    const totalsSql = calls[0].text;
    const topSql = calls[1].text;
    assert.ok(totalsSql.includes("o.delivery_preference = 'scheduled'"));
    assert.ok(totalsSql.includes('s.activity_at > f.first_delivered_at'));
    assert.ok(!/LIMIT\s+\$/i.test(totalsSql));
    assert.ok(!/OFFSET\s+\$/i.test(totalsSql));
    assert.match(topSql, /LIMIT \$2/);
    assert.deepEqual(calls[0].params, [[storeId], [storeId]]);
    assert.deepEqual(calls[1].params, [[storeId], 10]);

    assert.equal(agg.totalCustomers, 120);
    assert.equal(agg.newCustomers, 40);
    assert.equal(agg.repeatCustomers, 80);
    assert.deepEqual(agg.top, []);
  });
});
