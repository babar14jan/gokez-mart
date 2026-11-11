# Gokez Storage Service

Central image storage API for Gokez Mart. Writes files to `/opt/gokez-mart/` (five folders: category, catalog, profile, banner, other). Exposes public read URLs under `https://images.gokez.com/`.

## Run locally

```bash
npm install
cp .env.example .env
# edit .env
npm run dev
```

## Build

```bash
npm run build
npm start
```

## API

Base: `/api/v1`

- `GET /health` — health check (verifies storage root writable).
- `GET /files?folder=&search=&limit=&offset=` — list (project access required).
- `GET /files/:id` — metadata.
- `POST /files/upload` — multipart `file` + `folder` (write auth required). Returns `{ id, url, thumbnailUrl, ... }`.
- `PUT /files/:id` — replace file (multipart `file`).
- `DELETE /files/:id` — delete.

Headers for all requests: `X-Project-Id: gokez-mart`.
Write requests also require `Authorization: Bearer <STORAGE_API_KEY>`.

## Folders

Only `category`, `catalog`, `profile`, `banner`, `other` are accepted. Arbitrary paths are rejected.

## Security

- Actual image content validated via sharp (format allow-list JPEG/PNG/WebP/GIF).
- Size limit `MAX_UPLOAD_BYTES` (default 5MB).
- WebP conversion + EXIF stripping (sharp re-encode).
- Thumbnail generation (`THUMBNAIL_WIDTH`, default 240).
- Unique filenames (uuid).
- Path traversal protection.
- CORS restricted to `CORS_ORIGINS`.
- Rate limiting on upload and read.
- Secrets only in server env; never in frontend.

## Docker

```bash
docker compose up -d --build
```

The host directory `/opt/gokez-mart` is mounted into the container at the same path. Files persist across restarts.

## Public access

Nginx serves `/opt/gokez-mart` directly at `https://images.gokez.com/`. Example: `https://images.gokez.com/catalog/<file>.webp`.

## Environment variables

See `.env.example`.
