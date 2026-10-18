/**
 * Admin session lifetime regression tests.
 *
 * Scope: the "stay logged in until I log out manually" contract —
 *   * the JWT lasts the configured lifetime (90 days),
 *   * the mart_admin_sessions row is stamped from the token's own exp (the
 *     middleware checks both, so they must never drift),
 *   * a new login does NOT revoke older sessions (the old 2-session cap made
 *     every re-login kick the admin off every other device: the next request
 *     got 401 and the hub bounced to /login),
 *   * POST /admin/logout does revoke this device's session, which is now the
 *     only way a session ends before expiry.
 *
 * Harness: same as security.test.ts — real Express app, pg.Pool stubbed.
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
process.env.MART_JWT_SECRET = 'admin-sessions-test-secret';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
// Pin the lifetime so the assertion is deterministic regardless of any local
// .env.local override (dotenv never replaces an already-set variable).
process.env.MART_JWT_EXPIRES_IN = '90d';

const require = createRequire(__filename);

// ── Stub the database layer ─────────────────────────────────────────────────
interface CapturedQuery { text: string; params?: unknown[] }

const ADMIN_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const bcrypt = require('bcryptjs');
const PASSWORD_HASH = bcrypt.hashSync('correct horse', 4);

let queriesRun: CapturedQuery[] = [];
// Session rows the stub pretends are active for the authenticate middleware.
let activeSessionJtis = new Set<string>();
// Fixture for the mart_admins lookup.
let adminRow: Record<string, unknown> | null = {
  id: ADMIN_ID, username: 'owner', password_hash: PASSWORD_HASH,
  name: 'Store Owner', email: null, phone: null,
  role: 'super_admin', store_id: null, is_active: true,
};

const pg = require('pg');
(pg.Pool.prototype as any).connect = async function () {
  return {
    query: async (text: string, params?: unknown[]) => {
      queriesRun.push({ text, params });
      if (/FROM mart_admins WHERE username/.test(text)) {
        return { rows: adminRow ? [adminRow] : [] };
      }
      if (/FROM mart_admins WHERE id =/.test(text)) {
        return { rows: adminRow ? [adminRow] : [] };
      }
      if (/INSERT INTO mart_admin_sessions/.test(text)) return { rows: [] };
      // `NOW()` must be escaped — unescaped parens are an empty regex group
      // and would never match the literal parentheses in the SQL.
      if (/UPDATE mart_admin_sessions SET is_active = false, revoked_at = NOW\(\) WHERE token_jti/.test(text)) {
        const jti = params?.[0];
        if (typeof jti === 'string') activeSessionJtis.delete(jti);
        return { rows: [] };
      }
      // The authenticate middleware's session check.
      if (/FROM mart_admin_sessions WHERE token_jti/.test(text)) {
        const jti = params?.[0];
        return { rows: activeSessionJtis.has(jti as string) ? [{ id: 'session-1' }] : [] };
      }
      if (/adminHasActiveSubscription|FROM mart_store_subscriptions/.test(text)) return { rows: [{ ok: 1 }] };
      return { rows: [] };
    },
    release: () => {},
  };
};

const app = (require('../src/app') as { default: any }).default;
const jwt = require('jsonwebtoken');
const { ADMIN_TOKEN_TYPE } = require('../src/middleware');

const SECRET = 'admin-sessions-test-secret';

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
  activeSessionJtis = new Set();
  adminRow = {
    id: ADMIN_ID, username: 'owner', password_hash: PASSWORD_HASH,
    name: 'Store Owner', email: null, phone: null,
    role: 'super_admin', store_id: null, is_active: true,
  };
});

async function login(): Promise<{ token: string; jti: string }> {
  const res = await fetch(`${baseUrl}/api/v1/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'correct horse' }),
  });
  assert.equal(res.status, 200, 'login must succeed');
  const body = await res.json() as { data: { token: string } };
  const payload = jwt.decode(body.data.token) as { jti: string };
  // The middleware only passes a token whose session row is active; register
  // it the way the real INSERT would.
  activeSessionJtis.add(payload.jti);
  return { token: body.data.token, jti: payload.jti };
}

describe('Admin session lifetime', () => {
  test('the issued JWT lasts the configured 90 days', async () => {
    const { token } = await login();
    const payload = jwt.decode(token) as { exp: number; iat: number };
    const lifetimeDays = (payload.exp - payload.iat) / 86400;
    assert.equal(Math.round(lifetimeDays), 90);
  });

  test('the session row expires exactly when the token does', async () => {
    const { token, jti } = await login();
    const payload = jwt.decode(token) as { exp: number };
    const insert = queriesRun.find(q => /INSERT INTO mart_admin_sessions/.test(q.text))!;
    assert.ok(insert, 'a session row was recorded');
    assert.equal(insert.params?.[0], ADMIN_ID);
    assert.equal(insert.params?.[1], jti);
    const expiresAt = insert.params?.[4] as Date;
    assert.ok(expiresAt instanceof Date || typeof expiresAt === 'string' || typeof expiresAt === 'number');
    assert.equal(new Date(expiresAt as any).getTime(), payload.exp * 1000,
      'the row is stamped from the token exp — the middleware check and the JWT cannot drift');
  });
});

describe('A login never kicks other devices off', () => {
  test('a second login does not revoke the first session', async () => {
    const first = await login();
    queriesRun = [];
    const second = await login();

    assert.ok(
      !queriesRun.some(q => /UPDATE mart_admin_sessions SET is_active = false, revoked_at = NOW\(\) WHERE id/.test(q.text)),
      'no session is revoked by logging in again',
    );
    assert.notEqual(first.jti, second.jti, 'each login gets its own session');

    // And the first token is still accepted by an authenticated endpoint.
    const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${first.token}` },
    });
    assert.equal(res.status, 200, 'the earlier session still works after a new login');
  });

  test('repeated logins on one phone do not accumulate revocations', async () => {
    for (let i = 0; i < 5; i++) await login();
    assert.ok(
      !queriesRun.some(q => /is_active = false/.test(q.text)),
      'five logins in a row revoke nothing',
    );
  });
});

describe('Manual logout is the only way a session ends early', () => {
  test('POST /admin/logout revokes exactly this device’s session', async () => {
    const { token, jti } = await login();
    const res = await fetch(`${baseUrl}/api/v1/admin/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const revoke = queriesRun.find(q => /UPDATE mart_admin_sessions SET is_active = false/.test(q.text))!;
    assert.ok(revoke, 'the session row was revoked');
    assert.equal(revoke.params?.[0], jti);

    // The revoked session is rejected from then on.
    const again = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(again.status, 401, 'after manual logout the token no longer works');
  });

  test('logging out on one device leaves the other device signed in', async () => {
    const phone = await login();
    const desktop = await login();
    await fetch(`${baseUrl}/api/v1/admin/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${phone.token}` },
    });
    const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${desktop.token}` },
    });
    assert.equal(res.status, 200, 'the desktop session survives the phone logging out');
  });
});
