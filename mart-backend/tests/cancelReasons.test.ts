/**
 * Customer cancel reasons.
 *
 * These tests pin the contract between the two client apps and the server. The
 * customer picks a reason from a fixed list; the server stores only values it
 * recognises and falls back to a generic label otherwise. If a client and the
 * server ever drift, a real cancel would be recorded as "customer_request" and
 * the reason would be lost, so the value sets must match exactly.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CUSTOMER_CANCEL_REASONS } from '../src/services/order.service';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

const serverValues = Object.keys(CUSTOMER_CANCEL_REASONS);

describe('Customer cancel reasons', () => {
  test('the server allowlist is non-empty and includes "other"', () => {
    assert.ok(serverValues.length >= 3, 'expected a handful of reasons');
    assert.ok(serverValues.includes('other'), 'an "other" catch-all must exist');
  });

  test('values are lower_snake_case so they stay stable as a stored key', () => {
    for (const value of serverValues) {
      assert.match(value, /^[a-z][a-z_]*$/, `${value} is not lower_snake_case`);
    }
  });

  test('the web client offers exactly the server reasons', () => {
    const src = read('mart-user/src/pages/OrderHistoryPage.tsx');
    for (const value of serverValues) {
      assert.ok(src.includes(`value: '${value}'`), `web client is missing reason ${value}`);
    }
  });

  test('the mobile client offers exactly the server reasons', () => {
    const src = read('mart-mobile/app/(tabs)/orders.tsx');
    for (const value of serverValues) {
      assert.ok(src.includes(`value: '${value}'`), `mobile client is missing reason ${value}`);
    }
  });

  // The clients must not offer a reason the server would reject: the server
  // silently falls back to "customer_request", so a stale extra option would
  // quietly lose the customer's chosen reason. Parse the CANCEL_REASONS arrays
  // and assert both directions of the set match.
  const clientValues = (rel: string) => {
    const src = read(rel);
    const block = src.slice(src.indexOf('CANCEL_REASONS'), src.indexOf('];', src.indexOf('CANCEL_REASONS')));
    return [...block.matchAll(/value:\s*'([a-z_]+)'/g)].map(m => m[1]);
  };

  for (const [name, rel] of [
    ['web', 'mart-user/src/pages/OrderHistoryPage.tsx'],
    ['mobile', 'mart-mobile/app/(tabs)/orders.tsx'],
  ] as const) {
    test(`the ${name} client has no extra reasons the server would drop`, () => {
      const extras = clientValues(rel).filter(v => !serverValues.includes(v));
      assert.deepEqual(extras, [], `${name} client offers reasons the server does not accept: ${extras.join(', ')}`);
    });
  }

  // The hub renders cancellation labels for both customer self-service reasons
  // and staff reasons; every server reason must have a human label so a closed
  // order never shows a raw snake_case value to staff.
  test('the hub labels every server reason', () => {
    const src = read('mart-hub/src/pages/OrdersPage.tsx');
    for (const value of serverValues) {
      assert.ok(src.includes(`${value}:`), `hub has no label for reason ${value}`);
    }
  });
});
