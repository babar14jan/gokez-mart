/**
 * Category slugs are stable keys used by storefront links and Home/Fresh
 * configs, so the admin cannot save an ambiguous key or reuse one.
 *
 * Harness matches tests/homeSections.test.ts: `pg.Pool.prototype.connect` is
 * stubbed so the real service SQL is captured.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'category-slug-test-secret';

const require = createRequire(__filename);

interface Call { text: string; params: unknown[] }

const calls: Call[] = [];
let duplicate = false;

const pg = require('pg');
(pg.Pool.prototype as any).connect = async function () {
  return {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/SELECT 1 FROM mart_categories WHERE LOWER\(slug\) = \$1/.test(text)) {
        return { rows: duplicate ? [{ '?column?': 1 }] : [] };
      }
      if (/INSERT INTO mart_categories/.test(text)) {
        return { rows: [{ id: 'c1', name: params[1], slug: params[2], productPrefix: params[3] }] };
      }
      if (/UPDATE mart_categories/.test(text)) {
        return { rows: [{ id: 'c1', name: 'Leafy Greens', slug: 'leafy-greens' }] };
      }
      return { rows: [] };
    },
    release: () => undefined,
    end: async () => undefined,
  };
};

const { CategoryService, normalizeCategorySlug } = require('../src/services/category.service');

beforeEach(() => { calls.length = 0; duplicate = false; });

describe('category slug validation', () => {
  test('accepts lowercase words joined by single hyphens', () => {
    assert.equal(normalizeCategorySlug('leafy-greens'), 'leafy-greens');
    assert.equal(normalizeCategorySlug('  Leafy-Greens  '), 'leafy-greens');
    assert.equal(normalizeCategorySlug('veg2'), 'veg2');
  });

  test('rejects underscores, spaces and leading/trailing hyphens', () => {
    for (const bad of ['leafy_greens', 'leafy greens', '-leafy', 'leafy-', 'leafy--greens', 'leafy/greens']) {
      assert.throws(() => normalizeCategorySlug(bad), /slug/i, bad);
    }
    assert.throws(() => normalizeCategorySlug('   '), /required/i);
  });

  test('create lowercases the slug before inserting', async () => {
    await CategoryService.create({ name: 'Leafy Greens', slug: 'Leafy-Greens', productPrefix: 'LEAF' });
    const insert = calls.find(call => /INSERT INTO mart_categories/.test(call.text))!;
    assert.equal(insert.params[2], 'leafy-greens');
  });

  test('create refuses a slug another category already uses', async () => {
    duplicate = true;
    await assert.rejects(
      () => CategoryService.create({ name: 'Leafy Greens', slug: 'leafy-greens', productPrefix: 'LEAF' }),
      /already used/,
    );
    assert.equal(calls.some(call => /INSERT INTO mart_categories/.test(call.text)), false);
  });

  test('update refuses a duplicate and excludes the category being edited', async () => {
    duplicate = true;
    await assert.rejects(
      () => CategoryService.update('c1', { slug: 'leafy-greens' }),
      /already used/,
    );
    const check = calls.find(call => /LOWER\(slug\)/.test(call.text))!;
    assert.deepEqual(check.params, ['leafy-greens', 'c1']);
  });

  test('update normalises the slug before saving', async () => {
    await CategoryService.update('c1', { slug: 'Leafy-Greens' });
    const update = calls.find(call => /UPDATE mart_categories/.test(call.text))!;
    assert.ok(update.params.includes('leafy-greens'));
  });
});
