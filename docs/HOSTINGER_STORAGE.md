# Hostinger VPS Image Storage Integration

## Overview

The `hostinger` storage driver is the only supported driver (`IMAGE_STORAGE_DRIVER` defaults to `hostinger` in `mart-backend/src/config/index.ts`). On the Hostinger VPS, `HOSTINGER_STORAGE_URL` must be the container-to-container address `http://gokez-storage:8080`, not the public `https://images.gokez.com` URL.

The Image Manager lists files indexed by the storage service only. Legacy image URLs still stored in the database are not listed; re-upload those images through the Hub to make them appear.

## Components

- `storage-service/` — standalone Express API + Docker image.
- `mart-backend/src/services/hostingerStorage.service.ts` — client used by controllers.
- `mart-backend/src/config/index.ts` — `imageStorage.driver`, `hostinger.*`.
- Controllers: `customerUploadPhoto`, `adminUploadPhoto`, `adminCreateCatalogProduct` branch on driver.
- DB migration `135_hostinger_storage.sql` — adds `storage_id` column and `hostinger` to `storage_driver` check.

## Deployment (VPS)

1. Verify `/opt/gokez-mart/` exists with folders `category`, `catalog`, `profile`, `banner`, `other`.
2. Copy `storage-service/` to VPS, create `.env` from `.env.example`.
3. `docker compose up -d --build`.
4. Configure nginx using `storage-service/nginx/images.conf`; obtain TLS cert for `images.gokez.com`.
5. Verify `curl https://images.gokez.com/api/v1/health`.

## Backend configuration

Set in mart-backend env:
```
IMAGE_STORAGE_DRIVER=hostinger
HOSTINGER_STORAGE_URL=http://gokez-storage:8080
HOSTINGER_STORAGE_API_KEY=<key>
HOSTINGER_STORAGE_PROJECT_ID=gokez-mart
```
Use the public `https://images.gokez.com` URL only when calling from outside the VPS (for example from Render). Restart backend. New uploads go to Hostinger.

## Mart-hub folder mapping

- Product/combo images → `catalog`
- Category icons → `category`
- Store logos → `profile`
- Carousel/campaign/promotion images → `banner`
- Others → `other`

## Security

- API key only in backend env (never Vite/frontend).
- Public reads via nginx; writes require API key + project id.
- CORS restricted to approved origins.

## Test report (to be executed on VPS)

- [ ] `/opt/gokez-mart` exists and writable by container.
- [ ] Files persist after `docker compose restart`.
- [ ] Upload to each of 5 folders returns 201 and public URL 200.
- [ ] Replace and delete work.
- [ ] Path traversal / invalid folder rejected (400).
- [ ] Oversized file rejected (400).
- [ ] Non-image file rejected (400).
- [ ] Admin auth on mart-backend still required for uploads.
- [ ] Image Manager lists uploaded files and thumbnails render from `https://images.gokez.com`.
