import { config } from '../config';

export interface HostingerUploadResult {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  filename: string;
  folder: string;
  mimeType: string;
  size: number;
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
