import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'promotion-audience-rules-test-secret';

const require = createRequire(__filename);
const pg = require('pg');
let databaseRows: unknown[] = [];
let lastQuery: { text: string; params?: unknown[] } | null = null;
(pg.Pool.prototype as any).connect = async () => ({
  query: async (text: string, params?: unknown[]) => {
    lastQuery = { text, params };
    return { rows: databaseRows };
  },
  release: () => undefined,
});

const { PromotionService, isPromotionQuietHours, isSafePromotionDestination, matchesAudienceCohorts, normalizeAudienceRules, normalizePromotionInput, parsePromotionSchedule } = require('../src/services/promotion.service');

describe('promotion audience rules', () => {
  test('defaults to the broad consented audience', () => {
    assert.deepEqual(normalizeAudienceRules(undefined), { cohorts: [] });
    assert.deepEqual(normalizeAudienceRules({}), { cohorts: [] });
  });

  test('accepts supported cohorts once in their selected order', () => {
    assert.deepEqual(normalizeAudienceRules({ cohorts: ['winback_15', 'repeat_buyer', 'winback_15'] }), {
      cohorts: ['winback_15', 'repeat_buyer'],
    });
  });

  test('rejects malformed or unsupported targeting payloads', () => {
    assert.throws(() => normalizeAudienceRules(null), /Audience rules/);
    assert.throws(() => normalizeAudienceRules({ cohorts: 'winback_7' }), /Audience cohorts/);
    assert.throws(() => normalizeAudienceRules({ cohorts: ['everyone'] }), /Audience cohorts/);
  });

  test('uses exact non-overlapping delivery cohort boundaries', () => {
    const now = new Date('2026-11-02T12:00:00.000Z');
    const deliveredAt = (daysAgo: number) => new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const stats = (daysAgo: number, deliveredOrders = 2) => ({ deliveredOrders, lastDeliveredAt: deliveredAt(daysAgo) });

    assert.equal(matchesAudienceCohorts(['recent_purchaser'], stats(3), now), true);
    assert.equal(matchesAudienceCohorts(['recent_purchaser'], stats(7), now), false);
    assert.equal(matchesAudienceCohorts(['winback_7'], stats(7), now), true);
    assert.equal(matchesAudienceCohorts(['winback_7'], stats(14), now), false);
    assert.equal(matchesAudienceCohorts(['winback_15'], stats(14), now), true);
    assert.equal(matchesAudienceCohorts(['winback_15'], stats(30), now), false);
    assert.equal(matchesAudienceCohorts(['winback_30'], stats(30), now), true);
    assert.equal(matchesAudienceCohorts(['first_order_followup'], stats(7, 1), now), true);
    assert.equal(matchesAudienceCohorts(['first_order_followup'], stats(7, 2), now), false);
    assert.equal(matchesAudienceCohorts(['repeat_buyer'], stats(1, 3), now), true);
  });

  test('parses bare scheduled times as Asia/Kolkata and identifies quiet hours', () => {
    assert.equal(parsePromotionSchedule('2026-11-02T09:00')?.toISOString(), '2026-11-02T03:30:00.000Z');
    assert.equal(isPromotionQuietHours(new Date('2026-11-02T03:29:00.000Z')), true);
    assert.equal(isPromotionQuietHours(new Date('2026-11-02T03:30:00.000Z')), false);
    assert.equal(isPromotionQuietHours(new Date('2026-11-02T15:29:00.000Z')), false);
    assert.equal(isPromotionQuietHours(new Date('2026-11-02T15:30:00.000Z')), true);
  });

  test('preserves explicit null values in partial promotion updates', () => {
    assert.deepEqual(normalizePromotionInput({ imageUrl: null, zoneIds: null, scheduledAt: null }, true), {
      imageUrl: null, zoneIds: null, scheduledAt: null,
    });
    assert.deepEqual(normalizePromotionInput({ image_url: null, zone_ids: null, scheduled_at: null }, true), {
      imageUrl: null, zoneIds: null, scheduledAt: null,
    });
  });

  test('only permits root-relative promotion redirect destinations', () => {
    assert.equal(isSafePromotionDestination('/products?category=deals'), true);
    assert.equal(isSafePromotionDestination('//example.com'), false);
    assert.equal(isSafePromotionDestination('/\\example.com'), false);
    assert.equal(isSafePromotionDestination('https://example.com'), false);
  });

  test('tracks sent promotion clicks and resolves only to the customer frontend', async () => {
    databaseRows = [{ destination_url: '/products?category=deals' }];
    const destination = await PromotionService.registerClick('promotion-id');

    assert.equal(destination, 'http://localhost:5177/products?category=deals');
    assert.match(lastQuery?.text || '', /SET click_count = click_count \+ 1/);
    assert.deepEqual(lastQuery?.params, ['promotion-id']);

    databaseRows = [{ destination_url: 'https://example.com' }];
    assert.equal(await PromotionService.registerClick('promotion-id'), null);
  });
});