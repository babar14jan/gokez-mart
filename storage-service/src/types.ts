export interface FileRecord {
  id: string;
  projectId: string;
  folder: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  thumbnailFilename: string | null;
  url: string;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadResult {
  id: string;
  folder: string;
  filename: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
}
