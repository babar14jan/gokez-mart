/**
 * Phase 0 security regression tests.
 *
 * Scope is deliberately narrow: token typing / role elevation and cross-store team
 * authorization only. These are the two defects found in the Phase 1 audit.
 *
 * Harness: Node's built-in `node:test` runner via `tsx` — no new dependencies,
 * matching the repo which currently has no test framework at all.
 *
 * The real Express app and the real route table are mounted, so these assert on
 * genuine middleware ordering rather than a hand-built approximation. The only
 * substitute is the database layer: `db.query` is stubbed before the app loads.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// ── Environment must be configured BEFORE any app module is loaded ────────────
// `config` throws on a missing production secret and `database/db` throws on a
// missing DATABASE_URL, so these have to be in place first. `require` (not a
// hoisted `import`) is used below to guarantee that ordering under tsx/esbuild.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'phase0-security-test-secret';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

const require = createRequire(__filename);

// ── Stub the database layer ─────────────────────────────────────────────────
// `mart_admin_store_assignments` is the only table the guards read directly, so
// it gets a controllable fixture. Everything else returns no rows, which is
// enough for the handlers under test to respond 200 with an empty collection.
//
// The stub goes in at `pg.Pool.prototype.connect` rather than on the db module:
// tsx compiles `export const query` to a getter-only, non-configurable export, so
// the module's own bindings cannot be replaced. `connect` is an ordinary
// prototype method and the app never opens a real connection.
const pg = require('pg');
const assignments = new Set<string>();
const queriesRun: string[] = [];
(pg.Pool.prototype as any).connect = async function () {
  return {
    query: async (text: string, params?: unknown[]) => {
      queriesRun.push(text);
      if (text.includes('mart_admin_store_assignments')) {
        const [adminId, storeId] = (params || []) as [string, string];
        return { rows: assignments.has(`${adminId}:${storeId}`) ? [{ ok: 1 }] : [] };
      }
      // Customer profile lookup by id — lets the "customer flow is untouched"
      // test reach the handler and prove a real 200 rather than merely a
      // non-401, which would also be true of a silently failing guard.
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
const { ADMIN_ROLES, ADMIN_TOKEN_TYPE, CUSTOMER_TOKEN_TYPE } = require('../src/middleware');

const SECRET = 'phase0-security-test-secret';
const OWN_STORE = '11111111-1111-1111-1111-111111111111';
const OTHER_STORE = '22222222-2222-2222-2222-222222222222';

const signToken = (payload: Record<string, unknown>) =>
  jwt.sign(payload, SECRET, { expiresIn: '1h' });

const customerToken = () =>
  signToken({ id: 'customer-1', phone: '9876543210', type: CUSTOMER_TOKEN_TYPE, jti: 'jti-customer-1' });

const adminToken = (role: string, storeId: string | null = null) =>
  signToken({ id: `admin-${role}`, username: `${role}_user`, role, type: ADMIN_TOKEN_TYPE, storeId, jti: `jti-${role}` });

let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => { server?.close(); });

async function get(path: string, token?: string) {
  const res = await fetch(baseUrl + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.status;
}

// A route behind `requireSuperAdmin` and a route behind only `authenticate`.
const SUPER_ADMIN_ROUTE = '/api/v1/admin/customer-leads';
const ADMIN_ROUTE = '/api/v1/admin/orders';
const CUSTOMER_ROUTE = '/api/v1/auth/me';

describe('A/B. A customer token must never be accepted as an admin token', () => {
  test('A. customer JWT is rejected by a super-admin-only endpoint', async () => {
    assert.equal(await get(SUPER_ADMIN_ROUTE, customerToken()), 401);
  });

  test('B. customer JWT is rejected by an ordinary admin endpoint', async () => {
    assert.equal(await get(ADMIN_ROUTE, customerToken()), 401);
  });

  test('a customer token cannot read a customer lead by tampering with claims', async () => {
    // Same secret is used for both audiences, so only the `type` claim separates
    // them. Forging a role into a customer token must not help: the type check
    // runs first and rejects before the role is ever considered.
    const forged = signToken({
      id: 'customer-1', phone: '9876543210', type: CUSTOMER_TOKEN_TYPE, role: 'super_admin',
    });
    assert.equal(await get(SUPER_ADMIN_ROUTE, forged), 401);
  });
});

describe('C. Existing valid admin accounts keep working', () => {
  test('super_admin reaches both platform and admin endpoints', async () => {
    assert.equal(await get(SUPER_ADMIN_ROUTE, adminToken('super_admin')), 200);
    assert.equal(await get(ADMIN_ROUTE, adminToken('super_admin')), 200);
  });

  test(`all ${ADMIN_ROLES.length} non-super_admin roles are still accepted by authenticate`, async () => {
    for (const role of ADMIN_ROLES.filter((r: string) => r !== 'super_admin')) {
      assert.equal(await get(ADMIN_ROUTE, adminToken(role, OWN_STORE)), 200, `${role} rejected`);
    }
  });

  test('store_owner is still refused super-admin endpoints', async () => {
    assert.equal(await get(SUPER_ADMIN_ROUTE, adminToken('store_owner', OWN_STORE)), 403);
  });
});

describe('D/E. Cross-store team access is refused', () => {
  test('D. store_owner cannot read another store’s team', async () => {
    assert.equal(await get(`/api/v1/admin/stores/${OTHER_STORE}/team`, adminToken('store_owner', OWN_STORE)), 403);
  });

  test('D. store_owner cannot write another store’s team', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/stores/${OTHER_STORE}/team`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken('store_owner', OWN_STORE)}` },
      body: JSON.stringify({ username: 'intruder', password: 'password123', role: 'staff' }),
    });
    assert.equal(res.status, 403);
  });

  test('D. store_owner can still manage its own team', async () => {
    assert.equal(await get(`/api/v1/admin/stores/${OWN_STORE}/team`, adminToken('store_owner', OWN_STORE)), 200);
  });

  test('E. staff and sales_manager cannot reach an unauthorized store', async () => {
    for (const role of ['staff', 'sales_manager', 'delivery_staff']) {
      assert.equal(
        await get(`/api/v1/admin/stores/${OTHER_STORE}/team`, adminToken(role, OWN_STORE)),
        403, `${role} was not blocked`,
      );
    }
  });

  test('delivery_staff with a legitimate assignment keeps multi-store access', async () => {
    assignments.add(`admin-delivery_staff:${OTHER_STORE}`);
    assert.equal(
      await get(`/api/v1/admin/stores/${OTHER_STORE}/team`, adminToken('delivery_staff', OWN_STORE)),
      200,
    );
    assignments.delete(`admin-delivery_staff:${OTHER_STORE}`);
  });

  test('super_admin may reach any store’s team', async () => {
    assert.equal(await get(`/api/v1/admin/stores/${OTHER_STORE}/team`, adminToken('super_admin')), 200);
  });

  test('the guard actually consults store assignments', () => {
    assert.ok(
      queriesRun.some(q => q.includes('mart_admin_store_assignments')),
      'requireStoreAccess never queried mart_admin_store_assignments',
    );
  });
});

describe('F. A missing or unknown role must never become super_admin', () => {
  test('an admin-typed token with no role is refused, not elevated', async () => {
    const noRole = signToken({ id: 'admin-x', username: 'x', type: ADMIN_TOKEN_TYPE, storeId: null });
    assert.equal(await get(ADMIN_ROUTE, noRole), 403);
    assert.equal(await get(SUPER_ADMIN_ROUTE, noRole), 403);
  });

  test('an admin-typed token with an unknown role is refused', async () => {
    const bogus = signToken({ id: 'admin-x', username: 'x', role: 'root', type: ADMIN_TOKEN_TYPE });
    assert.equal(await get(ADMIN_ROUTE, bogus), 403);
    assert.equal(await get(SUPER_ADMIN_ROUTE, bogus), 403);
  });

  test('the empty-string role is refused, not treated as absent-and-elevated', async () => {
    const empty = signToken({ id: 'admin-x', username: 'x', role: '', type: ADMIN_TOKEN_TYPE });
    assert.equal(await get(SUPER_ADMIN_ROUTE, empty), 403);
  });

  test('a null role is refused', async () => {
    const nullRole = signToken({ id: 'admin-x', username: 'x', role: null, type: ADMIN_TOKEN_TYPE });
    assert.equal(await get(SUPER_ADMIN_ROUTE, nullRole), 403);
  });

  test('an unknown role cannot reach a cross-store team either', async () => {
    const bogus = signToken({ id: 'admin-x', username: 'x', role: 'root', type: ADMIN_TOKEN_TYPE });
    assert.equal(await get(`/api/v1/admin/stores/${OTHER_STORE}/team`, bogus), 403);
  });
});

describe('G. Missing or invalid token type is rejected', () => {
  test('a token with no type claim is refused on admin routes', async () => {
    // This is the pre-fix admin token shape. Rejecting it is deliberate: admins
    // must re-login once so every live token carries a type.
    const untyped = signToken({ id: 'admin-x', username: 'x', role: 'super_admin', storeId: null });
    assert.equal(await get(ADMIN_ROUTE, untyped), 401);
    assert.equal(await get(SUPER_ADMIN_ROUTE, untyped), 401);
  });

  test('an admin token is refused on a customer route', async () => {
    assert.equal(await get(CUSTOMER_ROUTE, adminToken('super_admin')), 401);
  });

  test('a garbage token is refused', async () => {
    assert.equal(await get(ADMIN_ROUTE, 'not-a-jwt'), 401);
  });

  test('a token signed with the wrong secret is refused', async () => {
    const wrong = jwt.sign({ id: 'a', role: 'super_admin', type: ADMIN_TOKEN_TYPE }, 'other-secret');
    assert.equal(await get(SUPER_ADMIN_ROUTE, wrong), 401);
  });

  test('a missing Authorization header is refused', async () => {
    assert.equal(await get(ADMIN_ROUTE), 401);
  });

  test('a non-Bearer scheme is refused', async () => {
    const res = await fetch(baseUrl + ADMIN_ROUTE, { headers: { Authorization: 'Basic abc123' } });
    assert.equal(res.status, 401);
  });
});

describe('Customer flow is untouched', () => {
  test('a genuine customer token still authenticates on customer routes', async () => {
    assert.equal(await get(CUSTOMER_ROUTE, customerToken()), 200);
  });
});
