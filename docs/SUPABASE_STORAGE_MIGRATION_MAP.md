# Supabase Storage → Hostinger Storage: Migration Map (Audit Only)

Audit only. No code, database, Render, or Supabase files were modified.

## A. Upload path (browser → backend → storage)

All image uploads go through the mart-backend API. The browser never talks to Supabase Storage directly. mart-backend then calls Supabase Storage REST with the service-role key.

## B. Frontend upload components

| Component | File | API call | Module/folder |
| --- | --- | --- | --- |
| Catalog product photos | `mart-hub/src/pages/CatalogPage.tsx` (lines ~202, 262) | `productsApi.uploadPhoto(file, undefined, 'product')` | catalog (product) |
| Combo photo | `mart-hub/src/pages/ProductsPage.tsx` (~423) | `productsApi.uploadPhoto(comboPhotoFile, undefined, 'product')` | catalog (product) |
| Category icon | `mart-hub/src/pages/CategoriesPage.tsx` (~59) | `productsApi.uploadPhoto(file, 160)` | category |
| Store logo | `mart-hub/src/pages/StoresPage.tsx` (~226) | `productsApi.uploadPhoto(file)` | profile/other |
| Carousel slide | `mart-hub/src/pages/CarouselPage.tsx` (~80) | `carouselApi.uploadImage(imageFile)` | banner |
| Campaign carousel image | `mart-hub/src/pages/CampaignsPage.tsx` (~154) | `productsApi.uploadPhoto(carouselImageFile)` | banner |
| Promotion image | `mart-hub/src/pages/PromotionsPage.tsx` (~63) | `productsApi.uploadPhoto(file)` | banner |
| Customer avatar (web) | `mart-user/src/components/AccountGreeting.tsx` (~117) | `authApi.uploadPhoto(file)` | profile |
| Customer avatar (mobile) | `mart-mobile/app/(tabs)/profile.tsx` (~55) | `authApi.uploadPhoto(uri)` | profile |

API helpers: `mart-hub/src/services/api.ts` (`productsApi.uploadPhoto`, `carouselApi.uploadImage`); `mart-user/src/services/api.ts` (`authApi.uploadPhoto`); `mart-mobile/services/api.ts` (`authApi.uploadPhoto`).

## C. Backend APIs and services talking to Supabase Storage

| Endpoint / function | File | Supabase usage |
| --- | --- | --- |
| `POST /api/v1/auth/upload/photo` → `customerUploadPhoto` | `mart-backend/src/controllers/index.ts` (~3000) | POST `/storage/v1/object/{bucket}/customers/...` (x-upsert true) |
| `POST /api/v1/admin/upload/photo` → `adminUploadPhoto` | `mart-backend/src/controllers/index.ts` (~3234) | POST variants/single to `/storage/v1/object/{bucket}/...` |
| `adminCreateCatalogProduct` (photoLocalPath) | `mart-backend/src/controllers/index.ts` (~928) | POST 3 variants to Supabase |
| `adminCleanStorage` | `mart-backend/src/controllers/index.ts` (~3798) | LIST + DELETE `/storage/v1/object/...` |
| `ProductImageAssetService.deleteStoragePair` | `mart-backend/src/services/productImageAsset.service.ts` | DELETE `/storage/v1/object/{bucket}` |
| `ProductImageAssetService.cleanupDue` | same | scheduled cleanup of pending/orphaned assets |

Config: `mart-backend/src/config/index.ts` (`config.supabase.url/serviceRoleKey/bucket`, `config.storage.publicBaseUrl`).

## D. Supabase bucket and folder structure

- Bucket: `mart-products` (default; env `SUPABASE_BUCKET`).
- Keys used:
  - `products/<uuid>-<name>-{small|thumbnail|large}.webp` (product image variants)
  - `customers/<customerId>-<timestamp>.webp` (avatars)
  - Root-level `${Date.now()}-${baseName}.webp` (category icons, store logos, carousel/campaign/promotion images)
- Local dev fallback: `mart-backend/uploads/` (`products/`, `originals/`, root) served via `/uploads`.

## E. Database tables and columns storing image URLs/paths

| Table | Column(s) |
| --- | --- |
| `mart_products` | `photo_url` (text), `photos` (jsonb), `photo_variants` (jsonb) |
| `mart_categories` | `icon` (text) |
| `mart_stores` | `logo_url` (text) |
| `mart_customers` | `photo_url` (text) |
| `mart_carousel_slides` | `image_url` (text) |
| `mart_campaigns` | `carousel_image_url` (text) |
| `mart_promotions` | `image_url` (text) |
| `mart_home_sections` | `config` (jsonb, may embed image URLs) |
| `mart_settings` | `value` (may embed image URLs) |
| `mart_product_image_assets` | `small_url`, `thumbnail_url`, `large_url`, `small_key`, `thumbnail_key`, `large_key`, `storage_driver`, `storage_id` (new) |

## F. URL generation, replacement, deletion logic

- Generation: Supabase public URL `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${key}` or `MART_STORAGE_PUBLIC_BASE_URL`; local dev `${protocol}://${host}/uploads/${key}`.
- Replacement: product images use `ProductImageAssetService.syncProductAssets` (active/cleanup_queued state, 15-min grace) and `queueProductAssets`; customer avatar uses x-upsert overwrite on a new timestamped key (old file orphaned); category/store/carousel/campaign/promotion simply overwrite the column (old file orphaned).
- Deletion: `cleanupDue` (every 60s) deletes pending (>1h) and cleanup_queued (due) assets from storage + DB; `adminCleanStorage` lists and deletes orphaned Supabase objects by prefix (dry-run supported).

## G. Display locations (frontend)

- `mart-hub`: CatalogPage, ProductsPage, CategoriesPage, StoresPage, CarouselPage, CampaignsPage, PromotionsPage, HomeSections, Dashboard.
- `mart-user`: product cards/details, category icons, store logos, carousel, campaigns, promotions, profile avatar.
- `mart-mobile`: product images, category icons, profile avatar.

## H. Direct vs backend

All uploads are backend-mediated. No Supabase client SDK is used anywhere (`@supabase/supabase-js` not in dependencies).

## I. Smallest safe implementation plan (Hostinger)

1. Deploy `storage-service/` on VPS with `/opt/gokez-mart` mounted; nginx serves `https://images.gokez.com/`.
2. Verify health + upload to all 5 folders + persistence across restart.
3. Keep `IMAGE_STORAGE_DRIVER=supabase` in production (no change).
4. In a staging/test environment set `IMAGE_STORAGE_DRIVER=hostinger` and `HOSTINGER_STORAGE_*`; new uploads route to Hostinger while existing Supabase URLs remain readable.
5. Admin Panel already uploads via mart-backend; no frontend changes needed beyond optional preview UX. Upload response already returns `url`; show preview from that URL.
6. Gradually enable for production after testing; never delete/migrate Supabase files automatically.
