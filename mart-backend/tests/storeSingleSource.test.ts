/**
 * Store name/address single source of truth.
 *
 * These fields were editable in two places (hub Stores -> mart_stores, hub
 * Settings -> mart_settings) and read from different tables by the storefront
 * and the receipts, so the same store could show two different values. The fix
 * makes mart_stores canonical. The test harness stubs the database, so these
 * assertions pin the wiring at the source level: the settings writer must drop
 * the protected keys, and the public settings endpoint must overlay the store
 * record over whatever mart_settings returns.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(__dirname, '..', 'src', rel), 'utf8');

describe('Store name/address have a single source of truth', () => {
  test('the settings writer ignores store_name and store_address', () => {
    const src = read('services/settings.service.ts');
    assert.match(src, /PROTECTED_KEYS = new Set\(\['store_name', 'store_address'\]\)/);
    assert.match(src, /PROTECTED_KEYS\.has\(key\)\) continue;/);
  });

  test('the public settings endpoint overlays the store record for name/address', () => {
    const src = read('controllers/index.ts');
    assert.match(src, /store_name:\s*nameOverride \?\? store\?\.name/);
    assert.match(src, /store_address:\s*addressOverride \?\? store\?\.address/);
  });

  test('the WhatsApp message name comes from the order store snapshot, not settings', () => {
    const src = read('services/order.service.ts');
    assert.match(src, /storeName:\s*data\.storeName \|\| 'Gokez Mart'/);
    assert.doesNotMatch(src, /storeName:\s*settings\.store_name/);
  });

  test('the hub Settings page no longer edits store_name/store_address', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'mart-hub', 'src', 'pages', 'SettingsPage.tsx'), 'utf8');
    // The editable tab/group key lists must not include the protected keys.
    const tabsBlock = src.slice(src.indexOf('const TABS'), src.indexOf('const FIELD_META'));
    assert.doesNotMatch(tabsBlock, /'store_name'/);
    assert.doesNotMatch(tabsBlock, /'store_address'/);
  });
});
