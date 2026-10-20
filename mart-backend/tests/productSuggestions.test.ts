/**
 * Product suggestion query building.
 *
 * The service composes SQL fragments by hand, and the test harness stubs every
 * database call, so a malformed placeholder or an out-of-range INTERVAL would
 * not be caught by running the endpoints. These tests exercise the two pure
 * builders that produce that SQL directly.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { __testables } from '../src/services/productSuggestion.service';

const { normaliseRange, istRangeWhere } = __testables;

describe('Product suggestion range windowing', () => {
  test('unknown ranges coerce to the 30d default instead of an undefined INTERVAL', () => {
    for (const bogus of ['', 'foo', 'yesterday', '365d'] as unknown as string[]) {
      assert.equal(normaliseRange(bogus as never), '30d', `${bogus} should fall back to 30d`);
    }
  });

  test('known ranges are preserved', () => {
    for (const range of ['today', '7d', '30d', 'all', 'custom'] as const) {
      assert.equal(normaliseRange(range), range);
    }
  });

  test('the date fragment numbers its placeholders from the caller start index', () => {
    const fragment = istRangeWhere('created_at', '7d', undefined, undefined, 4);
    assert.match(fragment.sql, /\$4/, 'first placeholder should be $4');
    assert.equal(fragment.params.length, 1);
    // No stray $1/$2/$3 that would collide with filter params already consumed.
    assert.doesNotMatch(fragment.sql, /\$[123]\b/);
  });

  test('custom range uses two consecutive placeholders from the start index', () => {
    const fragment = istRangeWhere('created_at', 'custom', '2026-01-01', '2026-01-31', 3);
    assert.match(fragment.sql, /\$3::date/);
    assert.match(fragment.sql, /\$4::date/);
    assert.deepEqual(fragment.params, ['2026-01-01', '2026-01-31']);
  });

  test('custom range without both bounds is a safe no-match, not a wildcard', () => {
    assert.equal(istRangeWhere('created_at', 'custom', '2026-01-01', undefined, 1).sql, 'FALSE');
    assert.equal(istRangeWhere('created_at', 'custom', undefined, undefined, 1).sql, 'FALSE');
  });

  test('all-time contributes no condition and no params', () => {
    const fragment = istRangeWhere('created_at', 'all', undefined, undefined, 5);
    assert.equal(fragment.sql, 'TRUE');
    assert.deepEqual(fragment.params, []);
  });
});
