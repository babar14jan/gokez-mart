import fetch from 'node-fetch';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { query } from '../database/db';
import { config } from '../config';
import { badRequest } from '../utils/apiError';
import { OUTBOUND_TIMEOUTS, timeoutSignal } from '../utils/timeouts';

type StorageDriver = 'local' | 'supabase';
type AssetStatus = 'pending' | 'active' | 'cleanup_queued';

type ProductImageAsset = {
  id: string;
  productId: string | null;
  uploadedBy: string | null;
  thumbnailUrl: string;
  largeUrl: string;
  thumbnailKey: string;
  largeKey: string;
  storageDriver: StorageDriver;
  status: AssetStatus;
};

const PENDING_UPLOAD_TTL = '1 hour';
const REMOVED_IMAGE_GRACE = '15 minutes';

export class ProductImageAssetService {
  static async createPending(asset: Omit<ProductImageAsset, 'productId' | 'status'>): Promise<void> {
    await query(
      `INSERT INTO mart_product_image_assets
         (id, uploaded_by, thumbnail_url, large_url, thumbnail_key, large_key, storage_driver)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [asset.id, asset.uploadedBy, asset.thumbnailUrl, asset.largeUrl, asset.thumbnailKey, asset.largeKey, asset.storageDriver]
    );
  }

  static async syncProductAssets(client: any, productId: string, assetIds: unknown, adminId: string): Promise<void> {
    if (!Array.isArray(assetIds) || assetIds.some(id => typeof id !== 'string')) {
      throw badRequest('imageAssetIds must be an array of uploaded image IDs');
    }
    const ids = [...new Set(assetIds)];
    if (ids.length > 4) throw badRequest('A product can have at most four images');

    const existing = await client.query(
      `SELECT id, product_id as "productId", uploaded_by as "uploadedBy", status
         FROM mart_product_image_assets
        WHERE product_id = $1 AND status = 'active'
        FOR UPDATE`,
      [productId]
    );
    const selected = ids.length
      ? await client.query(
        `SELECT id, product_id as "productId", uploaded_by as "uploadedBy", status
           FROM mart_product_image_assets
          WHERE id = ANY($1::uuid[])
          FOR UPDATE`,
        [ids]
      )
      : { rows: [] };
    if (selected.rows.length !== ids.length) throw badRequest('One or more uploaded images could not be found');

    for (const asset of selected.rows as Array<Pick<ProductImageAsset, 'productId' | 'uploadedBy' | 'status'>>) {
      if (asset.status === 'pending' && asset.uploadedBy !== adminId) throw badRequest('An uploaded image belongs to another admin');
      if (asset.status === 'active' && asset.productId !== productId) throw badRequest('An uploaded image is already attached to another product');
      if (asset.status === 'cleanup_queued') throw badRequest('An uploaded image is no longer available');
    }

    const selectedIds = new Set(ids);
    const removedIds = (existing.rows as Array<{ id: string }>).map(asset => asset.id).filter(id => !selectedIds.has(id));
    if (removedIds.length) {
      await client.query(
        `UPDATE mart_product_image_assets
            SET status = 'cleanup_queued', cleanup_after = NOW() + INTERVAL '${REMOVED_IMAGE_GRACE}'
          WHERE id = ANY($1::uuid[])`,
        [removedIds]
      );
    }

    for (const [sortOrder, id] of ids.entries()) {
      await client.query(
        `UPDATE mart_product_image_assets
            SET product_id = $1, status = 'active', sort_order = $2, attached_at = NOW(), cleanup_after = NULL, last_cleanup_error = NULL
          WHERE id = $3`,
        [productId, sortOrder, id]
      );
    }
  }

  static async queueProductAssets(client: any, productId: string): Promise<void> {
    await client.query(
      `UPDATE mart_product_image_assets
          SET product_id = NULL, status = 'cleanup_queued', cleanup_after = NOW() + INTERVAL '${REMOVED_IMAGE_GRACE}'
        WHERE product_id = $1 AND status = 'active'`,
      [productId]
    );
  }

  static async getCatalogAssetVariants(productIds: string[]): Promise<Map<string, Array<{ assetId: string; thumbnailUrl: string; largeUrl: string }>>> {
    if (!productIds.length) return new Map();
    const result = await query<{ productId: string; assetId: string; thumbnailUrl: string; largeUrl: string }>(
      `SELECT product_id as "productId", id as "assetId", thumbnail_url as "thumbnailUrl", large_url as "largeUrl"
         FROM mart_product_image_assets
        WHERE product_id = ANY($1::uuid[]) AND status = 'active'
        ORDER BY product_id, sort_order`,
      [productIds]
    );
    const byProduct = new Map<string, Array<{ assetId: string; thumbnailUrl: string; largeUrl: string }>>();
    for (const asset of result.rows) {
      const entries = byProduct.get(asset.productId) || [];
      entries.push({ assetId: asset.assetId, thumbnailUrl: asset.thumbnailUrl, largeUrl: asset.largeUrl });
      byProduct.set(asset.productId, entries);
    }
    return byProduct;
  }

  static async cleanupDue(): Promise<void> {
    const due = await query<ProductImageAsset>(
      `SELECT id, product_id as "productId", uploaded_by as "uploadedBy", thumbnail_url as "thumbnailUrl", large_url as "largeUrl",
              thumbnail_key as "thumbnailKey", large_key as "largeKey", storage_driver as "storageDriver", status
         FROM mart_product_image_assets
        WHERE (status = 'pending' AND created_at <= NOW() - INTERVAL '${PENDING_UPLOAD_TTL}')
           OR (status = 'cleanup_queued' AND cleanup_after <= NOW())
        ORDER BY created_at
        LIMIT 20`
    );
    for (const asset of due.rows) {
      try {
        await this.deleteStoragePair(asset);
        await query(`DELETE FROM mart_product_image_assets WHERE id = $1`, [asset.id]);
      } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 500) : 'Unknown cleanup failure';
        await query(
          `UPDATE mart_product_image_assets
              SET cleanup_attempts = cleanup_attempts + 1, last_cleanup_error = $2, cleanup_after = NOW() + INTERVAL '15 minutes'
            WHERE id = $1`,
          [asset.id, detail]
        );
      }
    }
  }

  private static async deleteStoragePair(asset: ProductImageAsset): Promise<void> {
    if (asset.storageDriver === 'local') {
      const uploadsDir = path.resolve(__dirname, '../../uploads');
      await Promise.all([asset.thumbnailKey, asset.largeKey].map(async key => {
        const target = path.resolve(uploadsDir, key);
        if (!target.startsWith(`${uploadsDir}${path.sep}`)) throw new Error('Invalid local image path');
        try { await unlink(target); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
      }));
      return;
    }

    const response = await fetch(`${config.supabase.url}/storage/v1/object/${config.supabase.bucket}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${config.supabase.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: [asset.thumbnailKey, asset.largeKey] }),
      signal: timeoutSignal(OUTBOUND_TIMEOUTS.storageUpload),
    });
    if (!response.ok) {
      await response.text();
      throw new Error('Supabase image cleanup failed');
    }
  }
}
