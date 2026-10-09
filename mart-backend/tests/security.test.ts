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

// Fixture for the store row behind GET /settings/public. The open/closed state
// is computed from this plus the store_open setting, so tests drive it directly.
let storeFixture: Record<string, unknown> | null = null;
let settingsFixture: Record<string, string> = {};
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
      // Let a store-settings write actually resolve to a row, so the test can
      // prove the UPDATE was issued rather than merely that the guard let the
      // request through. The store id is the last parameter of the statement.
      if (/UPDATE mart_stores/.test(text)) {
        return { rows: [{ id: params?.[params.length - 1], name: 'Test Store', opening_hours: {} }] };
      }
      if (/FROM mart_stores/.test(text)) {
        return { rows: storeFixture ? [storeFixture] : [] };
      }
      if (/FROM mart_settings/.test(text)) {
        return { rows: Object.entries(settingsFixture).map(([key, value]) => ({ key, value })) };
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

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.status;
}

async function put(path: string, body: unknown, token?: string) {
  const res = await fetch(baseUrl + path, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.status;
}

// A route behind `requireSuperAdmin` and a route behind only `authenticate`.
const SUPER_ADMIN_ROUTE = '/api/v1/admin/customer-leads';
// The Phase 1 customer funnel aggregates the same lead data, so it is held to
// the identical bar: super_admin only, enforced by middleware not by the UI.
const SUPER_ADMIN_FUNNEL_ROUTE = '/api/v1/admin/customer-funnel';
const SUPER_ADMIN_FUNNEL_EXTENDED_ROUTE = '/api/v1/admin/customer-funnel/extended';
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

describe('G. The customer funnel stays super-admin only', async () => {
  test('a customer token cannot read the funnel', async () => {
    assert.equal(await get(SUPER_ADMIN_FUNNEL_ROUTE, customerToken()), 401);
  });

  test('every non-super_admin admin role is refused the funnel', async () => {
    for (const role of ADMIN_ROLES.filter((r: string) => r !== 'super_admin')) {
      assert.equal(
        await get(SUPER_ADMIN_FUNNEL_ROUTE, adminToken(role, OWN_STORE)),
        403, `${role} was not blocked from the funnel`,
      );
    }
  });

  test('super_admin can read the funnel', async () => {
    assert.equal(await get(SUPER_ADMIN_FUNNEL_ROUTE, adminToken('super_admin')), 200);
  });

  test('the extended funnel view is held to the same bar', async () => {
    assert.equal(await get(SUPER_ADMIN_FUNNEL_EXTENDED_ROUTE, customerToken()), 401);
    for (const role of ADMIN_ROLES.filter((r: string) => r !== 'super_admin')) {
      assert.equal(await get(SUPER_ADMIN_FUNNEL_EXTENDED_ROUTE, adminToken(role, OWN_STORE)), 403, `${role} was not blocked`);
    }
    assert.equal(await get(SUPER_ADMIN_FUNNEL_EXTENDED_ROUTE, adminToken('super_admin')), 200);
  });

  test('the storefront event endpoints stay anonymous and expose no data on GET', async () => {
    // These are deliberately unauthenticated write-only endpoints: they accept
    // events, they never return any. A read must not be possible even though
    // no credential is required to post one.
    for (const path of ['/api/v1/funnel/event', '/api/v1/funnel/cart', '/api/v1/funnel/campaign']) {
      assert.equal(await get(path, customerToken()), 404, `${path} must not be readable`);
    }
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

  test('E. staff and store_manager cannot reach an unauthorized store', async () => {
    for (const role of ['staff', 'store_manager', 'delivery_staff']) {
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

// Regression cover for a shipped bug: the Settings page saved opening hours
// through PUT /admin/stores/:id, which is requireSuperAdmin, so a store owner
// or manager received 403 and the write silently never happened. The page now
// calls PUT /admin/stores/:id/settings. Both halves of that are asserted here so
// neither can drift back.
describe('H. Store owners can save their own opening hours', () => {
  const OWN_SETTINGS = `/api/v1/admin/stores/${OWN_STORE}/settings`;
  const HOURS = { mon: { open: '08:00', close: '20:00', closed: false } };

  test('a store owner can write opening hours to their own store', async () => {
    queriesRun.length = 0;
    assert.equal(await put(OWN_SETTINGS, { openingHours: HOURS }, adminToken('store_owner', OWN_STORE)), 200);
    const wrote = queriesRun.some((q: string) => /UPDATE mart_stores/.test(q) && q.includes('opening_hours'));
    assert.ok(wrote, 'no UPDATE of opening_hours was issued');
  });

  test('a store_manager can write opening hours to their own store', async () => {
    queriesRun.length = 0;
    assert.equal(await put(OWN_SETTINGS, { openingHours: HOURS }, adminToken('store_manager', OWN_STORE)), 200);
    assert.ok(queriesRun.some((q: string) => /UPDATE mart_stores/.test(q)), 'nothing was written');
  });

  test('a store owner cannot write to another store', async () => {
    queriesRun.length = 0;
    assert.equal(await put(`/api/v1/admin/stores/${OTHER_STORE}/settings`, { openingHours: HOURS },
      adminToken('store_owner', OWN_STORE)), 403);
    assert.ok(!queriesRun.some((q: string) => /UPDATE mart_stores/.test(q)), 'a cross-store write reached the database');
  });

  test('super_admin can still write any store through this endpoint', async () => {
    assert.equal(await put(`/api/v1/admin/stores/${OTHER_STORE}/settings`, { openingHours: HOURS },
      adminToken('super_admin')), 200);
  });

  test('the super-admin store endpoint stays closed to non-super-admins', async () => {
    // This is the route the buggy page used. It must remain 403, otherwise
    // fixing the page would have quietly opened a cross-store write.
    assert.equal(await put(`/api/v1/admin/stores/${OWN_STORE}`, { openingHours: HOURS },
      adminToken('store_owner', OWN_STORE)), 403);
  });

  test('an unauthenticated caller cannot save hours', async () => {
    queriesRun.length = 0;
    assert.equal(await put(OWN_SETTINGS, { openingHours: HOURS }), 401);
    assert.ok(!queriesRun.some((q: string) => /UPDATE mart_stores/.test(q)), 'an anonymous write reached the database');
  });
});

// mart-hub has no test runner, so the frontend half of the opening-hours bug
// (the page calling the super-admin-only `update()` instead of `updateSettings()`)
// would otherwise be completely unguarded. This is a source-level guard, not a
// behavioural test -- it checks which API method the page reaches for. The real
// fix is a runner in mart-hub; this exists because there isn't one.
describe('I. The Settings page calls the store-owner endpoint', () => {
  const path = require('path').resolve(__dirname, '../../mart-hub/src/pages/SettingsPage.tsx');
  const src = require('fs').readFileSync(path, 'utf8');

  test('the branding/opening-hours save uses updateSettings', () => {
    assert.ok(src.includes('storesApi.updateSettings('),
      'SettingsPage no longer calls storesApi.updateSettings - the save will 403 for store owners again');
  });

  test('the branding/opening-hours save does not use the super-admin-only update', () => {
    // Any bare `storesApi.update(` in this file is the bug returning.
    assert.ok(!/storesApi\.update\(/.test(src),
      'SettingsPage calls the super-admin-only storesApi.update, which 403s for store owners');
  });
});

// The same page had a second, quieter version of that bug: two save paths over
// two different tables (mart_settings and mart_stores) on one long scroll, with
// the opening-hours editor inside the branding card. Editing the hours and
// pressing the top "Save Changes" wrote mart_settings and reported success, so
// the hours edit was simply discarded. Splitting into tabs removes the only
// mechanism that could cause it -- a save button that does not cover the field
// under the cursor -- so these assert the split rather than the symptom.
describe('I2. The Settings page saves each scope it shows', () => {
  const path = require('path').resolve(__dirname, '../../mart-hub/src/pages/SettingsPage.tsx');
  const src = require('fs').readFileSync(path, 'utf8');

  test('settings are split into the four scopes', () => {
    for (const id of ['store', 'hours', 'zones', 'payments']) {
      assert.ok(src.includes(`'${id}'`),
        `the ${id} settings tab is missing`);
    }
  });

  test('the opening-hours editor and the open/closed switch are on the same tab', () => {
    // Isolate the hours-tab branch: from its guard to the next tab's guard.
    const start = src.indexOf("{activeTab === 'hours'");
    assert.ok(start > -1, 'the hours tab is missing');
    const rest = src.slice(start);
    const end = rest.indexOf("{activeTab ===", 1);
    const branch = end > -1 ? rest.slice(0, end) : rest;

    // Assert on the per-day editor itself, not the section heading: the heading
    // would still match with the editor stranded on another tab, which is the
    // exact regression this is meant to catch.
    assert.ok(/DAYS\.map\(/.test(branch),
      'the per-day opening-hours editor is no longer on the hours tab');
    assert.ok(/updateHours\(/.test(branch),
      'the hours editor is on the hours tab but its edits are made elsewhere');
    assert.ok(branch.includes("store_open"),
      'the store_open override is no longer on the hours tab, so the schedule and ' +
      'the switch that overrides it would be saved from different buttons again');
  });

  test('the Save button is disabled while the tab is clean', () => {
    // Without this the button is always live, and clicking it re-writes values
    // nobody changed -- including a stale `openingHours` object from load time.
    assert.ok(src.includes('disabled={saving || !isDirty(activeTab)}'),
      'the settings Save button is no longer gated on the active tab being dirty');
  });

  test('unsaved edits warn before a browser-level navigation', () => {
    assert.ok(src.includes("addEventListener('beforeunload'"),
      'no beforeunload guard, so a refresh silently discards unsaved settings');
  });

  test('the zones tab has no bulk save', () => {
    // Zones persist per create/edit/delete. A bulk save over them would be a
    // button that appears to cover a list it cannot actually write.
    assert.ok(src.includes("{activeTab !== 'zones' && ("),
      'the zones tab appears to have gained a bulk save it cannot honour');
  });
});

// Migration 056 made store_manager a real role and retired sales_manager.
// store_manager had been listed throughout the hub frontend since commit
// 8a719e5 while the database rejected it, so every one of those code paths was
// dead. These assertions cover both halves of that change plus the validation
// gaps it exposed.
describe('J. The role matrix after migration 056', () => {
  const OWN_SETTINGS = `/api/v1/admin/stores/${OWN_STORE}/settings`;
  const HOURS = { mon: { open: '08:00', close: '20:00', closed: false } };

  test('store_manager is an accepted role, not just a frontend label', () => {
    const { ADMIN_ROLES, isValidAdminRole } = require('../src/middleware');
    assert.ok((ADMIN_ROLES as readonly string[]).includes('store_manager'),
      'store_manager is missing from ADMIN_ROLES, so no such account can authenticate');
    assert.equal(isValidAdminRole('store_manager'), true);
  });

  test('sales_manager is retired and no longer accepted', () => {
    const { ADMIN_ROLES, isValidAdminRole } = require('../src/middleware');
    assert.ok(!(ADMIN_ROLES as readonly string[]).includes('sales_manager'),
      'sales_manager was retired in migration 056 but is still accepted');
    assert.equal(isValidAdminRole('sales_manager'), false);
  });

  test('the role validator rejects unknown and non-string values', () => {
    const { isValidAdminRole } = require('../src/middleware');
    for (const bad of ['', 'admin', 'STORE_MANAGER', 'store manager', null, undefined, 7, {}, ['store_manager']]) {
      assert.equal(isValidAdminRole(bad), false, `${JSON.stringify(bad)} was wrongly accepted`);
    }
  });

  test('a store_manager can save opening hours on their own store', async () => {
    queriesRun.length = 0;
    assert.equal(await put(OWN_SETTINGS, { openingHours: HOURS }, adminToken('store_manager', OWN_STORE)), 200);
    assert.ok(queriesRun.some((q: string) => /UPDATE mart_stores/.test(q) && q.includes('opening_hours')));
  });

  test('a retired sales_manager token is rejected outright', async () => {
    // authenticate must fail closed, so a stale token cannot keep working.
    assert.equal(await get('/api/v1/admin/orders', adminToken('sales_manager', OWN_STORE)), 403);
  });

  test('creating a user as store_manager is accepted, not a 500', async () => {
    // Previously the create whitelist was wider than the database constraint, so
    // this reached Postgres and died as a check violation surfaced as a 500.
    assert.equal(await post('/api/v1/admin/users',
      { username: 'newmgr', password: 'longenough1', role: 'store_manager', storeId: OWN_STORE },
      adminToken('super_admin')), 201);
  });

  test('creating a user with a retired or invented role is a 400 with a readable message', async () => {
    for (const role of ['sales_manager', 'wizard', '']) {
      assert.equal(await post('/api/v1/admin/users',
        { username: `u_${role || 'blank'}`, password: 'longenough1', role, storeId: OWN_STORE },
        adminToken('super_admin')), 400, `role "${role}" was not rejected cleanly`);
    }
  });

  test('updating a user to a retired role is a 400 rather than a 500', async () => {
    // adminUpdateUser had no role validation at all; only the DB CHECK stopped it.
    assert.equal(await put('/api/v1/admin/users/33333333-3333-3333-3333-333333333333',
      { role: 'sales_manager' }, adminToken('super_admin')), 400);
  });

  test('TeamService.addToStore refuses an unusable role even when called directly', async () => {
    // addToStoreTeam already validates at the edge, so this guard is shadowed
    // through the HTTP path and unreachable via the controller. It is still
    // worth pinning: the column gained a CHECK in 056, so a direct caller
    // passing a typo would otherwise surface as a raw constraint violation.
    const { TeamService } = require('../src/services/team.service');
    queriesRun.length = 0;
    await assert.rejects(
      () => TeamService.addToStore('a', 'b', 'wizard', 'c'),
      /Role must be one of/,
    );
    assert.ok(!queriesRun.some((q: string) => /INSERT INTO mart_admin_store_assignments/.test(q)),
      'an invalid assignment role reached the database');
  });

  test('TeamService.updateAssignment refuses an unusable role', async () => {
    const { TeamService } = require('../src/services/team.service');
    queriesRun.length = 0;
    await assert.rejects(
      () => TeamService.updateAssignment('a', 'b', { role: 'sales_manager' }),
      /Role must be one of/,
    );
    assert.ok(!queriesRun.some((q: string) => /UPDATE mart_admin_store_assignments/.test(q)),
      'a retired role reached the assignments table');
  });

  test('TeamService.createAndAssign enforces the password rule the controller mirrors', async () => {
    const { TeamService } = require('../src/services/team.service');
    queriesRun.length = 0;
    await assert.rejects(
      () => TeamService.createAndAssign({
        username: 'shorty', password: 'short', role: 'store_manager',
        storeId: 's', assignedBy: 'a',
      }),
      /Password must be at least 8 characters/,
    );
    assert.ok(!queriesRun.some((q: string) => /INSERT INTO mart_admins/.test(q)),
      'a short password reached the database');
  });

  test('the team create path rejects a bad role and a short password before touching the database', async () => {
    queriesRun.length = 0;
    for (const body of [
      { username: 'a1', password: 'longenough1', role: 'wizard' },
      { username: 'a2', password: 'short', role: 'store_manager' },
    ]) {
      assert.equal(await post(`/api/v1/admin/stores/${OWN_STORE}/team`, body,
        adminToken('store_owner', OWN_STORE)), 400, `${JSON.stringify(body)} was not rejected`);
    }
    assert.ok(!queriesRun.some((q: string) => /INSERT INTO mart_admins/.test(q)),
      'an invalid team member reached the database');
  });
});

// The schedule itself is covered exhaustively in storeHours.test.ts. What matters
// here is the wiring: the storefront must be able to read the answer from a public
// endpoint, because that is what removes schedule logic from the browser.
describe('K. The public settings endpoint reports whether the store is open', () => {
  const SHOP = '00000000-0000-0000-0000-000000000001';
  const allDay = (open: string, close: string) => Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, { open, close, closed: false }]),
  );

  const readOpenState = async () => {
    const res = await fetch(`${baseUrl}/api/v1/settings/public?storeId=${SHOP}`);
    assert.equal(res.status, 200, 'the public settings endpoint must not require a token');
    const body = await res.json();
    assert.equal(body.success, true);
    return body.data.openState;
  };

  test('exposes openState alongside the existing settings keys', async () => {
    storeFixture = { id: SHOP, name: 'Test Store', openingHours: allDay('00:00', '23:59') };
    settingsFixture = { store_name: 'Test Store', store_open: 'true' };
    const state = await readOpenState();
    assert.equal(typeof state, 'object', 'openState is missing from the response');
    assert.ok('isOpen' in state && 'nextOpenAt' in state && 'nextOpenLabel' in state);
  });

  test('reports open when the schedule and the manual flag both allow it', async () => {
    storeFixture = { id: SHOP, name: 'Test Store', openingHours: allDay('00:00', '23:59') };
    settingsFixture = { store_open: 'true' };
    assert.equal((await readOpenState()).isOpen, true);
  });

  test('reports closed as a manual closure when store_open is false', async () => {
    // Hours would otherwise permit trading, so this isolates the manual flag.
    storeFixture = { id: SHOP, name: 'Test Store', openingHours: allDay('00:00', '23:59') };
    settingsFixture = { store_open: 'false' };
    const state = await readOpenState();
    assert.equal(state.isOpen, false);
    assert.equal(state.closedReason, 'manual');
    assert.equal(state.nextOpenLabel, null, 'a manual closure must not promise a reopening');
  });

  test('reports closed as outside_hours when the schedule excludes now', async () => {
    // 00:00-00:01 never contains the current time, whatever it is.
    storeFixture = { id: SHOP, name: 'Test Store', openingHours: allDay('00:00', '00:01') };
    settingsFixture = { store_open: 'true' };
    const state = await readOpenState();
    assert.equal(state.isOpen, false);
    assert.equal(state.closedReason, 'outside_hours');
    assert.ok(state.nextOpenLabel, 'being outside hours should still offer a next opening');
  });

  test('fails closed when the store row is missing entirely', async () => {
    // A missing store must not read as "trading".
    storeFixture = null;
    settingsFixture = {};
    const state = await readOpenState();
    assert.equal(state.isOpen, false);
    assert.equal(state.closedReason, 'manual');
  });

  test('the storefront can drive its refetch timer from nextOpenAt', async () => {
    storeFixture = { id: SHOP, name: 'Test Store', openingHours: allDay('00:00', '00:01') };
    settingsFixture = { store_open: 'true' };
    const state = await readOpenState();
    assert.ok(state.nextOpenAt, 'nextOpenAt is what the storefront schedules against');
    assert.ok(!Number.isNaN(Date.parse(state.nextOpenAt)), 'nextOpenAt must be a parseable instant');
    assert.ok(Date.parse(state.nextOpenAt) > Date.now(), 'the next opening must be in the future');
  });
});

// The login screens told customers "We'll call you to confirm your number" and
// Delivery is by voice call today; SMS is announced but not yet available. The
// original defect was the opposite of this: the copy named "call" while
// customerAuth.service.ts posted to /SMS/, and "confirm your number" implied the
// call verified the customer rather than reading out a code to type.
//
// The copy now names the call on purpose, so the guard inverts: it pins that
// both apps name the same channel, and - the real risk - that any SMS mention
// stays qualified as "coming soon", so nobody advertises SMS the day before it
// is actually routed.
describe('K. Login copy states the real delivery channel', () => {
  const read = (p: string) => require('fs').readFileSync(require('path').resolve(__dirname, '../..', p), 'utf8');

  // The web login surface is split across two files: LoginModal holds the overlay
  // chrome (max-w-md, the scroll container, the dialog semantics) and LoginFlow
  // holds the steps, copy and controls. Login used to be one file; splitting it
  // meant these guards were reading a 28-line wrapper and passing/vailing on the
  // wrong thing. Assertions below may legitimately target either, so read both.
  const WEB_LOGIN_FILES = [
    'mart-user/src/components/LoginModal.tsx',
    'mart-user/src/components/LoginFlow.tsx',
  ];
  const readWebLogin = () => WEB_LOGIN_FILES.map(read).join('\n');

  const APPS = [
    ['web', readWebLogin],
    ['native', () => read('mart-mobile/app/(auth)/login.tsx')],
  ] as const;

  test('both apps promise the code arrives by call', () => {
    for (const [name, getSrc] of APPS) {
      const src = getSrc();
      assert.ok(/call you with a 6-digit code/i.test(src),
        `${name}: the login screens no longer say the code arrives by call`);
    }
  });

  test('any SMS mention stays advertised as coming soon', () => {
    // This is the one that matters. If someone drops the qualifier to ship
    // "SMS OTP enabled" before the backend routes an SMS, the promise is a lie
    // on exactly the screen a customer is waiting on.
    for (const [name, getSrc] of APPS) {
      const src = getSrc();
      if (!/sms/i.test(src)) continue;
      assert.ok(/sms otp coming soon/i.test(src),
        `${name}: mentions SMS without the "coming soon" qualifier - SMS is not live yet`);
    }
  });

  test('the SMS teaser is styled as a small subtitle, not body copy', () => {
    // It is a promise about the future, so it must not out-shout the live fact.
    assert.ok(/text-\[11px\][^>]*>\s*SMS OTP Coming soon/.test(read('mart-user/src/components/LoginModal.tsx')),
      'the web SMS teaser is no longer rendered as a small subtitle');
    assert.ok(/text-\[10px\][^>]*>\s*SMS OTP Coming soon/.test(read('mart-mobile/app/(auth)/login.tsx')),
      'the native SMS teaser is no longer rendered as a small subtitle');
  });

  test('the promise sits on the code-entry step, not the phone step', () => {
    // Layout decision: the phone step is a single input, and a second block
    // there competed with it. The promise belongs next to the empty code field,
    // where the customer is actually waiting for the call.
    for (const [name, getSrc] of APPS) {
      const src = getSrc();
      const heading = src.search(/Enter (the verification code|OTP)/i);
      const promise = src.search(/call you with a 6-digit code/i);
      assert.ok(heading >= 0, `${name}: no code-entry heading found`);
      assert.ok(promise > heading,
        `${name}: the delivery promise must render after the code-entry heading, ` +
        `not on the phone-number step`);
    }
  });

  test('the copy does not imply the call confirms the customer', () => {
    // A voice OTP is read out to be typed. "Confirm your number" makes customers
    // wait for a call that ends without them typing anything.
    for (const [name, getSrc] of APPS) {
      assert.ok(!/confirm your number/i.test(getSrc()),
        `${name}: the copy implies the call confirms the customer instead of delivering a code`);
    }
  });

  test('neither screen claims the code is good for a single attempt', () => {
    // 2Factor allows three OTP attempts. "only this once" invents scarcity and
    // strands customers mid-auth when the code expires.
    for (const [name, getSrc] of APPS) {
      assert.ok(!/\bonly this once\b/i.test(getSrc()),
        `${name}: claims the code works once, but the provider allows retries`);
    }
  });

  // The market convention is not the sentence "we will send you a 6-digit code",
  // it is the layout: an OTP heading, the destination number, a change link, and
  // a length-bounded input. Blinkit's own screen reads "Enter 4 digit code sent
  // to your phone +91-...". Asserting a fixed phrase here would fail on correct
  // copy, so this checks the structure instead.
  test('both apps present a recognisable code-entry step', () => {
    for (const [name, getSrc] of APPS) {
      const src = getSrc();
      assert.ok(/Enter (the verification code|OTP)/i.test(src),
        `${name}: the code-entry screen has no heading`);
      // Both apps show the destination number; mobile labels it ("Sent to
      // +91 ..."), web shows it under the promise line. The convention is that
      // the customer can see which number is being called, not the exact label.
      assert.ok(/Sent to/i.test(src) || /\+91\s*\{?maskedPhone|\+91\s*\{?phone/i.test(src),
        `${name}: the code-entry screen does not show which number is being called`);
      assert.ok(/maxLength=\{6\}/.test(src),
        `${name}: the code input is not bounded to 6 digits`);
      assert.ok(/Change|Edit/i.test(src),
        `${name}: no way to go back and correct the number`);
    }
  });

  test('the backend delivery channel matches what the copy promises', () => {
    // This is the coupling the whole section exists to catch. The copy says
    // "via call"; if the provider endpoint is ever switched back to SMS, or SMS
    // is switched on, this fails and the copy has to be revisited in the same
    // change rather than drifting.
    const src = read('mart-backend/src/services/customerAuth.service.ts');
    const used = [...src.matchAll(/\$\{TWO_FACTOR_BASE\}\/\$\{apiKey\}\/([A-Z]+)/g)].map(m => m[1]);
    assert.ok(used.length > 0, 'no 2Factor delivery endpoint found to check against');
    for (const channel of new Set(used)) {
      assert.ok(['SMS', 'VOICE'].includes(channel),
        `unexpected 2Factor delivery channel: ${channel}`);
    }
  });
});

// The login panel is the one screen that must never need scrolling on a small
// phone, because a customer mid-checkout meets it at the worst possible moment.
// Measured at 375x667, the phone step came to ~666px -- inside the viewport by
// zero pixels, so any validation error pushed the primary button off screen.
//
// These are the two heaviest decorations that caused it: an 80px brand logo
// (the OTP step already used 48px for the same asset) and a 56px icon tile
// stacked directly beneath that logo, for 76px of imagery above the heading.
// Pinning them keeps the panel compact, and fails loudly if someone re-adds a
// decorative block that pushes the sign-in button below the fold.
describe('L. Login panel stays compact enough for small screens', () => {
  const read = (p: string) => require('fs').readFileSync(require('path').resolve(__dirname, '../..', p), 'utf8');

  // The web login surface is split across two files: LoginModal holds the overlay
  // chrome (max-w-md, the scroll container, the dialog semantics) and LoginFlow
  // holds the steps, copy and controls. Login used to be one file; splitting it
  // meant these guards were reading a 28-line wrapper and passing/vailing on the
  // wrong thing. Assertions below may legitimately target either, so read both.
  const WEB_LOGIN_FILES = [
    'mart-user/src/components/LoginModal.tsx',
    'mart-user/src/components/LoginFlow.tsx',
  ];
  const readWebLogin = () => WEB_LOGIN_FILES.map(read).join('\n');
  const src = readWebLogin();

  test('the brand mark is not oversized', () => {
    assert.ok(!/h-20/.test(src),
      'an h-20 (80px) logo is back; the brand mark is capped at h-12 (48px)');
  });

  test('no large decorative icon tile is stacked above the heading', () => {
    assert.ok(!/grid h-14 w-14/.test(src),
      'a 56px icon tile is back above the phone-step heading, on top of the logo');
  });

  test('the panel stays scrollable so nothing is ever truncated', () => {
    // Compactness is an optimisation, not a licence to clip. If content ever
    // does exceed a short viewport, it must scroll rather than cut off the
    // submit button.
    // Anchored to the inner scroll container, not the whole file: the overlay
    // behind the panel also carries overflow-y-auto, so a bare file-wide check
    // would pass even after the panel itself stopped scrolling.
    const inner = src.match(/<div className="flex flex-1 flex-col[^"]*"[^>]*>/);
    assert.ok(inner, 'the inner login panel container was not found');
    assert.ok(/overflow-y-auto/.test(inner[0]),
      'the login panel no longer scrolls, so long content would be unreachable');
    assert.ok(/max-w-md/.test(src), 'the login panel lost its max width');
  });

  test('the sign-in controls keep accessible touch targets', () => {
    // Shrinking the panel must not shrink what people have to hit: 44px is the
    // WCAG 2.2 target-size floor and these are the only way in.
    // Matched by slicing to the next </button> rather than to the next ">",
    // because a ">" inside an attribute value (resendTimer > 0) would end the
    // match before the class list is reached.
    const buttonWith = (marker: string) => {
      const at = src.indexOf(marker);
      assert.ok(at >= 0, `no element found for ${marker}`);
      return src.slice(at, src.indexOf('</button>', at));
    };

    assert.ok(/min-h-\[44px\]/.test(buttonWith('onClick={handleResend}')),
      'the resend control dropped below the 44px touch-target floor');
    // The cross was removed: "Continue as guest" is now the only way out of the
    // flow on every step, so the floor belongs to it instead.
    assert.ok(/min-h-\[44px\]/.test(buttonWith('onClick={handleGuest}')),
      'the continue-as-guest control dropped below the 44px touch-target floor');
    assert.ok(/min-h-\[44px\]|min-w-\[44px\]/.test(buttonWith('{maskedPhone}')),
      'the edit-number control dropped below the 44px touch-target floor');

    const primary = src.match(/const primaryBtn =\s*'([^']+)'/);
    assert.ok(primary && !/py-2(\.5)?\b/.test(primary[1]),
      'the primary button is too short to stay above the 44px touch-target floor');
  });

  // Reassurance shown immediately before a phone number is asked for is a trust
  // signal, not decoration, so it is pinned here: it is a single batched block
  // with one heading and one subtitle (not two competing rows, which cost
  // 44px of the panel budget), and it must stay on the phone step.
  test('the privacy note is one batched block with a heading and subtitle', () => {
    const block = src.match(/<div className="mt-3 rounded-2xl border border-emerald-100[\s\S]*?<\/div>\s*<\/div>/);
    assert.ok(block, 'the batched privacy block was not found on the phone step');
    assert.ok(/font-bold[^"]*">\s*<ShieldCheck[\s\S]*?Your number is private\./.test(block[0]),
      'the privacy block no longer has a bold heading above its detail');
    assert.ok(/pl-5[^"]*">\s*We never share it\./.test(block[0]),
      'the privacy subtitle is missing or no longer indented under the heading');
    assert.ok(!/<Lock/.test(src),
      'the second lock icon is back; the batched block carries a single icon');
  });

  test('the privacy note still makes both promises', () => {
    for (const claim of [/Your number is private/i, /never share/i, /no spam/i]) {
      assert.ok(claim.test(src), `the privacy note dropped its "${claim}" promise`);
    }
  });
});
