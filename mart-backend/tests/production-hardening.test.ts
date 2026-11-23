/**
 * Production boundary regressions: these checks protect configuration that is
 * easy to weaken accidentally while changing deployment or auth settings.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');

const configSource = read('mart-backend/src/config/index.ts');
const appSource = read('mart-backend/src/app.ts');

describe('production hardening', () => {
  test('production refuses a weak or default JWT secret', () => {
    assert.match(configSource, /jwtSecret\.length < 32/);
    assert.match(configSource, /mart-dev-secret-change-in-production/);
    assert.match(configSource, /change_this_in_production/);
  });

  test('production CORS only permits explicitly configured HTTPS origins', () => {
    assert.match(configSource, /MART_CORS_ORIGIN must contain one or more HTTPS origins in production/);
    assert.match(configSource, /\^https:\\\/\\\//);
    assert.ok(!/\\\.onrender\\\.com/.test(appSource), 'all hosted Render applications must not be trusted');
    assert.ok(!/\\\.gokez\\\.com/.test(appSource), 'all Gokez subdomains must not be trusted implicitly');
    assert.match(appSource, /config\.cors\.origins\.includes\(origin\)/);
  });

  test('OTP and admin login have IP budgets in addition to identifier budgets', () => {
    const otpLimits = appSource.match(/app\.use\('\/api\/v1\/auth\/send-otp', rateLimit\(/g) || [];
    const adminLimits = appSource.match(/app\.use\('\/api\/v1\/admin\/login', rateLimit\(/g) || [];
    assert.equal(otpLimits.length, 2, 'OTP requests need both IP and phone budgets');
    assert.equal(adminLimits.length, 2, 'admin login needs both IP and username/IP budgets');
    assert.match(appSource, /Too many OTP requests from this network/);
  });

  test('product writes are limited to zone head owners/managers and super admins', () => {
    const controllers = read('mart-backend/src/controllers/index.ts');
    const page = read('mart-hub/src/pages/ProductsPage.tsx');
    assert.match(controllers, /async function assertCanManageProductSettings/);
    assert.match(controllers, /canAccessDailySales\(req\.admin!\)/);
    for (const name of ['adminCreateProduct', 'adminUpdateProduct', 'adminDeleteProduct', 'adminBulkAddFromCatalog']) {
      const start = controllers.indexOf(`export const ${name}`);
      const next = controllers.indexOf('export const ', start + 1);
      const section = controllers.slice(start, next === -1 ? undefined : next);
      assert.match(section, /await assertCanManageProductSettings\(req\)/, `${name} must check zone-head access`);
    }
    assert.match(page, /canManageProductSettings/);
    assert.match(page, /Only the zone head/);
  });

  test('customer display modes are saved and restored from head-store settings', () => {
    const controllers = read('mart-backend/src/controllers/index.ts');
    const page = read('mart-hub/src/pages/ProductsPage.tsx');
    assert.match(controllers, /product_customer_display_modes/);
    const start = controllers.indexOf('export const adminUpdateSettings');
    const next = controllers.indexOf('export const ', start + 1);
    const section = controllers.slice(start, next === -1 ? undefined : next);
    assert.match(section, /await assertCanManageProductSettings\(req\)/);
    assert.match(section, /CUSTOMER_DISPLAY_MODE_IDS/);
    assert.match(page, /savedDisplayModes/);
    assert.match(page, /displayModesDirty/);
    assert.match(page, /Last saved:/);
    assert.match(page, /'Saved'/);
  });
});
