# Hostinger Image Migration Procedure (Pre-Production)

## Exact files changed
Backend:
- mart-backend/src/config/index.ts (imageStorage.driver default hostinger; hostinger.url/apiKey/projectId)
- mart-backend/src/controllers/index.ts (hostinger branches in customerUploadPhoto, adminUploadPhoto, adminCreateCatalogProduct)
- mart-backend/src/services/hostingerStorage.service.ts (new)
- mart-backend/src/services/productImageAsset.service.ts (hostinger driver + storage_id)
- mart-backend/src/database/migrations/135_hostinger_storage.sql (new)
- mart-backend/.env.example
Hub:
- mart-hub/src/services/api.ts (folder param)
- mart-hub/src/pages/CatalogPage.tsx, ProductsPage.tsx, CategoriesPage.tsx, StoresPage.tsx, CampaignsPage.tsx, PromotionsPage.tsx, CarouselPage.tsx (folder mapping)
Docs:
- docs/HOSTINGER_STORAGE.md, docs/IMAGE_STORAGE_AUDIT.md, docs/SUPABASE_STORAGE_MIGRATION_MAP.md, docs/HOSTINGER_MIGRATION_PROCEDURE.md
Storage service (new):
- storage-service/* (Express API, Docker, nginx, README)

## Hostinger deployment commands
```
# On VPS
mkdir -p /opt/gokez-mart/{banner,catalog,category,other,profile}
# copy storage-service to /opt/gokez-storage (or any path)
cd /opt/gokez-storage
cp .env.example .env && edit .env
docker compose up -d --build
# nginx: install storage-service/nginx/images.conf, enable site, reload nginx
```

## Required environment variables
Storage service (.env):
NODE_ENV=production, PORT=8080, STORAGE_ROOT=/opt/gokez-mart, PUBLIC_BASE_URL=https://images.gokez.com, STORAGE_PROJECT_ID=gokez-mart, STORAGE_API_KEY=<long random>, MAX_UPLOAD_BYTES=5242880, CORS_ORIGINS=https://mart.gokez.com,https://hub.gokez.com,https://admin.mart.gokez.com, THUMBNAIL_WIDTH=240, WEBP_QUALITY=82
Backend (Render, staging first):
IMAGE_STORAGE_DRIVER=hostinger, HOSTINGER_STORAGE_URL=https://images.gokez.com, HOSTINGER_STORAGE_API_KEY=<same key>, HOSTINGER_STORAGE_PROJECT_ID=gokez-mart

## Health-check result (local test)
GET /api/v1/health -> {"success":true,"status":"ok","storageRoot":"...","env":"development"} (HTTP 200)

## Upload and retrieval test results (local)
- POST /api/v1/files/upload folder=catalog -> 201, returns id/url/thumbnailUrl, mimeType image/webp
- GET /api/v1/files/:id -> 200 metadata with folder/url
- Public GET url -> HTTP 200
- Invalid folder -> 400 "Invalid or missing folder"
- DELETE -> 200

## Migrating existing local Supabase images
1. Keep Supabase files untouched; use downloaded local copies.
2. Open the relevant Hub page (Catalog, Categories, Stores, Carousel, Campaigns, Promotions, Products).
3. Upload each local image via the existing file picker; the page's upload call sets the correct folder automatically.
4. Save the record so the new Hostinger URL is stored; old Supabase URL is replaced in DB only for that record (manual, per record).
5. Verify the image renders from https://images.gokez.com/... before deleting any local/Supabase copy.
6. For bulk, repeat per folder; do not auto-migrate all records.

## Rollback
Set IMAGE_STORAGE_DRIVER=supabase in backend env and restart. New uploads revert to Supabase; existing Hostinger URLs already stored remain valid and readable.
