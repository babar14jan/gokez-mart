import { query, transaction } from '../database/db';
import { HostingerStorageService, type HostingerFileRecord } from './hostingerStorage.service';
import {
  buildFileIndex,
  cartTotals,
  matchingFiles,
  parseStorageIds,
  rewriteJsonValue,
  walkJson,
} from './imageReferenceRewrite';

export interface ImageReference {
  table: string;
  column: string;
  rowId: string;
  path: string;
  value: unknown;
  label: string;
}

export interface ImageManagerFile {
  id: string;
  folder: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
  referenced: boolean;
  references: ImageReference[];
}

export interface ImageManagerListParams {
  group?: string;
  folder?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ImageManagerListResult {
  items: ImageManagerFile[];
  total: number;
  folders: string[];
  referencedTotal: number;
  unreferencedTotal: number;
}

export interface ImageManagerDeleteResult {
  dryRun: boolean;
  file: ImageManagerFile;
  referenced: boolean;
  references: ImageReference[];
  deletedIds: string[];
  failedIds: string[];
}

type ReferenceColumnKind = 'text' | 'json' | 'assets' | 'settings';

interface ReferenceColumn {
  name: string;
  kind: ReferenceColumnKind;
}

interface ReferenceSource {
  table: string;
  primaryKey: 'id' | 'key';
  columns: ReferenceColumn[];
  labelColumns: string[];
}

interface InternalReference extends ImageReference {
  primaryKey: 'id' | 'key';
  storeId?: string | null;
  storageIds?: string[];
}

interface JsonRewrite {
  value: unknown;
  changed: boolean;
}

export const IMAGE_REFERENCE_SOURCES: ReferenceSource[] = [
  {
    table: 'mart_products',
    primaryKey: 'id',
    columns: [
      { name: 'photo_url', kind: 'text' },
      { name: 'photos', kind: 'json' },
      { name: 'photo_variants', kind: 'json' },
    ],
    labelColumns: ['name', 'local_name'],
  },
  {
    table: 'mart_product_image_assets',
    primaryKey: 'id',
    columns: [
      { name: 'small_url', kind: 'text' },
      { name: 'thumbnail_url', kind: 'text' },
      { name: 'large_url', kind: 'text' },
      { name: 'storage_id', kind: 'assets' },
    ],
    labelColumns: ['product_id'],
  },
  {
    table: 'mart_stores',
    primaryKey: 'id',
    columns: [{ name: 'logo_url', kind: 'text' }],
    labelColumns: ['name'],
  },
  {
    table: 'mart_categories',
    primaryKey: 'id',
    columns: [{ name: 'icon', kind: 'text' }],
    labelColumns: ['name'],
  },
  {
    table: 'mart_customers',
    primaryKey: 'id',
    columns: [{ name: 'photo_url', kind: 'text' }],
    labelColumns: ['name', 'phone'],
  },
  {
    table: 'mart_carousel_slides',
    primaryKey: 'id',
    columns: [{ name: 'image_url', kind: 'text' }],
    labelColumns: ['title'],
  },
  {
    table: 'mart_campaigns',
    primaryKey: 'id',
    columns: [{ name: 'carousel_image_url', kind: 'text' }],
    labelColumns: ['title'],
  },
  {
    table: 'mart_promotions',
    primaryKey: 'id',
    columns: [{ name: 'image_url', kind: 'text' }],
    labelColumns: ['title'],
  },
  {
    table: 'mart_home_sections',
    primaryKey: 'id',
    columns: [{ name: 'config', kind: 'json' }],
    labelColumns: ['title', 'section_key'],
  },
  {
    table: 'mart_settings',
    primaryKey: 'key',
    columns: [{ name: 'value', kind: 'settings' }],
    labelColumns: ['label', 'store_id'],
  },
  {
    table: 'mart_carts',
    primaryKey: 'id',
    columns: [{ name: 'items', kind: 'json' }],
    labelColumns: ['session_id', 'customer_id'],
  },
];

export class ImageReferenceConflictError extends Error {
  readonly references: ImageReference[];

  constructor(references: ImageReference[]) {
    super('File is still referenced');
    this.name = 'ImageReferenceConflictError';
    this.references = references;
  }
}

export class ImageStorageDeleteError extends Error {
  readonly failedIds: string[];
  readonly deletedIds: string[];

  constructor(failedIds: string[], deletedIds: string[] = []) {
    super(`Failed to delete image from storage service: ${failedIds.join(', ')}`);
    this.name = 'ImageStorageDeleteError';
    this.failedIds = failedIds;
    this.deletedIds = deletedIds;
  }
}

function shortLabel(table: string, row: Record<string, unknown>): string {
  const keys = ['title', 'name', 'local_name', 'label', 'key', 'phone', 'session_id', 'id'];
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) {
      return `${table.replace(/^mart_/, '')}: ${value.slice(0, 80)}`;
    }
  }
  return table.replace(/^mart_/, '');
}

function loadReferenceRows(source: ReferenceSource): Promise<Array<Record<string, unknown>>> {
  const names = [...new Set([
    source.primaryKey,
    ...source.columns.map(column => column.name),
    ...source.labelColumns,
  ])];
  return query<Record<string, unknown>>(`SELECT ${names.map(name => `"${name}"`).join(', ')} FROM ${source.table}`)
    .then(result => result.rows);
}

function publicReference(reference: InternalReference): ImageReference {
  return {
    table: reference.table,
    column: reference.column,
    rowId: reference.rowId,
    path: reference.path,
    value: reference.value,
    label: reference.label,
  };
}

function referenceKey(reference: InternalReference): string {
  return [
    reference.table,
    reference.column,
    reference.rowId,
    reference.path,
    JSON.stringify(reference.value),
    reference.label,
  ].join('|');
}

function uniqueReferences(references: InternalReference[]): InternalReference[] {
  const seen = new Set<string>();
  return references.filter(reference => {
    const key = referenceKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toImageManagerFile(file: HostingerFileRecord, references: InternalReference[]): ImageManagerFile {
  return {
    id: file.id,
    folder: file.folder,
    filename: file.filename,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    url: file.url,
    thumbnailUrl: file.thumbnailUrl,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    referenced: references.length > 0,
    references: references.map(publicReference),
  };
}

function sortReferences(references: InternalReference[]): InternalReference[] {
  return [...references].sort((a, b) =>
    a.table.localeCompare(b.table)
    || a.column.localeCompare(b.column)
    || String(a.rowId).localeCompare(String(b.rowId))
    || a.path.localeCompare(b.path));
}

async function collectReferences(files: HostingerFileRecord[]): Promise<Map<string, InternalReference[]>> {
  const referencesByFile = new Map<string, InternalReference[]>(files.map(file => [file.id, []]));
  if (!files.length) return referencesByFile;
  const index = buildFileIndex(files);

  for (const source of IMAGE_REFERENCE_SOURCES) {
    const rows = await loadReferenceRows(source);
    for (const row of rows) {
      const rowId = row[source.primaryKey];
      if (rowId === null || rowId === undefined) continue;
      const label = shortLabel(source.table, row);
      const rowStorageIds = source.table === 'mart_product_image_assets'
        ? parseStorageIds(row.storage_id)
        : undefined;
      for (const column of source.columns) {
        const raw = row[column.name];
        if (raw === null || raw === undefined) continue;
        const addReference = (file: HostingerFileRecord, path: string, value: unknown, storageIds?: string[]) => {
          referencesByFile.get(file.id)!.push({
            table: source.table,
            column: column.name,
            rowId: String(rowId),
            path,
            value,
            label,
            primaryKey: source.primaryKey,
            storeId: source.table === 'mart_settings' && row.store_id ? String(row.store_id) : null,
            storageIds,
          });
        };
        if (column.kind === 'assets') {
          const ids = parseStorageIds(raw);
          ids.forEach((id, position) => {
            const file = index.byId.get(id);
            if (file) addReference(file, `${column.name}[${position}]`, id, ids);
          });
        } else {
          walkJson(raw, column.name, (path, leaf) => {
            for (const file of matchingFiles(leaf, index)) addReference(file, path, leaf, rowStorageIds);
          });
        }
      }
    }
  }
  return referencesByFile;
}

async function collectInternalReferences(files: HostingerFileRecord[]): Promise<InternalReference[]> {
  const referencesByFile = await collectReferences(files);
  return uniqueReferences(files.flatMap(file => referencesByFile.get(file.id) || []));
}

async function listAllFiles(): Promise<HostingerFileRecord[]> {
  const pageSize = 200;
  const files: HostingerFileRecord[] = [];
  let offset = 0;
  while (true) {
    const page = await HostingerStorageService.listFiles({ limit: pageSize, offset });
    files.push(...page.items);
    if (!page.items.length || files.length >= page.total || page.items.length < pageSize) break;
    offset += page.items.length;
  }
  return files;
}

function findColumn(table: string, name: string): ReferenceColumn {
  const source = IMAGE_REFERENCE_SOURCES.find(entry => entry.table === table);
  const column = source?.columns.find(entry => entry.name === name);
  if (!source || !column) throw new Error(`Unknown image reference column ${table}.${name}`);
  return column;
}

async function clearReferences(
  client: any,
  files: HostingerFileRecord[],
  references: InternalReference[],
): Promise<void> {
  const index = buildFileIndex(files);
  const groups = new Map<string, InternalReference[]>();
  for (const reference of references) {
    const key = `${reference.table}.${reference.column}`;
    const group = groups.get(key) || [];
    group.push(reference);
    groups.set(key, group);
  }

  for (const [key, group] of groups) {
    const [table, columnName] = key.split('.');
    const column = findColumn(table, columnName);
    const source = IMAGE_REFERENCE_SOURCES.find(entry => entry.table === table)!;
    const rowIds = [...new Set(group.map(reference => reference.rowId))];

    if (column.kind === 'assets') {
      await client.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [rowIds]);
      continue;
    }
    if (column.kind === 'json') {
      for (const rowId of rowIds) {
        const current = await client.query(
          `SELECT "${column.name}" as "value" FROM ${table} WHERE ${source.primaryKey} = $1 FOR UPDATE`,
          [rowId]
        );
        if (!current.rows.length) continue;
        const dropVariantObjects = table === 'mart_products' && columnName === 'photo_variants';
        const rewritten: JsonRewrite = rewriteJsonValue(current.rows[0].value, index, dropVariantObjects);
        if (!rewritten.changed) continue;
        if (table === 'mart_carts' && columnName === 'items') {
          const totals = cartTotals(rewritten.value);
          await client.query(
            `UPDATE ${table} SET "${column.name}" = $2::jsonb, item_count = $3, subtotal = $4 WHERE ${source.primaryKey} = $1`,
            [rowId, JSON.stringify(rewritten.value), totals.itemCount, totals.subtotal]
          );
        } else {
          await client.query(
            `UPDATE ${table} SET "${column.name}" = $2::jsonb WHERE ${source.primaryKey} = $1`,
            [rowId, JSON.stringify(rewritten.value)]
          );
        }
      }
      continue;
    }
    if (column.kind === 'settings') {
      for (const reference of group) {
        await client.query(
          `UPDATE ${table} SET "${column.name}" = '' WHERE ${source.primaryKey} = $1 AND store_id IS NOT DISTINCT FROM $2`,
          [reference.rowId, reference.storeId ?? null]
        );
      }
      continue;
    }
    await client.query(
      `UPDATE ${table} SET "${column.name}" = NULL WHERE ${source.primaryKey} = ANY($1::uuid[])`,
      [rowIds]
    );
  }
}

async function collectAssetStorageIds(references: InternalReference[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const reference of references) {
    if (reference.table !== 'mart_product_image_assets') continue;
    for (const id of reference.storageIds || []) ids.add(id);
  }
  const assetIds = [...new Set(references
    .filter(reference => reference.table === 'mart_product_image_assets')
    .map(reference => reference.rowId))];
  if (assetIds.length) {
    const rows = await query<{ id: string; storageId: string | null }>(
      `SELECT id, storage_id as "storageId" FROM mart_product_image_assets WHERE id = ANY($1::uuid[])`,
      [assetIds]
    );
    for (const row of rows.rows) {
      for (const id of parseStorageIds(row.storageId)) ids.add(id);
    }
  }
  return [...ids];
}

async function loadSiblingFiles(storageIds: string[], targetId: string): Promise<HostingerFileRecord[]> {
  const ids = [...new Set(storageIds)].filter(id => id && id !== targetId);
  const files = await Promise.all(ids.map(id => HostingerStorageService.getFile(id)));
  return files.filter((file): file is HostingerFileRecord => Boolean(file));
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

export class ImageManagerService {
  static async listImages(params: ImageManagerListParams = {}): Promise<ImageManagerListResult> {
    const group = params.group === 'unreferenced' ? 'unreferenced' : 'referenced';
    const limit = clampNumber(params.limit, 50, 1, 200);
    const offset = Math.max(0, clampNumber(params.offset, 0, 0, Number.MAX_SAFE_INTEGER));
    const folder = (params.folder || '').trim();
    const search = (params.search || '').trim().toLowerCase();

    const files = await listAllFiles();
    const referencesByFile = await collectReferences(files);
    const folders = [...new Set(files.map(file => file.folder).filter(Boolean))].sort();

    const enriched = files
      .filter(file => (!folder || file.folder === folder)
        && (!search || [file.folder, file.filename, file.originalName, file.url]
          .some(value => String(value || '').toLowerCase().includes(search))))
      .map(file => toImageManagerFile(file, sortReferences(referencesByFile.get(file.id) || [])));

    const matching = enriched.filter(file => file.referenced === (group === 'referenced'));
    const referencedTotal = enriched.filter(file => file.referenced).length;
    return {
      items: matching.slice(offset, offset + limit),
      total: matching.length,
      folders,
      referencedTotal,
      unreferencedTotal: enriched.length - referencedTotal,
    };
  }

  static async getImage(id: string): Promise<{ file: ImageManagerFile; references: ImageReference[] } | null> {
    const file = await HostingerStorageService.getFile(id);
    if (!file) return null;
    const references = sortReferences(await collectInternalReferences([file]));
    return { file: toImageManagerFile(file, references), references: references.map(publicReference) };
  }

  static async deleteImage(id: string, options: { dryRun?: boolean; detach?: boolean } = {}): Promise<ImageManagerDeleteResult | null> {
    const dryRun = options.dryRun !== false;
    const detach = options.detach === true;
    const file = await HostingerStorageService.getFile(id);
    if (!file) return null;

    const initialReferences = await collectInternalReferences([file]);
    const assetStorageIds = await collectAssetStorageIds(initialReferences);
    const siblingFiles = await loadSiblingFiles(assetStorageIds, file.id);
    const files = [...new Map([file, ...siblingFiles].map(entry => [entry.id, entry])).values()];
    const internal = sortReferences(await collectInternalReferences(files));
    const references = internal.map(publicReference);
    if (internal.length && !detach) throw new ImageReferenceConflictError(references);

    if (dryRun) {
      return {
        dryRun: true,
        file: toImageManagerFile(file, internal),
        referenced: internal.length > 0,
        references,
        deletedIds: [],
        failedIds: [],
      };
    }

    await transaction(client => clearReferences(client, files, internal));

    const idsToDelete = [...new Set([file.id, ...assetStorageIds])];
    const deletedIds: string[] = [];
    const failedIds: string[] = [];
    for (const deleteId of idsToDelete) {
      try {
        await HostingerStorageService.deleteVerified(deleteId);
        deletedIds.push(deleteId);
      } catch {
        failedIds.push(deleteId);
      }
    }
    if (failedIds.length) throw new ImageStorageDeleteError(failedIds, deletedIds);

    return {
      dryRun: false,
      file: toImageManagerFile(file, internal),
      referenced: internal.length > 0,
      references,
      deletedIds,
      failedIds,
    };
  }
}
