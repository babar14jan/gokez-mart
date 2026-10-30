import { query } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import { evaluateStoreOpen, type StoreOpenState } from '../utils/storeHours';
import { badRequest, conflict, notFound } from '../utils/apiError';

export interface ZoneStoreRef {
  id: string;
  name: string;
  isPrimary: boolean;
}

export interface ZoneSettings {
  [key: string]: string;
}

export interface MartZone {
  id: string;
  storeId: string;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
  isActive: boolean;
  sortOrder: number;
  /** The zone head: whose name/address the customer app shows. */
  primaryStoreId: string | null;
  /** Zone-level weekly schedule; wins over every member store's. */
  openingHours: Record<string, { open?: string; close?: string; closed?: boolean } | null> | null;
  /** Tagged stores inside this zone (set queries attach it). */
  stores?: ZoneStoreRef[];
  /** Resolved head store, when one is tagged. */
  primaryStore?: { id: string; name: string; address: string | null } | null;
  /** Live open/close state computed from zone hours + zone settings. */
  openState?: StoreOpenState | null;
}

const ZONE_SELECT = `SELECT z.id, z.store_id as "storeId", z.name, z.lat::float, z.lng::float,
               z.radius_km::float as "radiusKm",
               z.is_active as "isActive", z.sort_order as "sortOrder",
               z.primary_store_id as "primaryStoreId", z.opening_hours as "openingHours",
               (SELECT s.name FROM mart_stores s WHERE s.id = z.primary_store_id) as "primaryStoreName",
               (SELECT s.address FROM mart_stores s WHERE s.id = z.primary_store_id) as "primaryStoreAddress"
       FROM mart_zones z`;

/** The open-state keys that live at zone scope. Mirrors the store keys they
 *  supersede; the zone's value always wins. */
export const ZONE_SETTING_KEYS = [
  'store_open', 'store_closed_from', 'store_closed_until',
  'store_closed_message', 'store_closed_greeting',
];

export class ZoneService {
  static async findAll(activeOnly = false, storeId?: string): Promise<MartZone[]> {
    const zones = await this.findByIds(undefined, activeOnly, storeId);
    await this.enrich(zones);
    return zones;
  }

  static async findById(id: string): Promise<MartZone | null> {
    const zones = await this.findByIds([id]);
    await this.enrich(zones);
    return zones[0] || null;
  }

  private static async findByIds(zoneIds: string[] | undefined, activeOnly = false, storeId?: string): Promise<MartZone[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (zoneIds) {
      if (zoneIds.length === 0) return [];
      conditions.push(`z.id = ANY($${i++})`);
      params.push(zoneIds);
    }
    if (activeOnly) conditions.push(`z.is_active = true`);
    if (storeId) {
      // A zone "belongs" to a store for listing purposes when that store is
      // one of its members (or, for legacy zones, its single linked store).
      conditions.push(`(z.store_id = $${i} OR EXISTS (SELECT 1 FROM mart_zone_stores zs WHERE zs.zone_id = z.id AND zs.store_id = $${i}))`);
      params.push(storeId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query<MartZone>(
      `${ZONE_SELECT} ${where} ORDER BY z.sort_order ASC, z.name ASC`,
      params
    );
    return result.rows;
  }

  /** Attach the tagged-store list to each zone in one query. */
  private static async enrich(zones: MartZone[]): Promise<void> {
    if (!zones.length) return;
    const ids = zones.map(z => z.id);
    const tagResult = await query<{ zone_id: string; store_id: string; name: string; primary_store_id: string; address: string | null }>(
      `SELECT zs.zone_id, zs.store_id, s.name, s.address, z.primary_store_id
         FROM mart_zone_stores zs
         JOIN mart_stores s ON s.id = zs.store_id
         JOIN mart_zones z ON z.id = zs.zone_id
        WHERE zs.zone_id = ANY($1)
        ORDER BY s.name ASC`,
      [ids]
    );
    for (const zone of zones) {
      const rows = tagResult.rows.filter(row => row.zone_id === zone.id);
      zone.stores = rows.map(row => ({ id: row.store_id, name: row.name, isPrimary: zone.primaryStoreId === row.store_id }));
      const primaryRow = rows.find(row => row.store_id === zone.primaryStoreId);
      zone.primaryStore = primaryRow
        ? { id: primaryRow.store_id, name: primaryRow.name, address: primaryRow.address }
        : (zone.primaryStoreId ? { id: zone.primaryStoreId, name: '', address: null } : null);
    }
  }

  static async create(data: Partial<MartZone>): Promise<MartZone> {
    if (data.lat !== undefined && (!Number.isFinite(data.lat) || data.lat < -90 || data.lat > 90)) {
      throw badRequest('Zone centre latitude is invalid');
    }
    if (data.lng !== undefined && (!Number.isFinite(data.lng) || data.lng < -180 || data.lng > 180)) {
      throw badRequest('Zone centre longitude is invalid');
    }
    if (data.radiusKm !== undefined && (!Number.isFinite(data.radiusKm) || data.radiusKm <= 0)) {
      throw badRequest('Zone radius must be greater than zero');
    }
    const id = uuidv4();
    const headId = data.primaryStoreId ?? data.storeId ?? null;
    const isActive = data.isActive !== false;
    if (headId) {
      const store = await query(`SELECT id FROM mart_stores WHERE id = $1`, [headId]);
      if (!store.rows.length) throw badRequest('Zone head store not found');
      if (isActive) {
        const existing = await query(`SELECT id FROM mart_zones WHERE primary_store_id = $1 AND is_active = true`, [headId]);
        if (existing.rows.length) throw conflict('Store is already the head of another active zone');
      }
    }
    await query(
      `INSERT INTO mart_zones (id, store_id, name, lat, lng, radius_km, is_active, sort_order, primary_store_id, opening_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, data.storeId ?? null, data.name, data.lat, data.lng, data.radiusKm ?? 5, isActive, data.sortOrder ?? 0,
       headId, data.openingHours ?? null]
    );
    // A freshly created zone still needs its open/close behaviour to match a
    // single-store zone: lift the head store's open-state settings and hours so
    // nothing changes for zones created the old way.
    if (headId) {
      await this.updateSettings(id, await storeOpenStateSnapshot(headId));
      const hours = await query<{ opening_hours: unknown }>(`SELECT opening_hours FROM mart_stores WHERE id = $1`, [headId]);
      if (hours.rows[0]?.opening_hours) {
        await query(`UPDATE mart_zones SET opening_hours = $1 WHERE id = $2`, [hours.rows[0].opening_hours, id]);
      }
    }
    return (await this.findById(id))!;
  }

  static async update(id: string, data: Partial<MartZone>): Promise<MartZone | null> {
    if (data.lat !== undefined && (!Number.isFinite(data.lat) || data.lat < -90 || data.lat > 90)) {
      throw badRequest('Zone centre latitude is invalid');
    }
    if (data.lng !== undefined && (!Number.isFinite(data.lng) || data.lng < -180 || data.lng > 180)) {
      throw badRequest('Zone centre longitude is invalid');
    }
    if (data.radiusKm !== undefined && (!Number.isFinite(data.radiusKm) || data.radiusKm <= 0)) {
      throw badRequest('Zone radius must be greater than zero');
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (data.name !== undefined)     { fields.push(`name = $${i++}`);      params.push(data.name); }
    if (data.lat !== undefined)      { fields.push(`lat = $${i++}`);       params.push(data.lat); }
    if (data.lng !== undefined)      { fields.push(`lng = $${i++}`);       params.push(data.lng); }
    if (data.radiusKm !== undefined) { fields.push(`radius_km = $${i++}`); params.push(data.radiusKm); }
    if (data.isActive !== undefined) { fields.push(`is_active = $${i++}`); params.push(data.isActive); }
    if (data.sortOrder !== undefined){ fields.push(`sort_order = $${i++}`);params.push(data.sortOrder); }
    if (data.openingHours !== undefined) { fields.push(`opening_hours = $${i++}`); params.push(data.openingHours); }
    // primary_store_id and the tagged store set have their own dedicated endpoints.
    if (!fields.length) return this.findById(id);
    fields.push(`updated_at = NOW()`);
    params.push(id);
    await query(`UPDATE mart_zones SET ${fields.join(', ')} WHERE id = $${i}`, params);
    return this.findById(id);
  }

  /**
   * Replace the zone's tagged stores. Every store must exist; the current
   * primary store, when set, is kept tagged so the head can never dangle.
   */
  static async tagStores(zoneId: string, storeIds: string[]): Promise<MartZone | null> {
    const zone = await this.findById(zoneId);
    if (!zone) return null;
    const clean = Array.from(new Set(storeIds.filter(Boolean)));
    if (zone.primaryStoreId && !clean.includes(zone.primaryStoreId)) clean.push(zone.primaryStoreId);
    for (const storeId of clean) {
      const store = await query(`SELECT id FROM mart_stores WHERE id = $1`, [storeId]);
      if (!store.rows.length) throw badRequest('Tagged store not found');
      if (zone.isActive) {
        const conflictZone = await query(
          `SELECT z.id
             FROM mart_zone_stores zs
             JOIN mart_zones z ON z.id = zs.zone_id
            WHERE zs.store_id = $1 AND z.is_active = true AND z.id <> $2`,
          [storeId, zoneId]
        );
        if (conflictZone.rows.length) throw conflict('Store is already tagged in another active zone');
      }
    }
    const keep = clean.length ? clean : ['00000000-0000-0000-0000-000000000000'];
    await query(
      `DELETE FROM mart_zone_stores
        WHERE zone_id = $1 AND store_id <> ALL($2::uuid[])`,
      [zoneId, keep]
    );
    for (const storeId of clean) {
      await query(
        `INSERT INTO mart_zone_stores (zone_id, store_id) VALUES ($1, $2) ON CONFLICT (zone_id, store_id) DO NOTHING`,
        [zoneId, storeId]
      );
    }
    await query(`UPDATE mart_zones SET updated_at = NOW() WHERE id = $1`, [zoneId]);
    return this.findById(zoneId);
  }

  /**
   * Set the zone head. The head is always a member: picking a store that is
   * not tagged yet auto-tags it. The legacy `store_id` column tracks the head
   * too so the old `store_id = '...'` lookups keep working.
   */
  static async setPrimaryStore(zoneId: string, storeId: string): Promise<MartZone | null> {
    const zone = await this.findById(zoneId);
    if (!zone) return null;
    const store = await query(`SELECT id FROM mart_stores WHERE id = $1`, [storeId]);
    if (!store.rows.length) throw badRequest('Zone head store not found');
    if (zone.isActive) {
      const existing = await query(
        `SELECT id FROM mart_zones WHERE primary_store_id = $1 AND is_active = true AND id <> $2`,
        [storeId, zoneId]
      );
      if (existing.rows.length) throw conflict('Store is already the head of another active zone');
      const conflictZone = await query(
        `SELECT z.id
           FROM mart_zone_stores zs
           JOIN mart_zones z ON z.id = zs.zone_id
          WHERE zs.store_id = $1 AND z.is_active = true AND z.id <> $2`,
        [storeId, zoneId]
      );
      if (conflictZone.rows.length) throw conflict('Store is already tagged in another active zone');
    }
    await query(
      `INSERT INTO mart_zone_stores (zone_id, store_id) VALUES ($1, $2) ON CONFLICT (zone_id, store_id) DO NOTHING`,
      [zoneId, storeId]
    );
    await query(
      `UPDATE mart_zones SET primary_store_id = $1, store_id = $1, updated_at = NOW() WHERE id = $2`,
      [storeId, zoneId]
    );
    return this.findById(zoneId);
  }

  // ── Zone-level settings: open/close override + closure window ─────────────

  static async getSettings(zoneId: string): Promise<ZoneSettings> {
    const result = await query<{ key: string; value: string }>(
      `SELECT key, value FROM mart_zone_settings WHERE zone_id = $1`, [zoneId]
    );
    return Object.fromEntries(result.rows.map(r => [r.key, r.value]));
  }

  static async updateSettings(zoneId: string, values: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      if (!ZONE_SETTING_KEYS.includes(key)) continue; // ignore unknown keys
      await query(
        `INSERT INTO mart_zone_settings (zone_id, key, value, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (zone_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [zoneId, key, String(value)]
      );
    }
  }

  /**
   * Live open/close state for a zone. Zone hours + zone settings win; when a
   * zone has no zone-scoped value yet (never configured from the hub), it
   * falls back to the head store's store-scoped copy so a fresh zone behaves
   * exactly like today's single-store zone.
   */
  static async getOpenState(zoneId: string): Promise<StoreOpenState | null> {
    const zone = await this.findById(zoneId);
    if (!zone) return null;
    const settings = await this.getSettings(zoneId);
    const fallback = zone.primaryStoreId
      ? await query<{ key: string; value: string }>(
          `SELECT key, value FROM mart_settings WHERE store_id = $1
            AND key IN ('store_open', 'store_closed_from', 'store_closed_until')`,
          [zone.primaryStoreId]
        )
      : { rows: [] as Array<{ key: string; value: string }> };
    const fallbackMap = Object.fromEntries(fallback.rows.map(r => [r.key, r.value]));
    const storeOpen = settings.store_open ?? fallbackMap.store_open;
    const closure = {
      from: settings.store_closed_from ?? fallbackMap.store_closed_from,
      until: settings.store_closed_until ?? fallbackMap.store_closed_until,
    };
    return evaluateStoreOpen(zone.openingHours as never, storeOpen, new Date(), closure);
  }

  static async delete(id: string): Promise<void> {
    await query(`DELETE FROM mart_zones WHERE id = $1`, [id]);
  }
}

/** Snapshot of a store's open-state keys, for lifting onto a new zone. */
async function storeOpenStateSnapshot(storeId: string): Promise<Record<string, string>> {
  const result = await query<{ key: string; value: string }>(
    `SELECT key, value FROM mart_settings WHERE store_id = $1
      AND key = ANY($2)`,
    [storeId, ZONE_SETTING_KEYS]
  );
  return Object.fromEntries(result.rows.map(r => [r.key, r.value]));
}
