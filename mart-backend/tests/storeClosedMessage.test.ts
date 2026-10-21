/**
 * The store's own wording for the closed notice.
 *
 * A store that closes for the day needs to tell customers why, and that
 * wording is the store owner's to write, not the platform's. It lives in
 * mart_settings beside the manual open/closed switch, is written from the hub's
 * Hours tab, and is rendered in the storefront's closed banner.
 *
 * Three things have to hold for it to work, and each is easy to break:
 *   1. the key has to be PUBLIC, or the storefront never receives it
 *   2. the key must not be PROTECTED, or the hub cannot write it
 *   3. writing it has to change the settings row's updated_at, because the
 *      storefront decides to refetch from the catalog stamp -- and the stamp
 *      is built from max(updated_at) over mart_settings
 *
 * Harness matches tests/homeSections.test.ts: Node's `node:test` via `tsx`,
 * with `pg.Pool.prototype.connect` stubbed so the real SQL is captured.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'store-closed-message-test-secret';

const require = createRequire(__filename);

interface Call { text: string; params: unknown[] }

let calls: Call[] = [];
let settingsRows: Array<{ key: string; value: string }> = [];

const pg = require('pg');
(pg.Pool.prototype as any).connect = async function () {
  return {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/FROM mart_settings WHERE store_id = \$1 AND key = ANY/.test(text)) {
        // Only the keys the caller asked for come back.
        const wanted: string[] = params[1] || [];
        return {
          rows: settingsRows
            .filter(r => wanted.includes(r.key))
            .map(r => ({ key: r.key, value: r.value })),
        };
      }
      if (/UPDATE mart_settings SET value/.test(text)) return { rows: [] };
      return { rows: [] };
    },
    release: () => undefined,
    end: async () => undefined,
  };
};

const textOf = (c: Call) => c.text.replace(/\s+/g, ' ').trim();

const KEY = 'store_closed_message';

describe('store closed message', () => {
  beforeEach(() => {
    calls = [];
    settingsRows = [{ key: KEY, value: 'Taking a break today. Back tomorrow.' }];
  });

  test('the storefront is allowed to receive it', async () => {
    const { SettingsService } = await import('../src/services/settings.service');
    const published = await SettingsService.getPublic('store-1');
    assert.equal(
      published[KEY],
      'Taking a break today. Back tomorrow.',
      'the message must reach the storefront, or the banner can never show it',
    );
    // It is fetched through the public key allowlist, not by a special case.
    const query = calls.find(c => /key = ANY/.test(c.text));
    assert.ok(query, 'the public read must go through the key allowlist');
    assert.ok(
      (query!.params[1] as string[]).includes(KEY),
      'the message must be on the public key list',
    );
  });

  test('an unset message is simply absent, not an error', async () => {
    settingsRows = [];
    const { SettingsService } = await import('../src/services/settings.service');
    const published = await SettingsService.getPublic('store-1');
    assert.equal(published[KEY], undefined, 'an unset message is simply missing');
  });

  test('the hub is allowed to write it', async () => {
    const { SettingsService } = await import('../src/services/settings.service');
    await SettingsService.updateMany('store-1', { [KEY]: 'Closed for a bit.' });
    const write = calls.find(c => /mart_settings/i.test(c.text));
    assert.ok(write, 'the message must be writable');
    assert.equal(write!.params[0], 'Closed for a bit.');
  });

  test('writing it bumps updated_at, so the storefront refetches', async () => {
    // The storefront decides to refetch from the catalog stamp, and the stamp is
    // built from max(updated_at) over mart_settings. A write that did not move
    // updated_at would leave the old wording on every customer's screen.
    const settingsSource = fs.readFileSync(
      path.resolve(__dirname, '../src/services/settings.service.ts'),
      'utf8',
    );
    assert.match(
      settingsSource,
      /INSERT INTO mart_settings \(store_id, key, value, updated_at\)[\s\S]*?updated_at = NOW\(\)/,
      'a settings write must bump updated_at or the storefront never sees the change',
    );

    const catalogSource = fs.readFileSync(
      path.resolve(__dirname, '../src/services/catalog.service.ts'),
      'utf8',
    );
    assert.match(
      catalogSource,
      /max\(s\.updated_at\)::text.*FROM mart_settings s WHERE s\.store_id = \$1/,
      'the catalog stamp must include the settings rows, or a changed message is never picked up',
    );
  });

  test('it is not one of the protected keys', async () => {
    const { SettingsService } = await import('../src/services/settings.service');
    // The protected keys are the store name and address, which live only on
    // mart_stores. The message must not be caught by that.
    await SettingsService.updateMany('store-1', { store_name: 'Hijacked' });
    const write = calls.find(c => /mart_settings/i.test(c.text));
    assert.equal(write, undefined, 'a protected key must not be written through the settings path');
  });

  test('a setting that has never been written can still be created', async () => {
    // This is the bug that stopped the whole feature working. A plain UPDATE
    // only touches rows that already exist, so the first time anyone set the
    // closure the value was silently dropped: the hub showed the field, the
    // save reported success, and the store never closed.
    const { SettingsService } = await import('../src/services/settings.service');
    await SettingsService.update('store-1', 'store_closed_from', '2026-10-21T10:00');
    const write = calls.find(c => /mart_settings/i.test(c.text));
    assert.ok(write, 'the setting must be written');
    assert.match(
      textOf(write!),
      /INSERT INTO mart_settings/i,
      'the write must be an insert, or a key with no row yet is dropped',
    );
    assert.match(
      textOf(write!),
      /ON CONFLICT \(store_id, key\) DO UPDATE/i,
      'the write must also update a row that already exists',
    );
  });

  test('writing an existing setting still updates it in place', async () => {
    const { SettingsService } = await import('../src/services/settings.service');
    await SettingsService.updateMany('store-1', { [KEY]: 'Closed for a bit.' });
    const writes = calls.filter(c => /mart_settings/i.test(c.text));
    assert.equal(writes.length, 1);
    assert.equal(writes[0]!.params[0], 'Closed for a bit.');
    assert.match(textOf(writes[0]!), /updated_at = NOW\(\)/, 'the write must bump updated_at');
  });
});
