import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('inventory valuation KPIs', () => {
  test('daily snapshot migration stores costed stock per store and product', () => {
    const migration = read('src/database/migrations/148_inventory_daily_snapshots.sql');
    assert.match(migration, /CREATE TABLE IF NOT EXISTS mart_inventory_daily_snapshots/);
    assert.match(migration, /UNIQUE \(store_id, product_id, snapshot_date\)/);
    assert.match(migration, /stock_quantity NUMERIC\(12,3\)/);
    assert.match(migration, /unit_cost NUMERIC\(12,4\)/);
    assert.match(migration, /total_value NUMERIC\(14,2\)/);
    assert.match(migration, /is_estimated BOOLEAN/);
    assert.match(migration, /mart_inventory_movements/);
    assert.doesNotMatch(migration, /is_catalog/);
    assert.match(migration, /is_estimated\)[\s\S]*?\n\s+true\n/);
  });

  test('migration backfill covers every tracked product with corrected estimates', () => {
    const migration = read('src/database/migrations/148_inventory_daily_snapshots.sql');
    assert.match(migration, /sp\.stock_quantity IS NOT NULL/);
    assert.match(migration, /pr\.is_bundle = false/);
    assert.match(migration, /sp\.availability_status <> 'hidden'/);
    assert.match(migration, /LEFT JOIN latest_movement lm/);
    assert.match(migration, /COALESCE\(\s*lm\.new_balance,/);
    assert.match(migration, /GREATEST\(/);
    assert.match(migration, /quantity_in/);
    assert.match(migration, /created_at >= bd\.end_of_day/);
    assert.match(migration, /mart_purchase_batches/);
    assert.match(migration, /b\.quantity_remaining > 0/);
    assert.match(migration, /b\.status <> 'voided'/);
    assert.match(migration, /received_at < qb\.end_of_day/);
    assert.match(migration, /unit_cost IS NOT NULL AND m\.unit_cost > 0/);
    assert.match(migration, /DO UPDATE SET/);
    assert.match(migration, /is_estimated = true/);
    assert.match(migration, /WHERE mart_inventory_daily_snapshots\.is_estimated = true/);
    assert.doesNotMatch(migration, /AND NOT EXISTS/);
  });

  test('valuation summary values only active tracked non-bundle items at cost', () => {
    const service = read('src/services/inventory.service.ts');
    assert.match(service, /static async getValuationSummary/);
    assert.match(service, /sp\.stock_quantity IS NOT NULL/);
    assert.match(service, /sp\.store_id = \$1/);
    assert.match(service, /p\.is_bundle = false/);
    assert.match(service, /sp\.availability_status <> 'hidden'/);
    assert.doesNotMatch(service, /is_catalog/);
    assert.match(service, /mart_purchase_batches/);
    assert.match(service, /mart_inventory_daily_snapshots/);
    assert.match(service, /yesterdayEstimated/);
    assert.doesNotMatch(service, /allValue/);
  });

  test('service backfill estimates every tracked product and only corrects estimated rows', () => {
    const service = read('src/services/inventory.service.ts');
    assert.match(service, /private static async backfillMovementSnapshot/);
    assert.match(service, /sp\.stock_quantity IS NOT NULL/);
    assert.match(service, /p\.is_bundle = false/);
    assert.match(service, /sp\.availability_status <> 'hidden'/);
    assert.match(service, /LEFT JOIN latest_movement lm/);
    assert.match(service, /COALESCE\(\s*lm\.new_balance,/);
    assert.match(service, /GREATEST\(/);
    assert.match(service, /quantity_in/);
    assert.match(service, /created_at >= bd\.end_of_day/);
    assert.match(service, /mart_purchase_batches/);
    assert.match(service, /b\.quantity_remaining > 0/);
    assert.match(service, /b\.status <> 'voided'/);
    assert.match(service, /received_at < qb\.end_of_day/);
    assert.match(service, /unit_cost IS NOT NULL AND m\.unit_cost > 0/);
    assert.match(service, /DO UPDATE SET/);
    assert.match(service, /is_estimated = true/);
    assert.match(service, /WHERE mart_inventory_daily_snapshots\.is_estimated = true/);
    assert.doesNotMatch(service, /NOT EXISTS/);
  });

  test('snapshot job is scheduled with the other background jobs', () => {
    const index = read('src/index.ts');
    assert.match(index, /InventoryService\.ensureDailySnapshots\(\)/);
    assert.match(index, /inventorySnapshotTimer/);
  });

  test('admin route and hub API expose the valuation summary', () => {
    const routes = read('src/routes/index.ts');
    const controllers = read('src/controllers/index.ts');
    const api = read('../mart-hub/src/services/api.ts');
    assert.match(routes, /\/admin\/inventory\/valuation-summary/);
    assert.match(controllers, /adminGetInventoryValuationSummary/);
    assert.match(api, /getValuationSummary/);
  });

  test('inventory page shows today, yesterday, costed and change KPI cards', () => {
    const page = read('../mart-hub/src/pages/InventoryPage.tsx');
    assert.match(page, /Stock value today/);
    assert.match(page, /Yesterday closing value/);
    assert.match(page, /Costed stock lines/);
    assert.match(page, /Change vs yesterday/);
    assert.match(page, /KpiCard/);
  });
});
