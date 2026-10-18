/**
 * Address book + order address-snapshot regression tests.
 *
 * Scope: the delivery-address contract between the storefront and the API —
 *   * every /auth/addresses route is customer-JWT only,
 *   * ownership is enforced by scoping every mutation to the token's customer,
 *   * POST /auth/addresses is idempotent by address (no client-cache trust),
 *   * every order carries a full address snapshot (text + coordinates) and the
 *     guest's address is filed into the phone-derived customer's address book.
 *
 * Harness: same as security.test.ts — the real Express app and route table with
 * `pg.Pool.prototype.connect` stubbed, so middleware ordering and controller
 * validation are genuine. Node's built-in runner via tsx.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// ── Environment must be configured BEFORE any app module is loaded ────────────
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'address-book-test-secret';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

const require = createRequire(__filename);

// ── Stub the database layer ─────────────────────────────────────────────────
// Each statement is routed by its shape to a configurable fixture, so a test
// decides what "the database" answers for the reads that gate a write, and the
// full query log lets a test assert on the writes that were actually issued.
interface CapturedQuery { text: string; params: unknown[] }

const CUSTOMER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PHONE_DERIVED_CUSTOMER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STORE_ID = '11111111-1111-1111-1111-111111111111';
const PRODUCT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

let queriesRun: CapturedQuery[] = [];

// Read fixtures (reset per test).
let addressListRows: Array<Record<string, unknown>> = [];
let addressDupeRows: Array<Record<string, unknown>> = [];
let addressCount = 0;
let updateReturningRows: Array<Record<string, unknown>> = [];
let deleteReturningRows: Array<Record<string, unknown>> = [];
let setDefaultTargetRows: Array<Record<string, unknown>> = [];

const existingAddress = {
  id: 'addr-1',
  label: 'Home',
  addressLine: '42, MG Road, Pune 411001',
  latitude: 18.5204,
  longitude: 73.8567,
  isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const productRow = {
  name: 'Apple', isBundle: false, price: 40, discountPercent: 0,
  unit: 'kg', isAvailable: true, availabilityStatus: 'available',
};

const pg = require('pg');
(pg.Pool.prototype as any).connect = async function () {
  return {
    query: async (text: string, params?: unknown[]) => {
      queriesRun.push({ text, params: params || [] });

        // ── Address book ────────────────────────────────────────────────────
        if (/INSERT INTO mart_customer_addresses/.test(text)) {
          // The service RETURNING-clients the new row; hand one back so the
          // controller's response body carries it (a bare {rows:[]} would
          // serialize as `{"success":true}` with no data).
          return {
            rows: [{
              id: 'addr-new', label: params?.[1] ?? 'Home', addressLine: params?.[2],
              latitude: params?.[3] ?? null, longitude: params?.[4] ?? null,
              isDefault: params?.[5] ?? false, createdAt: '2026-01-02T00:00:00.000Z',
            }],
          };
        }
        if (/SELECT COUNT\(\*\) as count FROM mart_customer_addresses/.test(text)) {
          return { rows: [{ count: String(addressCount) }] };
        }
        if (/DELETE FROM mart_customer_addresses/.test(text)) return { rows: deleteReturningRows };
        if (/UPDATE mart_customer_addresses SET is_default = true, updated_at/.test(text)) {
          return { rows: [] };
        }
        if (/UPDATE mart_customer_addresses SET is_default = false WHERE customer_id/.test(text)) {
          return { rows: [] };
        }
        if (/SELECT id FROM mart_customer_addresses[\s\S]*FOR UPDATE/.test(text)) {
          return { rows: setDefaultTargetRows };
        }
        if (/UPDATE mart_customer_addresses SET label/.test(text)) return { rows: updateReturningRows };
        if (/FROM mart_customer_addresses/.test(text)) {
          // addAddress's check-then-insert duplicate probe.
          if (/lower\(btrim\(address_line\)\)/.test(text)) return { rows: addressDupeRows };
          // getAddresses listing.
          if (/ORDER BY is_default DESC, created_at DESC/.test(text)) return { rows: addressListRows };
          return { rows: [] };
        }

        // ── Order placement ─────────────────────────────────────────────────
        if (/SELECT key, value FROM mart_settings/.test(text)) return { rows: [] };
        if (/SELECT 1 FROM mart_orders WHERE order_number/.test(text)) return { rows: [] };
        if (/FROM mart_orders WHERE idempotency_key/.test(text)) return { rows: [] };
        if (/INSERT INTO mart_customers \(/.test(text)) return { rows: [] };
        if (/SELECT id FROM mart_customers WHERE phone/.test(text)) {
          return { rows: [{ id: PHONE_DERIVED_CUSTOMER_ID }] };
        }
        if (/INSERT INTO mart_orders/.test(text)) return { rows: [] };
        if (/INSERT INTO mart_order_items/.test(text)) return { rows: [] };
        if (/UPDATE mart_customers/.test(text)) return { rows: [] };
        if (/UPDATE mart_orders SET whatsapp_sent/.test(text)) return { rows: [] };
        if (/FROM mart_store_products sp/.test(text)) return { rows: [productRow] };
        if (/SELECT s\.opening_hours, sv\.value AS store_open/.test(text)) return { rows: [] };
        if (/SELECT name FROM mart_stores WHERE id/.test(text)) return { rows: [{ name: 'Test Store' }] };
        // placeOrder's stored-name lookup for an authenticated customer.
        if (/FROM mart_customers WHERE id =/.test(text)) {
          return { rows: [{ id: params?.[0], phone: '9876543210', name: 'Test Customer' }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };
  };

const app = (require('../src/app') as { default: any }).default;
const jwt = require('jsonwebtoken');
const { CUSTOMER_TOKEN_TYPE } = require('../src/middleware');

const SECRET = 'address-book-test-secret';

const customerToken = () =>
  jwt.sign({ id: CUSTOMER_ID, phone: '9876543210', type: CUSTOMER_TOKEN_TYPE, jti: 'jti-customer-1' }, SECRET, { expiresIn: '1h' });

let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => { server?.close(); });

beforeEach(() => {
  queriesRun = [];
  addressListRows = [];
  addressDupeRows = [];
  addressCount = 0;
  updateReturningRows = [];
  deleteReturningRows = [];
  setDefaultTargetRows = [];
});

async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const ADDRESS_ROUTES: Array<[string, string, unknown?]> = [
  ['GET', '/api/v1/auth/addresses'],
  ['POST', '/api/v1/auth/addresses', { label: 'Home', addressLine: '42, MG Road, Pune 411001' }],
  ['PUT', '/api/v1/auth/addresses/addr-1', { label: 'Home', addressLine: '42, MG Road, Pune 411001' }],
  ['DELETE', '/api/v1/auth/addresses/addr-1'],
  ['PUT', '/api/v1/auth/addresses/addr-1/default'],
];

describe('The address book is held behind customer authentication', () => {
  for (const [method, path, body] of ADDRESS_ROUTES) {
    test(`${method} ${path} without a token is rejected`, async () => {
      const { status } = await call(method, path, body);
      assert.equal(status, 401);
      assert.equal(queriesRun.length, 0, 'no query may run for an unauthenticated request');
    });
  }

  test('an admin token is not a customer token on the address routes', async () => {
    const admin = jwt.sign(
      { id: 'admin-1', username: 'owner', role: 'store_owner', type: 'admin', storeId: STORE_ID, jti: 'jti-admin-1' },
      SECRET, { expiresIn: '1h' },
    );
    const { status } = await call('GET', '/api/v1/auth/addresses', undefined, admin);
    assert.equal(status, 401);
  });
});

describe('Authenticated address book CRUD', () => {
  test('GET serves the token customer’s own book, keyed by their id', async () => {
    addressListRows = [existingAddress];
    const { status, json } = await call('GET', '/api/v1/auth/addresses', undefined, customerToken());
    assert.equal(status, 200);
    assert.equal(json.data.length, 1);
    assert.equal(json.data[0].addressLine, existingAddress.addressLine);
    const list = queriesRun.find(q => /FROM mart_customer_addresses/.test(q.text));
    assert.ok(list, 'the book is read from mart_customer_addresses');
    assert.equal(list!.params[0], CUSTOMER_ID, 'scoped to the token customer, not a client-supplied id');
  });

  test('POST inserts scoped to the token customer and claims the default on first add', async () => {
    addressCount = 0;
    const { status, json } = await call('POST', '/api/v1/auth/addresses', {
      label: 'Home', addressLine: '42, MG Road, Pune 411001',
      isDefault: true, latitude: 18.5204, longitude: 73.8567,
    }, customerToken());
    assert.equal(status, 200);
    assert.ok(json.data);
    const insert = queriesRun.find(q => /INSERT INTO mart_customer_addresses/.test(q.text))!;
    assert.ok(insert, 'the address was inserted');
    assert.equal(insert.params[0], CUSTOMER_ID);
    assert.equal(insert.params[1], 'Home');
    assert.equal(insert.params[2], '42, MG Road, Pune 411001');
    assert.equal(insert.params[3], 18.5204);
    assert.equal(insert.params[4], 73.8567);
    assert.equal(insert.params[5], true, 'the first address becomes the default');
  });

  test('POST is idempotent by address: a duplicate returns the existing row without a second insert', async () => {
    addressDupeRows = [existingAddress];
    const { status, json } = await call('POST', '/api/v1/auth/addresses', {
      label: 'Home', addressLine: '  42, MG Road, Pune 411001  ',
    }, customerToken());
    assert.equal(status, 200);
    assert.equal(json.data.id, existingAddress.id, 'the existing row is served back');
    assert.ok(
      !queriesRun.some(q => /INSERT INTO mart_customer_addresses/.test(q.text)),
      'no duplicate row is inserted — the server does not trust any client-side cache',
    );
  });

  test('PUT updates only the token customer’s own row', async () => {
    updateReturningRows = [{ ...existingAddress, label: 'Work' }];
    const { status } = await call('PUT', '/api/v1/auth/addresses/addr-1', {
      label: 'Work', addressLine: '7, FC Road, Pune 411004', latitude: 18.5308, longitude: 73.8478,
    }, customerToken());
    assert.equal(status, 200);
    const update = queriesRun.find(q => /UPDATE mart_customer_addresses SET label/.test(q.text))!;
    assert.ok(update, 'the update was issued');
    assert.match(update.text, /WHERE id = \$\d+ AND customer_id = \$\d+/,
      'ownership is part of the statement, not a separate check');
    assert.ok(update.params.includes('addr-1'));
    assert.ok(update.params.includes(CUSTOMER_ID));
  });

  test('PUT on another customer’s address id is a 404, not a silent success', async () => {
    updateReturningRows = []; // the scoped UPDATE matches no row
    const { status, json } = await call('PUT', '/api/v1/auth/addresses/not-mine', {
      label: 'Home', addressLine: '42, MG Road, Pune 411001',
    }, customerToken());
    assert.equal(status, 404);
    assert.equal(json.error, 'Address not found');
  });

  test('DELETE on another customer’s address id is a 404', async () => {
    deleteReturningRows = [];
    const { status } = await call('DELETE', '/api/v1/auth/addresses/not-mine', undefined, customerToken());
    assert.equal(status, 404);
  });

  test('DELETE on the customer’s own row issues the scoped delete', async () => {
    deleteReturningRows = [{ is_default: false }];
    const { status } = await call('DELETE', '/api/v1/auth/addresses/addr-1', undefined, customerToken());
    assert.equal(status, 200);
    const del = queriesRun.find(q => /DELETE FROM mart_customer_addresses/.test(q.text))!;
    assert.match(del.text, /WHERE id = \$\d+ AND customer_id = \$\d+/);
  });

  test('setDefault on another customer’s address id is a 404', async () => {
    setDefaultTargetRows = [];
    const { status } = await call('PUT', '/api/v1/auth/addresses/not-mine/default', undefined, customerToken());
    assert.equal(status, 404);
  });

  test('setDefault scopes its lock and update to the token customer', async () => {
    setDefaultTargetRows = [{ id: 'addr-2' }];
    const { status } = await call('PUT', '/api/v1/auth/addresses/addr-2/default', undefined, customerToken());
    assert.equal(status, 200);
    const clear = queriesRun.find(q => /UPDATE mart_customer_addresses SET is_default = false WHERE customer_id/.test(q.text))!;
    assert.equal(clear.params[0], CUSTOMER_ID, 'other addresses of this customer only');
  });
});

describe('Every order carries an address snapshot', () => {
  const orderBody = {
    guestName: 'Test Guest',
    guestPhone: '9876543210',
    guestAddress: '12, Rose Villa, Kothrud, Pune 411038',
    guestAddressLabel: 'Home',
    items: [{ productId: PRODUCT_ID, unit: 'kg', quantity: 2 }],
    storeId: STORE_ID,
    latitude: 17.385,
    longitude: 78.4867,
  };

  test('a guest order snapshots the address text and coordinates on the order row', async () => {
    const { status } = await call('POST', '/api/v1/orders', orderBody, undefined, {
      'Idempotency-Key': 'snapshot-test-1',
    });
    assert.equal(status, 201);

    const insert = queriesRun.find(q => /INSERT INTO mart_orders/.test(q.text))!;
    assert.ok(insert, 'the order was inserted');
    assert.match(insert.text, /guest_address/);
    assert.match(insert.text, /delivery_latitude/);
    assert.match(insert.text, /delivery_longitude/);
    assert.ok(insert.params.includes(orderBody.guestAddress), 'address text stored on the order');
    assert.ok(insert.params.includes(orderBody.latitude), 'latitude stored on the order');
    assert.ok(insert.params.includes(orderBody.longitude), 'longitude stored on the order');
  });

  test('the guest’s address is filed into the phone-derived customer’s address book', async () => {
    const { status } = await call('POST', '/api/v1/orders', orderBody, undefined, {
      'Idempotency-Key': 'snapshot-test-2',
    });
    assert.equal(status, 201);

    const filing = queriesRun.find(q => /INSERT INTO mart_customer_addresses/.test(q.text))!;
    assert.ok(filing, 'the address book filing ran inside the order transaction');
    assert.equal(filing.params[0], PHONE_DERIVED_CUSTOMER_ID, 'filed against the phone-derived customer row');
    assert.equal(filing.params[1], 'Home');
    assert.equal(filing.params[2], orderBody.guestAddress);
    assert.equal(filing.params[3], orderBody.latitude);
    assert.equal(filing.params[4], orderBody.longitude);
  });

  test('an order without coordinates still snapshots the address text', async () => {
    const { status } = await call('POST', '/api/v1/orders', {
      ...orderBody, latitude: undefined, longitude: undefined,
    }, undefined, { 'Idempotency-Key': 'snapshot-test-3' });
    assert.equal(status, 201);
    const insert = queriesRun.find(q => /INSERT INTO mart_orders/.test(q.text))!;
    assert.ok(insert.params.includes(orderBody.guestAddress));
    assert.ok(insert.params.includes(null), 'absent coordinates are stored as null, not dropped');
  });
});
