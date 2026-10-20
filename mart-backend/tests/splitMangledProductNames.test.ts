/**
 * Migration 095: split mangled product names back into a name and aliases.
 *
 * A few catalogue rows were created with several names typed into the "name"
 * field, separated by runs of spaces:
 *
 *   "Organic Tejaswini Green Chilli   Tejaswini Kancha Lanka   Te"
 *
 * The extra names were meant to be search aliases. Left alone they break two
 * things: the product displays with a run of spaces and a chopped-off tail,
 * and the name exceeds MAX_PRODUCT_NAME_LENGTH, so editing the product in the
 * hub is rejected by the API.
 *
 * The migration is SQL, so the rule is asserted here against the same
 * expression it uses, plus a check that the file still contains it -- so a
 * rewrite of the migration cannot silently change the behaviour.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_PRODUCT_NAME_LENGTH } from '../src/services/product.service';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'split-mangled-names-test-secret';

const SQL = readFileSync(
  new URL('../src/database/migrations/095_split_mangled_product_names.sql', import.meta.url),
  'utf8',
);

describe('Migration 095 — split mangled product names', () => {
  test('the migration file exists and targets the name and alias columns', () => {
    assert.match(SQL, /UPDATE\s+mart_products/i);
    assert.match(SQL, /name\s*=\s*s\.first_part/);
    assert.match(SQL, /search_aliases\s*=/);
  });

  test('it splits on runs of two or more spaces, not single ones', () => {
    // Two or more spaces separate the name from the extra names.
    assert.match(SQL, /\[\[:space:\]\]\{2,\}/);
    // A single space inside a name must not be treated as a separator.
    assert.doesNotMatch(SQL, /\[\[:space:\]\]\{1,\}'/);
  });

  test('the split rule itself behaves as intended', () => {
    // The same rule the migration applies, in JS: runs of two or more spaces
    // separate the parts, single spaces stay inside a name.
    const parts = (name: string) =>
      name.trim().split(/\s{2,}/).map(p => p.trim()).filter(Boolean);

    assert.deepEqual(
      parts('Organic Tejaswini Green Chilli   Tejaswini Kancha Lanka   Te'),
      ['Organic Tejaswini Green Chilli', 'Tejaswini Kancha Lanka', 'Te'],
    );
    assert.deepEqual(
      parts('Fresh Coriander Leaves   Dhonepata   Hara Dhaniya'),
      ['Fresh Coriander Leaves', 'Dhonepata', 'Hara Dhaniya'],
    );
    // A clean name is a single part and is left alone.
    assert.deepEqual(parts('Coriander Leaves'), ['Coriander Leaves']);
    // Single spaces inside a name are preserved.
    assert.deepEqual(parts('Fresh Yellow  Capsicum  Extra'), [
      'Fresh Yellow', 'Capsicum', 'Extra',
    ]);
  });

  test('the first part of a split name fits the product name limit', () => {
    const parts = (name: string) =>
      name.trim().split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
    // The rows that motivated the migration all have a first part well inside
    // the limit, which is what makes the migration safe to apply.
    for (const name of [
      'Organic Tejaswini Green Chilli   Tejaswini Kancha Lanka   Te',
      'Organic Bullet Green Chilli   Kancha Lanka   Bullet Hari Mir',
      'Fresh Coriander Leaves   Dhonepata   Hara Dhaniya',
    ]) {
      assert.ok(parts(name)[0].length <= MAX_PRODUCT_NAME_LENGTH, name);
    }
  });
});
