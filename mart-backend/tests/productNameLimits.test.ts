/**
 * Product name limits.
 *
 * The storefront renders the product name and the local (Hindi) name together
 * as one bracketed label, so both have to be bounded. The limits live in the
 * backend so no client can bypass them, and the hub inputs enforce the same
 * numbers.
 *
 * These tests lock the limits and the normalisation rules so they cannot drift
 * apart: a name that is too long must be rejected with a clear message, and
 * the value that reaches the database must be trimmed and whitespace-collapsed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'product-name-limits-test-secret';

import {
  MAX_PRODUCT_NAME_LENGTH,
  MAX_LOCAL_NAME_LENGTH,
  normalizeProductName,
  normalizeLocalName,
} from '../src/services/product.service';

describe('Product name limits', () => {
  test('a name at the limit is accepted', () => {
    const name = 'a'.repeat(MAX_PRODUCT_NAME_LENGTH);
    assert.equal(normalizeProductName(name), name);
  });

  test('a name over the limit is rejected', () => {
    const name = 'a'.repeat(MAX_PRODUCT_NAME_LENGTH + 1);
    assert.throws(
      () => normalizeProductName(name),
      /40 characters or fewer/,
      'an over-long product name must be rejected rather than truncated',
    );
  });

  test('an empty or whitespace-only name is rejected', () => {
    assert.throws(() => normalizeProductName(''), /required/);
    assert.throws(() => normalizeProductName('   '), /required/);
    assert.throws(() => normalizeProductName(undefined), /required/);
  });

  test('a name is trimmed and its internal whitespace collapsed', () => {
    assert.equal(normalizeProductName('  Fresh   Yellow  Capsicum '), 'Fresh Yellow Capsicum');
  });

  test('a local name at the limit is accepted', () => {
    const localName = 'b'.repeat(MAX_LOCAL_NAME_LENGTH);
    assert.equal(normalizeLocalName(localName), localName);
  });

  test('a local name over the limit is rejected', () => {
    const localName = 'b'.repeat(MAX_LOCAL_NAME_LENGTH + 1);
    assert.throws(() => normalizeLocalName(localName), /30 characters or fewer/);
  });

  test('an absent local name becomes null rather than an empty string', () => {
    assert.equal(normalizeLocalName(undefined), null);
    assert.equal(normalizeLocalName(null), null);
    assert.equal(normalizeLocalName(''), null);
    assert.equal(normalizeLocalName('   '), null);
  });

  test('the two limits together fit the storefront label', () => {
    // The card renders "name (local name)" and clamps it to three lines, so
    // the pair has to be bounded in a way that still fits a phone card.
    assert.ok(MAX_PRODUCT_NAME_LENGTH <= 40);
    assert.ok(MAX_LOCAL_NAME_LENGTH <= 30);
  });
});
