import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { HostingerFileRecord } from '../src/services/hostingerStorage.service';
import {
  buildFileIndex,
  cartTotals,
  matchingFiles,
  rewriteJsonValue,
} from '../src/services/imageReferenceRewrite';

const read = (relativePath: string) => fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

const routesSource = read('src/routes/index.ts');
const controllerSource = read('src/controllers/index.ts');
const serviceSource = read('src/services/imageManager.service.ts');
const helperSource = read('src/services/imageReferenceRewrite.ts');
const hostingerSource = read('src/services/hostingerStorage.service.ts');

function controllerBody(name: string): string {
  const start = controllerSource.indexOf(`export const ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = controllerSource.indexOf('export const ', start + 1);
  return controllerSource.slice(start, next === -1 ? controllerSource.length : next);
}

function makeFile(overrides: Partial<HostingerFileRecord> = {}): HostingerFileRecord {
  return {
    id: 'file-small',
    folder: 'catalog',
    filename: 'uuid-small.webp',
    originalName: 'small.webp',
    mimeType: 'image/webp',
    size: 1000,
    url: 'https://images.gokez.com/catalog/uuid-small.webp',
    thumbnailUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('admin storage image manager endpoints', () => {
  test('all three routes are super-admin only and sit beside the clean route', () => {
    assert.match(routesSource, /router\.post\('\/admin\/storage\/clean',\s*authenticate,\s*requireSuperAdmin,\s*ctrl\.adminCleanStorage\)/);
    assert.match(routesSource, /router\.get\('\/admin\/storage\/images',\s*authenticate,\s*requireSuperAdmin,\s*ctrl\.adminListStorageImages\)/);
    assert.match(routesSource, /router\.get\('\/admin\/storage\/images\/:id',\s*authenticate,\s*requireSuperAdmin,\s*ctrl\.adminGetStorageImage\)/);
    assert.match(routesSource, /router\.post\('\/admin\/storage\/images\/:id\/delete',\s*authenticate,\s*requireSuperAdmin,\s*ctrl\.adminDeleteStorageImage\)/);
  });

  test('controllers repeat the super_admin guard and return the contract envelope', () => {
    const list = controllerBody('adminListStorageImages');
    const detail = controllerBody('adminGetStorageImage');
    const remove = controllerBody('adminDeleteStorageImage');
    for (const body of [list, detail, remove]) {
      assert.match(body, /req\.admin\?\.role !== 'super_admin'/);
      assert.match(body, /Super admin access required/);
    }
    assert.match(list, /ImageManagerService\.listImages/);
    assert.match(list, /success: true, data/);
    assert.match(detail, /ImageManagerService\.getImage/);
    assert.match(detail, /success: true, data: result/);
    assert.match(detail, /status\(404\)/);
    assert.match(remove, /ImageManagerService\.deleteImage/);
    assert.match(remove, /req\.body\?\.dryRun !== false/);
    assert.match(remove, /req\.body\?\.detach === true/);
    assert.match(remove, /status\(409\)/);
    assert.match(remove, /error: 'File is still referenced', references: error\.references/);
    assert.match(remove, /ImageStorageDeleteError/);
    assert.match(remove, /status\(502\)/);
    assert.match(remove, /referencesCleared: true/);
    assert.match(remove, /ComplianceService\.logAudit/);
  });
});

describe('hostinger storage service image manager API', () => {
  test('exports the file record and list result types', () => {
    assert.match(hostingerSource, /export interface HostingerFileRecord/);
    assert.match(hostingerSource, /export interface HostingerListResult/);
    for (const field of [
      'id', 'folder', 'filename', 'originalName', 'mimeType', 'size',
      'url', 'thumbnailUrl', 'createdAt', 'updatedAt',
    ]) {
      assert.ok(hostingerSource.includes(`${field}:`), `HostingerFileRecord needs ${field}`);
    }
  });

  test('implements list, get and verified delete with project auth and timeouts', () => {
    assert.match(hostingerSource, /static async listFiles/);
    assert.match(hostingerSource, /static async getFile/);
    assert.match(hostingerSource, /static async deleteVerified/);
    assert.match(hostingerSource, /new URLSearchParams/);
    assert.ok(hostingerSource.includes("'Authorization': `Bearer ${config.hostinger.apiKey}`"));
    assert.match(hostingerSource, /'X-Project-Id': config\.hostinger\.projectId/);
    assert.match(hostingerSource, /signal: timeoutSignal\(OUTBOUND_TIMEOUTS\.storageUpload\)/);
    assert.match(hostingerSource, /encodeURIComponent\(id\)/);
    assert.match(hostingerSource, /res\.status === 404\) return null/);
    assert.match(hostingerSource, /json\?\.success !== true/);
  });

  test('keeps the existing best-effort delete unchanged', () => {
    assert.match(hostingerSource, /static async delete\(id: string\): Promise<void>/);
    assert.match(hostingerSource, /if \(!this\.isConfigured\(\)\) return;/);
    assert.match(hostingerSource, /catch \{\s*\/\/ best effort\s*\}/);
  });
});

describe('image manager reference registry', () => {
  test('covers every required table and primary key', () => {
    for (const table of [
      'mart_products', 'mart_product_image_assets', 'mart_stores', 'mart_categories',
      'mart_customers', 'mart_carousel_slides', 'mart_campaigns', 'mart_promotions',
      'mart_home_sections', 'mart_settings', 'mart_carts',
    ]) {
      assert.ok(serviceSource.includes(`table: '${table}'`), `missing reference source ${table}`);
    }
    const registry = serviceSource.slice(
      serviceSource.indexOf('export const IMAGE_REFERENCE_SOURCES'),
      serviceSource.indexOf('export class ImageReferenceConflictError')
    );
    assert.equal((registry.match(/primaryKey: 'id'/g) || []).length, 10);
    assert.match(registry, /table: 'mart_settings',\s*primaryKey: 'key'/);
  });

  test('covers every required column and excludes campaign image_url', () => {
    for (const column of [
      'photo_url', 'photos', 'photo_variants', 'small_url', 'thumbnail_url',
      'large_url', 'storage_id', 'logo_url', 'icon', 'image_url',
      'carousel_image_url', 'config', 'value', 'items',
    ]) {
      assert.ok(serviceSource.includes(`name: '${column}'`), `missing reference column ${column}`);
    }
    const campaignBlock = serviceSource.match(/table: 'mart_campaigns',[\s\S]*?labelColumns: \[[^\]]*\]/)![0];
    assert.match(campaignBlock, /name: 'carousel_image_url'/);
    assert.doesNotMatch(campaignBlock, /name: 'image_url'/);
  });

  test('uses the current home sections label column', () => {
    const homeSectionsBlock = serviceSource.match(/table: 'mart_home_sections',[\s\S]*?labelColumns: \[[^\]]*\]/)![0];
    assert.match(homeSectionsBlock, /'kind'/);
    assert.doesNotMatch(homeSectionsBlock, /'section_key'/);
  });

  test('matches URLs, folder paths, thumbnails and storage ids through a reverse index', () => {
    assert.match(helperSource, /function normalizeImageValue/);
    assert.match(helperSource, /function filenameAliases/);
    assert.match(helperSource, /file\.thumbnailFilename/);
    assert.ok(helperSource.includes('`${file.folder}/${file.filename}`'));
    assert.match(helperSource, /function walkJson/);
    assert.match(helperSource, /function parseStorageIds/);
    assert.match(serviceSource, /buildFileIndex\(files\)/);
    assert.match(serviceSource, /matchingFiles\(leaf, index\)/);
    assert.match(serviceSource, /index\.byId\.get\(id\)/);
  });
});

describe('image reference rewrite behavior', () => {
  const file = makeFile();

  test('matches exact folder paths and bare legacy filenames, but not cross-folder collisions', () => {
    const index = buildFileIndex([file]);
    assert.equal(matchingFiles('catalog/uuid-small.webp', index).length, 1);
    assert.equal(matchingFiles('https://images.gokez.com/catalog/uuid-small.webp?x=1', index).length, 1);
    assert.equal(matchingFiles('uuid-small.webp', index).length, 1);
    assert.equal(matchingFiles('banner/uuid-small.webp', index).length, 0);
  });

  test('clears cart photo references without dropping cart lines', () => {
    const index = buildFileIndex([file]);
    const items = [
      { productId: 'product-1', productName: 'Rice', quantity: 2, price: 100, photoUrl: 'catalog/uuid-small.webp' },
      { productId: 'product-2', productName: 'Oil', quantity: 1, price: 50, photoUrl: 'catalog/other.webp' },
    ];
    const rewritten = rewriteJsonValue(items, index);
    assert.equal(rewritten.changed, true);
    assert.deepEqual(rewritten.value, [
      { productId: 'product-1', productName: 'Rice', quantity: 2, price: 100, photoUrl: null },
      { productId: 'product-2', productName: 'Oil', quantity: 1, price: 50, photoUrl: 'catalog/other.webp' },
    ]);
    assert.deepEqual(cartTotals(rewritten.value), { itemCount: 3, subtotal: 250 });
  });

  test('drops only matching product variant objects when requested', () => {
    const index = buildFileIndex([file]);
    const variants = [
      { url: 'catalog/uuid-small.webp', width: 100 },
      { url: 'catalog/other.webp', width: 200 },
    ];
    const rewritten = rewriteJsonValue(variants, index, true);
    assert.equal(rewritten.changed, true);
    assert.deepEqual(rewritten.value, [{ url: 'catalog/other.webp', width: 200 }]);
  });

  test('clears sibling asset urls when deleting one asset variant', () => {
    const sibling = makeFile({
      id: 'file-large',
      filename: 'uuid-large.webp',
      url: 'https://images.gokez.com/catalog/uuid-large.webp',
    });
    const index = buildFileIndex([file, sibling]);
    const rewritten = rewriteJsonValue(['catalog/uuid-large.webp'], index);
    assert.equal(rewritten.changed, true);
    assert.deepEqual(rewritten.value, []);
  });
});

describe('detach and delete behaviour', () => {
  test('defaults dryRun true and detach false, then refuses live references', () => {
    assert.match(serviceSource, /const dryRun = options\.dryRun !== false/);
    assert.match(serviceSource, /const detach = options\.detach === true/);
    assert.match(serviceSource, /super\('File is still referenced'\)/);
    assert.match(serviceSource, /if \(internal\.length && !detach\) throw new ImageReferenceConflictError\(references\)/);
    assert.match(serviceSource, /params\.group === 'unreferenced' \? 'unreferenced' : 'referenced'/);
  });

  test('collects sibling assets, clears references in one transaction, then deletes storage', () => {
    assert.match(serviceSource, /collectAssetStorageIds\(initialReferences\)/);
    assert.match(serviceSource, /loadSiblingFiles\(assetStorageIds, file\.id\)/);
    assert.match(serviceSource, /collectInternalReferences\(files\)/);
    assert.match(serviceSource, /await transaction\(client => clearReferences\(client, files, internal\)\)/);
    assert.ok(
      serviceSource.indexOf('await transaction(client => clearReferences') < serviceSource.indexOf('HostingerStorageService.deleteVerified(deleteId)'),
      'storage deletion must happen after the database commit'
    );
    assert.match(serviceSource, /item_count = \$3, subtotal = \$4/);
    assert.match(serviceSource, /cartTotals\(rewritten\.value\)/);
    assert.match(serviceSource, /SET "\$\{column\.name\}" = NULL/);
    assert.match(serviceSource, /SET "\$\{column\.name\}" = ''/);
    assert.match(serviceSource, /DELETE FROM \$\{table\} WHERE id = ANY\(\$1::uuid\[\]\)/);
    assert.match(serviceSource, /::jsonb/);
  });

  test('reports deleted and failed ids and throws when storage deletion fails', () => {
    assert.match(serviceSource, /deletedIds: string\[\]/);
    assert.match(serviceSource, /failedIds: string\[\]/);
    assert.match(serviceSource, /throw new ImageStorageDeleteError\(failedIds, deletedIds\)/);
    assert.match(controllerSource, /success: true, data: result/);
  });
});
