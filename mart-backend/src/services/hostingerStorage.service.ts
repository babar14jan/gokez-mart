import { config } from '../config';
import { OUTBOUND_TIMEOUTS, timeoutSignal } from '../utils/timeouts';

export interface HostingerUploadResult {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  filename: string;
  folder: string;
  mimeType: string;
  size: number;
}

export interface HostingerFileRecord {
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
  thumbnailFilename?: string | null;
}

export interface HostingerListResult {
  items: HostingerFileRecord[];
  total: number;
}

export class HostingerStorageService {
  static isConfigured(): boolean {
    return Boolean(config.hostinger.url && config.hostinger.apiKey);
  }

  static async upload(folder: string, buffer: Buffer, originalName: string): Promise<HostingerUploadResult> {
    if (!this.isConfigured()) throw new Error('Hostinger storage is not configured (HOSTINGER_STORAGE_URL / HOSTINGER_STORAGE_API_KEY).');
    const form = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' });
    form.append('file', blob, originalName);
    form.append('folder', folder);

    const res = await fetch(`${config.hostinger.url.replace(/\/$/, '')}/api/v1/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.hostinger.apiKey}`,
        'X-Project-Id': config.hostinger.projectId,
      },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Hostinger storage upload failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const json = await res.json() as { success: boolean; data: HostingerUploadResult };
    if (!json?.success || !json.data?.url) throw new Error('Hostinger storage returned an invalid response');
    return json.data;
  }

  static async listFiles(params: { folder?: string; search?: string; limit?: number; offset?: number } = {}): Promise<HostingerListResult> {
    if (!this.isConfigured()) throw new Error('Hostinger storage is not configured (HOSTINGER_STORAGE_URL / HOSTINGER_STORAGE_API_KEY).');
    const searchParams = new URLSearchParams();
    if (params.folder) searchParams.set('folder', params.folder);
    if (params.search) searchParams.set('search', params.search);
    if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params.offset !== undefined) searchParams.set('offset', String(params.offset));
    const suffix = searchParams.toString();
    const res = await fetch(`${config.hostinger.url.replace(/\/$/, '')}/api/v1/files${suffix ? `?${suffix}` : ''}`, {
      headers: {
        'Authorization': `Bearer ${config.hostinger.apiKey}`,
        'X-Project-Id': config.hostinger.projectId,
      },
      signal: timeoutSignal(OUTBOUND_TIMEOUTS.storageUpload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Hostinger storage list failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const json = await res.json() as { success: boolean; data?: HostingerListResult };
    if (!json?.success || !Array.isArray(json.data?.items)) throw new Error('Hostinger storage returned an invalid file list');
    return {
      items: json.data.items,
      total: typeof json.data.total === 'number' ? json.data.total : json.data.items.length,
    };
  }

  static async getFile(id: string): Promise<HostingerFileRecord | null> {
    if (!this.isConfigured()) throw new Error('Hostinger storage is not configured (HOSTINGER_STORAGE_URL / HOSTINGER_STORAGE_API_KEY).');
    const res = await fetch(`${config.hostinger.url.replace(/\/$/, '')}/api/v1/files/${encodeURIComponent(id)}`, {
      headers: {
        'Authorization': `Bearer ${config.hostinger.apiKey}`,
        'X-Project-Id': config.hostinger.projectId,
      },
      signal: timeoutSignal(OUTBOUND_TIMEOUTS.storageUpload),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Hostinger storage metadata fetch failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const json = await res.json() as { success: boolean; data?: HostingerFileRecord };
    if (!json?.success || !json.data?.id) throw new Error('Hostinger storage returned invalid file metadata');
    return json.data;
  }

  static async deleteVerified(id: string): Promise<void> {
    if (!this.isConfigured()) throw new Error('Hostinger storage is not configured (HOSTINGER_STORAGE_URL / HOSTINGER_STORAGE_API_KEY).');
    const res = await fetch(`${config.hostinger.url.replace(/\/$/, '')}/api/v1/files/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${config.hostinger.apiKey}`,
        'X-Project-Id': config.hostinger.projectId,
      },
      signal: timeoutSignal(OUTBOUND_TIMEOUTS.storageUpload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Hostinger storage delete failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const json = await res.json().catch(() => null) as { success?: boolean } | null;
    if (json?.success !== true) throw new Error('Hostinger storage delete was rejected');
  }

  static async delete(id: string): Promise<void> {
    if (!this.isConfigured()) return;
    try {
      await fetch(`${config.hostinger.url.replace(/\/$/, '')}/api/v1/files/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${config.hostinger.apiKey}`,
          'X-Project-Id': config.hostinger.projectId,
        },
      });
    } catch {
      // best effort
    }
  }
}
