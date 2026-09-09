import { query } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

export interface MartStore {
  id: string;
  name: string;
  address: string | null;
  isActive: boolean;
  isLive: boolean;
  logoUrl: string | null;
  supportPhone: string | null;
  openingHours: Record<string, { open: string; close: string; closed: boolean }> | null;
  ownerName: string | null;
  revenueModel: 'commission' | 'flat' | 'both';
  commissionPercent: number;
  monthlyFee: number;
  createdAt: string;
}

export interface MartStoreApplication {
  id: string;
  storeName: string;
  ownerName: string;
  phone: string;
  area: string;
  message: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

const STORE_SELECT = `
  SELECT id, name, address, is_active as "isActive", is_live as "isLive",
         logo_url as "logoUrl", support_phone as "supportPhone",
         opening_hours as "openingHours", owner_name as "ownerName",
         revenue_model as "revenueModel",
         commission_percent::float as "commissionPercent",
         monthly_fee::float as "monthlyFee",
         created_at as "createdAt"
  FROM mart_stores
`;

export class StoreService {
  static async findAll(): Promise<MartStore[]> {
    const result = await query<MartStore>(`${STORE_SELECT} ORDER BY name ASC`);
    return result.rows;
  }

  static async findById(id: string): Promise<MartStore | null> {
    const result = await query<MartStore>(`${STORE_SELECT} WHERE id = $1`, [id]);
    return result.rows[0] || null;
  }

  static async findByZone(zoneId: string): Promise<MartStore | null> {
    const result = await query<MartStore>(
      `SELECT s.id, s.name, s.address, s.is_active as "isActive", s.is_live as "isLive",
              s.logo_url as "logoUrl", s.support_phone as "supportPhone",
              s.opening_hours as "openingHours", s.owner_name as "ownerName",
              s.revenue_model as "revenueModel",
              s.commission_percent::float as "commissionPercent",
              s.monthly_fee::float as "monthlyFee",
              s.created_at as "createdAt"
       FROM mart_stores s
       JOIN mart_zones z ON z.store_id = s.id
       WHERE z.id = $1 AND s.is_active = true`,
      [zoneId]
    );
    return result.rows[0] || null;
  }

  static async create(data: {
    name: string; address?: string; ownerName?: string;
    revenueModel?: string; commissionPercent?: number; monthlyFee?: number;
  }): Promise<MartStore> {
    const id = uuidv4();
    const result = await query<MartStore>(
      `INSERT INTO mart_stores (id, name, address, owner_name, revenue_model, commission_percent, monthly_fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, address, is_active as "isActive", is_live as "isLive",
                 logo_url as "logoUrl", support_phone as "supportPhone",
                 opening_hours as "openingHours", owner_name as "ownerName",
                 revenue_model as "revenueModel",
                 commission_percent::float as "commissionPercent",
                 monthly_fee::float as "monthlyFee",
                 created_at as "createdAt"`,
      [id, data.name, data.address || null, data.ownerName || null,
       data.revenueModel || 'commission', data.commissionPercent || 10, data.monthlyFee || 0]
    );
    return result.rows[0];
  }

  static async update(id: string, data: {
    name?: string; address?: string; isActive?: boolean; isLive?: boolean;
    logoUrl?: string; supportPhone?: string; openingHours?: any;
    ownerName?: string; revenueModel?: string;
    commissionPercent?: number; monthlyFee?: number;
  }): Promise<MartStore | null> {
    const fields: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (data.name !== undefined)             { fields.push(`name = $${i++}`);              params.push(data.name); }
    if (data.address !== undefined)          { fields.push(`address = $${i++}`);           params.push(data.address); }
    if (data.isActive !== undefined)         { fields.push(`is_active = $${i++}`);         params.push(data.isActive); }
    if (data.isLive !== undefined)           { fields.push(`is_live = $${i++}`);           params.push(data.isLive); }
    if (data.logoUrl !== undefined)          { fields.push(`logo_url = $${i++}`);          params.push(data.logoUrl); }
    if (data.supportPhone !== undefined)     { fields.push(`support_phone = $${i++}`);     params.push(data.supportPhone); }
    if (data.openingHours !== undefined)     { fields.push(`opening_hours = $${i++}`);     params.push(JSON.stringify(data.openingHours)); }
    if (data.ownerName !== undefined)        { fields.push(`owner_name = $${i++}`);        params.push(data.ownerName); }
    if (data.revenueModel !== undefined)     { fields.push(`revenue_model = $${i++}`);     params.push(data.revenueModel); }
    if (data.commissionPercent !== undefined){ fields.push(`commission_percent = $${i++}`);params.push(data.commissionPercent); }
    if (data.monthlyFee !== undefined)       { fields.push(`monthly_fee = $${i++}`);       params.push(data.monthlyFee); }
    if (!fields.length) return this.findById(id);
    fields.push(`updated_at = NOW()`);
    params.push(id);
    const result = await query<MartStore>(
      `UPDATE mart_stores SET ${fields.join(', ')} WHERE id = $${i}
       RETURNING id, name, address, is_active as "isActive", is_live as "isLive",
                 logo_url as "logoUrl", support_phone as "supportPhone",
                 opening_hours as "openingHours", owner_name as "ownerName",
                 revenue_model as "revenueModel",
                 commission_percent::float as "commissionPercent",
                 monthly_fee::float as "monthlyFee",
                 created_at as "createdAt"`,
      params
    );
    return result.rows[0] || null;
  }

  // ── Store Applications ────────────────────────────────────────────────────

  static async createApplication(data: {
    storeName: string; ownerName: string; phone: string; area: string; message?: string;
  }): Promise<MartStoreApplication> {
    const result = await query<MartStoreApplication>(
      `INSERT INTO mart_store_applications (store_name, owner_name, phone, area, message)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, store_name as "storeName", owner_name as "ownerName",
                 phone, area, message, status, created_at as "createdAt"`,
      [data.storeName, data.ownerName, data.phone, data.area, data.message || null]
    );
    return result.rows[0];
  }

  static async findAllApplications(): Promise<MartStoreApplication[]> {
    const result = await query<MartStoreApplication>(
      `SELECT id, store_name as "storeName", owner_name as "ownerName",
              phone, area, message, status, created_at as "createdAt"
       FROM mart_store_applications ORDER BY created_at DESC`
    );
    return result.rows;
  }

  static async updateApplication(id: string, status: 'approved' | 'rejected', reviewedBy: string): Promise<void> {
    await query(
      `UPDATE mart_store_applications SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3`,
      [status, reviewedBy, id]
    );
  }
}
