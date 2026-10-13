/**
 * Configurable homepage sections.
 *
 * Locks down three things that are easy to break silently:
 *   1. The storefront is only ever handed enabled sections, resolved for the
 *      requested store — never another store's layout.
 *   2. Section input is normalised to the one shape the storefront understands,
 *      so a malformed admin payload cannot smuggle extra fields (or a non-slug
 *      category) into `config`.
 *   3. The public read route stays unauthenticated while the write routes stay
 *      role-guarded, and migration 079 actually seeds the two default sections.
 *
 * Harness matches tests/funnel.test.ts: Node's `node:test` via `tsx`, with
 * `pg.Pool.prototype.connect` stubbed so the real service SQL is captured.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'home-sections-test-secret';

const require = createRequire(__filename);

interface Call { text: string; params: unknown[] }

const calls: Call[] = [];

const pg = require('pg');
(pg.Pool.prototype as any).connect = async function () {
  return {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/SELECT COALESCE\(MAX\(sort_order\)/.test(text)) return { rows: [{ next: 3 }] };
      if (/INSERT INTO mart_home_sections/.test(text)) {
        return { rows: [{
          id: 'sec-1', storeId: 'store-1', sectionKey: 'todays_combos',
          title: 'Today\'s Combos', subtitle: null, sortOrder: 3,
          isEnabled: true, config: { categorySlug: null },
        }] };
      }
      if (/FROM mart_order_items oi/.test(text)) {
        return { rows: [{ productId: 'best-1' }, { productId: 'best-2' }] };
      }
      if (/FROM mart_home_sections/.test(text) && /is_enabled = true/.test(text)) {
        return { rows: [{
          id: 's1', storeId: params[0], sectionKey: 'top_picks',
          title: 'Store Favourites', subtitle: null, sortOrder: 4, isEnabled: true,
          config: { categorySlug: null, productIds: [], limit: null, layout: null },
        }] };
      }
      return { rows: [] };
    },
    release: () => undefined,
    end: async () => undefined,
  };
};

const {
  HomeSectionService, normalizeSectionConfig, HOME_SECTION_KEYS,
} = require('../src/services/homeSection.service');

/** Reads a repo file by workspace-relative path. */
const read = (p: string) => require('fs').readFileSync(require('path').resolve(__dirname, '../..', p), 'utf8');

beforeEach(() => { calls.length = 0; });

const EMPTY_CONFIG = { categorySlug: null, productIds: [], limit: null, layout: null };

describe('A. config is reduced to the shape the storefront understands', () => {
  test('unknown keys are dropped, not persisted', () => {
    assert.deepEqual(
      normalizeSectionConfig({ categorySlug: 'vegetables', html: '<script>' }),
      { ...EMPTY_CONFIG, categorySlug: 'vegetables' },
    );
  });

  test('a category slug is lowercased and trimmed', () => {
    assert.deepEqual(
      normalizeSectionConfig({ categorySlug: '  Fresh-Veg  ' }),
      { ...EMPTY_CONFIG, categorySlug: 'fresh-veg' },
    );
  });

  test('a non-slug category is rejected', () => {
    for (const bad of ['veg_thing', 'has space', 'a/b', '../../etc', 'veg!']) {
      assert.throws(() => normalizeSectionConfig({ categorySlug: bad }), /Category slug/, bad);
    }
  });

  test('uppercase is accepted and normalised, not rejected', () => {
    assert.deepEqual(
      normalizeSectionConfig({ categorySlug: 'Vegetables' }),
      { ...EMPTY_CONFIG, categorySlug: 'vegetables' },
    );
  });

  test('missing or non-object config yields an empty scope', () => {
    assert.deepEqual(normalizeSectionConfig(undefined), EMPTY_CONFIG);
    assert.deepEqual(normalizeSectionConfig('nope' as unknown), EMPTY_CONFIG);
    assert.deepEqual(normalizeSectionConfig({ categorySlug: 42 }), EMPTY_CONFIG);
  });

  test('hand-picked product ids are trimmed, de-duplicated and string-only', () => {
    const cfg = normalizeSectionConfig({ productIds: [' p1 ', 'p1', '', 7, 'p2', null, 'p3 '] });
    assert.deepEqual(cfg.productIds, ['p1', 'p2', 'p3']);
  });

  test('product ids are capped so a section cannot be flooded', () => {
    const cfg = normalizeSectionConfig({ productIds: Array.from({ length: 200 }, (_, i) => `p${i}`) });
    assert.equal(cfg.productIds.length, 60);
  });

  test('limit accepts only a positive integer and is capped', () => {
    assert.equal(normalizeSectionConfig({ limit: 5 }).limit, 5);
    assert.equal(normalizeSectionConfig({ limit: 999 }).limit, 60);
    assert.equal(normalizeSectionConfig({ limit: 0 }).limit, null);
    assert.equal(normalizeSectionConfig({ limit: -3 }).limit, null);
    assert.equal(normalizeSectionConfig({ limit: 2.5 }).limit, null);
    assert.equal(normalizeSectionConfig({ limit: 'many' }).limit, null);
  });

  test('layout accepts only row or grid, otherwise falls back to auto (null)', () => {
    assert.equal(normalizeSectionConfig({ layout: 'row' }).layout, 'row');
    assert.equal(normalizeSectionConfig({ layout: 'grid' }).layout, 'grid');
    assert.equal(normalizeSectionConfig({ layout: 'carousel' }).layout, null);
  });
});

describe('B. sections can only be created for known, renderable types', () => {
  test('the allowlist is exactly the sections the storefront can render', () => {
    assert.deepEqual([...HOME_SECTION_KEYS], ['todays_combos', 'fresh_vegetables', 'deals', 'top_picks']);
  });

  test('an unknown section key is rejected outright', async () => {
    await assert.rejects(
      () => HomeSectionService.create('store-1', { sectionKey: 'banner_grid', title: 'X' }),
      /Unknown section/,
    );
    assert.equal(calls.some(c => /INSERT INTO mart_home_sections/.test(c.text)), false, 'nothing persisted');
  });

  test('a blank title is rejected', async () => {
    await assert.rejects(
      () => HomeSectionService.create('store-1', { sectionKey: 'todays_combos', title: '   ' }),
      /title is required/,
    );
  });

  test('a new section is appended after the existing ones', async () => {
    await HomeSectionService.create('store-1', { sectionKey: 'fresh_vegetables', title: 'Fresh Vegetables' });
    const insert = [...calls].reverse().find(c => /INSERT INTO mart_home_sections/.test(c.text))!;
    assert.equal(insert.params[4], 3, 'sort order should be MAX+1');
  });
});

describe('C. the public read is store-scoped and enabled-only', () => {
  test('the public query filters on is_enabled and the store id', async () => {
    await HomeSectionService.findByStore('store-7', true);
    const select = calls.find(c => /FROM mart_home_sections/.test(c.text))!;
    assert.match(select.text, /is_enabled = true/);
    assert.deepEqual(select.params, ['store-7']);
  });

  test('the admin query does not force enabled-only', async () => {
    await HomeSectionService.findByStore('store-7', false);
    const select = calls.find(c => /FROM mart_home_sections/.test(c.text))!;
    assert.doesNotMatch(select.text, /is_enabled = true/);
  });
});

describe('D. reorder cannot touch another store', () => {
  test('each reorder statement is scoped to the caller store', async () => {
    await HomeSectionService.reorder('store-7', ['a', 'b']);
    const updates = calls.filter(c => /UPDATE mart_home_sections SET sort_order/.test(c.text));
    assert.equal(updates.length, 2);
    for (const u of updates) {
      assert.match(u.text, /store_id = \$3/);
      assert.equal(u.params[2], 'store-7');
    }
  });
});

describe('E. route wiring and the seed migration', () => {
  const routes = read('mart-backend/src/routes/index.ts');

  test('the public home-sections route is not behind auth', () => {
    const line = routes.split('\n').find(l => l.includes("router.get('/home-sections'"))!;
    assert.ok(line, 'public route must exist');
    assert.doesNotMatch(line, /authenticate/);
  });

  test('every admin home-sections write route is role-guarded', () => {
    for (const verb of ['get', 'post', 'put', 'delete']) {
      const lines = routes.split('\n').filter(l => l.includes(`router.${verb}('/admin/home-sections`));
      for (const line of lines) {
        assert.match(line, /requireRole\('super_admin', 'store_owner'\)/, line);
      }
    }
  });

  test('migration 079 creates and seeds the home sections table', () => {
    const sql = read('mart-backend/src/database/migrations/079_home_sections.sql');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS mart_home_sections/);
    assert.match(sql, /'todays_combos'/);
    assert.match(sql, /'fresh_vegetables'/);
  });

  test('migration 080 adds the deals and top_picks sections', () => {
    const sql = read('mart-backend/src/database/migrations/080_home_sections_deals_top_picks.sql');
    assert.match(sql, /'deals'/);
    assert.match(sql, /'top_picks'/);
  });

  test('migration 081 enables the deals and top_picks sections by default', () => {
    const sql = read('mart-backend/src/database/migrations/081_home_sections_default_enabled.sql');
    assert.match(sql, /'deals'/);
    assert.match(sql, /'top_picks'/);
    assert.match(sql, /is_enabled = true/);
  });

  test('migration 082 renames the deals section to Today\'s Deals', () => {
    const sql = read('mart-backend/src/database/migrations/082_deals_section_title.sql');
    assert.match(sql, /Today''s Deals/);
    assert.match(sql, /section_key = 'deals'/);
    assert.match(sql, /Deals of the Day/);
  });

  test('migration 083 renames the top_picks section to Store Favourites', () => {
    const sql = read('mart-backend/src/database/migrations/083_store_favourites.sql');
    assert.match(sql, /Store Favourites/);
    assert.match(sql, /section_key = 'top_picks'/);
    assert.match(sql, /Today''s Top Picks/);
  });

  test('migration 084 keeps only Combos + Store Favourites on the home', () => {
    const sql = read('mart-backend/src/database/migrations/084_home_two_section_layout.sql');
    assert.match(sql, /'todays_combos'     THEN 1/);
    assert.match(sql, /'top_picks'         THEN 2/);
    assert.match(sql, /is_enabled = section_key IN \('todays_combos', 'top_picks'\)/);
  });
});

describe('G. Store Favourites (top_picks) falls back to bestsellers when unpicked', () => {
  test('publicSections fills an unpicked top_picks section from live ordered items', async () => {
    const sections = await HomeSectionService.publicSections('store-1');
    const picks = sections.find(s => s.sectionKey === 'top_picks')!;
    assert.ok(picks, 'top_picks section should be returned');
    assert.deepEqual(picks.config.productIds, ['best-1', 'best-2']);
  });

  test('the bestseller query is store-scoped and excludes cancelled/failed orders', async () => {
    await HomeSectionService.publicSections('store-9');
    const sql = calls.find(c => /FROM mart_order_items oi/.test(c.text))!;
    assert.ok(sql, 'a bestseller query should run for an unpicked section');
    assert.match(sql.text, /o\.store_id = \$1/);
    assert.match(sql.text, /o\.status NOT IN \('cancelled','failed_delivery','terminated'\)/);
    assert.match(sql.text, /sp\.is_available = true/);
    assert.deepEqual(sql.params, ['store-9', 12]);
  });
});

describe('F. deals and top_picks are creatable types', () => {
  for (const key of ['deals', 'top_picks']) {
    test(`a ${key} section can be created`, async () => {
      await HomeSectionService.create('store-1', { sectionKey: key, title: 'X' });
      const insert = [...calls].reverse().find(c => /INSERT INTO mart_home_sections/.test(c.text));
      assert.ok(insert, 'insert should run');
      assert.equal(insert.params[1], key);
    });
  }
});
