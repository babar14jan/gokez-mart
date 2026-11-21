import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readHub = (rel: string) => readFileSync(join(__dirname, '..', '..', 'mart-hub', 'src', rel), 'utf8');

describe('Image Manager hub surface', () => {
  test('storage API exposes typed list, detail and detach-delete calls', () => {
    const api = readHub('services/api.ts');
    for (const type of [
      'export interface StorageImageReference',
      'export interface StorageImageFile',
      'export interface StorageImageListData',
      'export const storageApi = {',
    ]) assert.ok(api.includes(type), `missing ${type}`);

    assert.ok(api.includes("group: 'referenced' | 'unreferenced'"));
    assert.ok(api.includes('detach: boolean'));
    assert.ok(api.includes("api.get<{ success: boolean; data: StorageImageListData }>('/admin/storage/images', { params, fresh: opts?.fresh })"));
    assert.ok(api.includes("`/admin/storage/images/${id}`, { fresh: opts?.fresh }"));
    assert.ok(api.includes("api.post(`/admin/storage/images/${id}/delete`, payload)"));
  });

  test('page uses grouped tabs, shared filters and fresh reads', () => {
    const page = readHub('pages/ImageManagerPage.tsx');
    assert.ok(page.includes('const PAGE_SIZE = 24;'));
    assert.ok(page.includes('useSearchParams'));
    assert.ok(page.includes("params.get('group') === 'unreferenced' ? 'unreferenced' : 'referenced'"));
    assert.ok(page.includes("{ id: 'referenced', label: 'Referenced' }"));
    assert.ok(page.includes("{ id: 'unreferenced', label: 'Unreferenced' }"));
    assert.ok(page.includes('role="tablist"'));
    assert.ok(page.includes('role="tab"'));
    assert.ok(page.includes('aria-selected={group === tab.id}'));
    assert.ok(page.includes('role="tabpanel"'));
    assert.ok(page.includes('aria-labelledby={`image-${group}-tab`}'));
    assert.ok(page.includes('setParams({ group: tab.id }, { replace: true })'));

    for (const helper of [
      '<FilterBar', '<SearchField', '<ClearButton', 'useDebounced(', 'filterClass',
      '<Pagination', '<DetailDrawer', '<FieldRow', '<EmptyState',
    ]) assert.ok(page.includes(helper), `missing ${helper}`);
    assert.ok(!page.includes('<PanelHeader'), 'the layout header should not be duplicated inside the page');

    assert.ok(page.includes('storageApi.list({'));
    assert.ok(page.includes('{ fresh: true }'));
    assert.ok(page.includes('storageApi.get(file.id, { fresh: true })'));
    assert.ok(page.includes('folder: next.folder || undefined'));
    assert.ok(page.includes('search: next.search || undefined'));
    assert.ok(page.includes('limit: PAGE_SIZE'));
    assert.ok(page.includes('setFolders(data?.folders || [])'));
    assert.ok(page.includes('loadRequest'));
    assert.ok(page.includes('detailRequest'));
    assert.ok(page.includes('setOffset(0); }, [group, folder, search]'));
    assert.ok(page.includes('offset - PAGE_SIZE'));
  });

  test('cards show metadata, smart thumbnails, a visible fallback and reference details', () => {
    const page = readHub('pages/ImageManagerPage.tsx');
    assert.ok(page.includes("from 'lucide-react'"));
    assert.ok(page.includes('import SmartImage from \'../components/SmartImage\''));
    assert.ok((page.match(/<SmartImage/g) || []).length >= 2);
    assert.ok(page.includes('imgClassName="object-cover"'));
    assert.ok(page.includes('imgClassName="object-contain"'));
    assert.ok(page.includes('<ImageOff'));
    assert.ok(page.includes('<GalleryHorizontal'));
    for (const field of [
      'file.folder || \'—\'', 'file.filename', 'file.originalName || file.filename',
      'formatSize(file.size)', 'fmtDate(file.createdAt, false)', 'file.references.length',
      'View references', 'ref.table}.{ref.column', '<FieldRow label="Row ID">',
      '<FieldRow label="Path">', '<FieldRow label="Value">', '<FieldRow label="Label">',
    ]) assert.ok(page.includes(field), `missing ${field}`);
  });

  test('deletion warns irreversibly, names reference samples, clears refs and reloads', () => {
    const page = readHub('pages/ImageManagerPage.tsx');
    assert.ok(page.includes('import ConfirmDialog from \'../components/ConfirmDialog\''));
    assert.ok(page.includes('<ConfirmDialog'));
    assert.ok(page.includes('permanently delete'));
    assert.ok(page.includes('irreversible and cannot be undone'));
    assert.ok(page.includes('${refs.length} database reference'));
    assert.ok(page.includes('refs.slice(0, 3)'));
    assert.ok(page.includes('All matching database references will be cleared'));
    assert.ok(page.includes('storageApi.delete(file.id, { dryRun: false, detach: target.referenced })'));
    assert.ok(page.includes('Linked thumbnails, variants, and product asset records may also be removed'));
    assert.ok(page.includes('showToast(\'Image deleted successfully.\', \'success\')'));
    assert.ok(page.includes("errorMessage(error, 'Could not delete image.')"));
    assert.ok(page.includes('useToast'));
    assert.ok(page.includes('<ToastContainer toasts={toasts} />'));
    assert.ok(page.includes('await fetchImages({ group, folder, search, offset: nextOffset })'));
  });

  test('route is lazy and restricted to super admins', () => {
    const app = readHub('App.tsx');
    assert.ok(app.includes("const ImageManagerPage = lazyWithRetry(() => import('./pages/ImageManagerPage'));"));
    assert.ok(app.includes('<Route path="/image-manager"     element={<ProtectedRoute path="/image-manager"><ImageManagerPage /></ProtectedRoute>} />'));

    const roleLine = (prefix: string) => app.split('\n').find(line => line.trim().startsWith(prefix)) || '';
    assert.ok(roleLine('super_admin:').includes("'/image-manager'"));
    for (const prefix of ['store_owner:', 'store_manager:', 'delivery_staff:', 'staff:']) {
      assert.ok(!roleLine(prefix).includes('/image-manager'), `${prefix} must not reach the page`);
    }
  });

  test('layout adds a distinct Administration icon, title and mobile back-chevron entry', () => {
    const layout = readHub('components/Layout.tsx');
    assert.ok(layout.includes('Image as ImageIcon, GalleryHorizontal,'));
    assert.ok(layout.includes("{ label: 'Image Manager',      href: '/image-manager',       icon: GalleryHorizontal, roles: ['super_admin'], section: 'Administration' },"));
    assert.ok(layout.includes("'/image-manager': 'Image Manager',"));
    assert.ok(layout.includes("'/carousel', '/image-manager', '/home-sections', '/referrals'].includes(pathname)"));
    assert.ok(layout.includes('NAV_ALL.filter'));
  });
});
