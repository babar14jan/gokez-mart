# Hostinger VPS Image Storage Integration

## Overview

New storage driver `hostinger` added behind feature flag `IMAGE_STORAGE_DRIVER`. Default remains `supabase` (no production change). Set `IMAGE_STORAGE_DRIVER=hostinger` in mart-backend env to route new uploads to the Hostinger storage service.

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

## Switching drivers (testing)

Set in mart-backend env:
```
IMAGE_STORAGE_DRIVER=hostinger
HOSTINGER_STORAGE_URL=https://images.gokez.com
HOSTINGER_STORAGE_API_KEY=<key>
HOSTINGER_STORAGE_PROJECT_ID=gokez-mart
```
Restart backend. New uploads go to Hostinger; existing Supabase URLs remain untouched.

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
- [ ] Existing Supabase image URLs still render.
- [ ] Feature flag rollback: set `IMAGE_STORAGE_DRIVER=supabase`, restart, uploads resume to Supabase.
