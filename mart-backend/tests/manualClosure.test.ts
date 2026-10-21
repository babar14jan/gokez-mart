/**
 * A manual closure has to say when it lifts.
 *
 * A store that says it is shut without saying when it reopens leaves the
 * customer with a store that is simply closed and no way to tell whether it
 * will ever open. The API refuses that state, and the check is on the merged
 * result rather than on the request body — clearing the closure sends only
 * the switch, with the times left as they were.
 *
 * Node's `node:test` via `tsx`, with `pg.Pool.prototype.connect` stubbed so
 * the real SQL is captured and no database is needed.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'manual-closure-test-secret';

const require = createRequire(__filename);

interface Call { text: string; params: unknown[] }

let calls: Call[] = [];
/** What the database already holds for the store. */
let stored: Record<string, string> = {
  store_open: 'true',
  store_closed_from: '',
  store_closed_until: '',
};

const pg = require('pg');
(pg.Pool.prototype as any).connect = async function () {
  return {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/key = ANY/.test(text)) {
        const wanted: string[] = params[1] || [];
        return {
          rows: Object.entries(stored)
            .filter(([k]) => wanted.includes(k))
            .map(([key, value]) => ({ key, value })),
        };
      }
      if (/INSERT INTO mart_settings/i.test(text)) {
        // Record the write so a second call sees the merged result.
        const value = params[0];
        const key = params[2];
        stored[key] = String(value);
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => undefined,
    end: async () => undefined,
  };
};

describe('a manual closure needs both times', () => {
  beforeEach(() => {
    calls = [];
    stored = { store_open: 'true', store_closed_from: '', store_closed_until: '' };
  });

  test('closing the store without any times is refused', async () => {
    const { adminUpdateSettings } = await import('../src/controllers/index');
    const res = fakeResponse();
    await adminUpdateSettings({ body: { store_open: 'false' }, params: {}, query: {}, headers: {} } as any, res as any, (err: any) => { if (err) { res.statusCode = 500; res.body = { error: String(err && err.message || err) }; } });
    await settle();
    assert.equal(res.statusCode, 400, 'a closure with no times must be refused: ' + JSON.stringify(res.body));
    assert.match(res.body.error, /start time and a reopen time/);
  });

  test('closing the store with only a start time is refused', async () => {
    const { adminUpdateSettings } = await import('../src/controllers/index');
    const res = fakeResponse();
    await adminUpdateSettings({
      body: { store_open: 'false', store_closed_from: '2026-10-21T10:00' },
      params: {}, query: {}, headers: {},
    } as any, res as any, (err: any) => { if (err) { res.statusCode = 500; res.body = { error: String(err && err.message || err) }; } });
    await settle();
    assert.equal(res.statusCode, 400);
  });

  test('closing the store with only a reopen time is refused', async () => {
    const { adminUpdateSettings } = await import('../src/controllers/index');
    const res = fakeResponse();
    await adminUpdateSettings({
      body: { store_open: 'false', store_closed_until: '2026-10-21T18:00' },
      params: {}, query: {}, headers: {},
    } as any, res as any, (err: any) => { if (err) { res.statusCode = 500; res.body = { error: String(err && err.message || err) }; } });
    await settle();
    assert.equal(res.statusCode, 400);
  });

  test('a closure with both times is accepted', async () => {
    const { adminUpdateSettings } = await import('../src/controllers/index');
    const res = fakeResponse();
    await adminUpdateSettings({
      body: { store_open: 'false', store_closed_from: '2026-10-21T10:00', store_closed_until: '2026-10-21T18:00' },
      params: {}, query: {}, headers: {},
    } as any, res as any, (err: any) => { if (err) { res.statusCode = 500; res.body = { error: String(err && err.message || err) }; } });
    await settle();
    assert.equal(res.body.success, true, 'body ' + JSON.stringify(res.body));
    assert.equal(stored.store_open, 'false', 'stored ' + JSON.stringify(stored));
    assert.equal(stored.store_closed_from, '2026-10-21T10:00');
  });

  test('a closure with an unusable time is refused', async () => {
    const { adminUpdateSettings } = await import('../src/controllers/index');
    const res = fakeResponse();
    await adminUpdateSettings({
      body: { store_open: 'false', store_closed_from: 'not a date', store_closed_until: '2026-10-21T18:00' },
      params: {}, query: {}, headers: {},
    } as any, res as any, (err: any) => { if (err) { res.statusCode = 500; res.body = { error: String(err && err.message || err) }; } });
    await settle();
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /not valid/);
  });

  test('clearing the closure is allowed, and the times left behind do not block it', async () => {
    // The store is closed with times, then the switch is turned back on. The
    // body carries only the switch, so the check has to look at the merged
    // result or the clear would be refused.
    stored = {
      store_open: 'false',
      store_closed_from: '2026-10-21T10:00',
      store_closed_until: '2026-10-21T18:00',
    };
    const { adminUpdateSettings } = await import('../src/controllers/index');
    const res = fakeResponse();
    await adminUpdateSettings({ body: { store_open: 'true' }, params: {}, query: {}, headers: {} } as any, res as any, (err: any) => { if (err) { res.statusCode = 500; res.body = { error: String(err && err.message || err) }; } });
    await settle();
    assert.equal(res.body.success, true, 'clearing the closure must always be possible: ' + JSON.stringify(res.body));
    assert.equal(stored.store_open, 'true');
  });
});

const settle = () => new Promise((r) => setTimeout(r, 40));

function fakeResponse() {
  const res: any = { statusCode: 0, body: {} as any };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  return res;
}
