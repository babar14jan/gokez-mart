import { query } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

export interface TeamMember {
  id: string;
  adminId: string;
  username: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
  assignmentActive: boolean;
  assignedAt: string;
  stores?: { id: string; name: string; isActive: boolean }[];
}

export class TeamService {

  // Get all members assigned to a store
  static async getStoreTeam(storeId: string): Promise<TeamMember[]> {
    const result = await query<TeamMember>(
      `SELECT a.id as "adminId", a.username, a.name, a.email, a.phone,
              asa.role, a.is_active as "isActive",
              asa.is_active as "assignmentActive",
              asa.created_at as "assignedAt"
       FROM mart_admin_store_assignments asa
       JOIN mart_admins a ON a.id = asa.admin_id
       WHERE asa.store_id = $1
       ORDER BY asa.created_at ASC`,
      [storeId]
    );
    return result.rows;
  }

  // Get all stores a user is assigned to
  static async getUserStores(adminId: string): Promise<{ id: string; name: string; isActive: boolean; role: string }[]> {
    const result = await query(
      `SELECT s.id, s.name, asa.is_active as "isActive", asa.role
       FROM mart_admin_store_assignments asa
       JOIN mart_stores s ON s.id = asa.store_id
       WHERE asa.admin_id = $1
       ORDER BY s.name ASC`,
      [adminId]
    );
    return result.rows;
  }

  // Lookup user by phone
  static async lookupByPhone(phone: string): Promise<any | null> {
    const cleaned = phone.replace(/\D/g, '');
    const result = await query(
      `SELECT id, username, name, phone, role, store_id as "storeId"
       FROM mart_admins WHERE phone = $1 OR phone = $2`,
      [phone, cleaned]
    );
    return result.rows[0] || null;
  }

  // Add existing user to store
  static async addToStore(adminId: string, storeId: string, role: string, assignedBy: string): Promise<void> {
    await query(
      `INSERT INTO mart_admin_store_assignments (admin_id, store_id, role, assigned_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (admin_id, store_id) DO UPDATE SET
         role = EXCLUDED.role, is_active = true, assigned_by = EXCLUDED.assigned_by, updated_at = NOW()`,
      [adminId, storeId, role, assignedBy]
    );
    // Update primary store_id if not set
    await query(
      `UPDATE mart_admins SET store_id = $1 WHERE id = $2 AND store_id IS NULL`,
      [storeId, adminId]
    );
  }

  // Create new user and assign to store
  static async createAndAssign(data: {
    username: string; password: string; name?: string;
    phone?: string; email?: string; role: string;
    storeId: string; assignedBy: string;
  }): Promise<any> {
    const existing = await query(`SELECT 1 FROM mart_admins WHERE username = $1`, [data.username]);
    if (existing.rows.length) throw new Error('Username already exists');
    const hash = await bcrypt.hash(data.password, 12);
    const id = uuidv4();
    const result = await query(
      `INSERT INTO mart_admins (id, username, password_hash, name, phone, email, role, store_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, username, name, phone, email, role`,
      [id, data.username, hash, data.name || null, data.phone || null,
       data.email || null, data.role, data.storeId]
    );
    await this.addToStore(id, data.storeId, data.role, data.assignedBy);
    return result.rows[0];
  }

  // Update assignment (role or active status)
  static async updateAssignment(adminId: string, storeId: string, data: {
    role?: string; isActive?: boolean;
  }): Promise<void> {
    const fields: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (data.role !== undefined)     { fields.push(`role = $${i++}`);      params.push(data.role); }
    if (data.isActive !== undefined) { fields.push(`is_active = $${i++}`); params.push(data.isActive); }
    if (!fields.length) return;
    fields.push(`updated_at = NOW()`);
    params.push(adminId, storeId);
    await query(
      `UPDATE mart_admin_store_assignments SET ${fields.join(', ')}
       WHERE admin_id = $${i} AND store_id = $${i + 1}`,
      params
    );
  }

  // Remove user from store
  static async removeFromStore(adminId: string, storeId: string): Promise<void> {
    await query(
      `UPDATE mart_admin_store_assignments SET is_active = false, updated_at = NOW()
       WHERE admin_id = $1 AND store_id = $2`,
      [adminId, storeId]
    );
  }

  // Deactivate all assignments for a store (when store is deactivated)
  static async deactivateStoreAssignments(storeId: string): Promise<void> {
    await query(
      `UPDATE mart_admin_store_assignments SET is_active = false, updated_at = NOW()
       WHERE store_id = $1`,
      [storeId]
    );
  }
}
