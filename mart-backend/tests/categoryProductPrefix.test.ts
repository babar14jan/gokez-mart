import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'category-product-prefix-test-secret';

import { normalizeProductPrefix } from '../src/services/category.service';

describe('category product prefix normalization', () => {
  test('trims and uppercases valid prefixes', () => {
    assert.equal(normalizeProductPrefix(' veg '), 'VEG');
  });

  test('requires two to six letters', () => {
    for (const value of ['', 'V', 'VEGETABLE', 'VEG1', 'VE-G']) {
      assert.throws(() => normalizeProductPrefix(value), /Product prefix/);
    }
  });
});