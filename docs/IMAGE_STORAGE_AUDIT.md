# Gokez Mart Image Storage Audit (Hostinger Migration)

Audit only. No production code, DB, Render config, or Supabase files were modified.

## 1. Supabase Storage usage locations

- Backend config: `mart-backend/src/config/index.ts` (`config.supabase.url`, `serviceRoleKey`, `bucket`; `config.storage.publicBaseUrl`).
- Controllers: `mart-backend/src/controllers/index.ts`
  - `customerUploadPhoto` (~3000): POST avatar to `/storage/v1/object/{bucket}/customers/...`
  - `adminUploadPhoto` (~3234): POST product variants / single image to `/storage/v1/object/{bucket}/...`
  - `adminCreateCatalogProduct` (~928, `photoLocalPath`): POST 3 product variants
  - `adminCleanStorage` (~3798): LIST + DELETE orphaned objects
- Service: `mart-backend/src/services/productImageAsset.service.ts` (`deleteStoragePair` DELETE; `cleanupDue` scheduled)
- Render: `render.yaml` declares `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`
- Docs: `README.md`, `docs/DEPLOY_RENDER.md`, `docs/BACKEND_COST_AUDIT.md`

No `@supabase/supabase-js` dependency. Storage is used only via REST + `pg` for DB.

## 2. Upload / retrieval / replacement / deletion functions

| Function | File | Purpose |
| --- | --- | --- |
| `customerUploadPhoto` | controllers/index.ts | Customer avatar upload (x-upsert true) |
| `adminUploadPhoto` | controllers/index.ts | Admin single + product-variant upload |
| `adminCreateCatalogProduct` (photoLocalPath branch) | controllers/index.ts | Local file → 3 variants upload |
| `adminCleanStorage` | controllers/index.ts | Dry-run / delete orphaned storage objects |
| `ProductImageAssetService.createPending/syncProductAssets/queueProductAssets/cleanupDue/deleteStoragePair` | productImageAsset.service.ts | Product image lifecycle + storage deletion |
| `prepareImage` / `prepareProductImages` / `prepareAvatarImage` | controllers/index.ts | sharp validation, resize, WebP, EXIF strip |

## 3. Image URL fields and tables

| Table | Columns |
| --- | --- |
| mart_products | photo_url, photos (jsonb), photo_variants (jsonb) |
| mart_categories | icon |
| mart_stores | logo_url |
| mart_customers | photo_url |
| mart_carousel_slides | image_url |
| mart_campaigns | carousel_image_url |
| mart_promotions | image_url |
| mart_home_sections | config (jsonb) |
| mart_settings | value (may embed) |
| mart_product_image_assets | small_url, thumbnail_url, large_url, small_key, thumbnail_key, large_key, storage_driver, storage_id |

## 4. Admin Panel upload workflows

- mart-hub (admin): CatalogPage, ProductsPage (combo), CategoriesPage, StoresPage, CarouselPage, CampaignsPage, PromotionsPage via `productsApi.uploadPhoto` / `carouselApi.uploadImage` → `POST /api/v1/admin/upload/photo`.
- mart-user (customer): AccountGreeting → `POST /api/v1/auth/upload/photo`.
- mart-mobile: profile.tsx → same customer endpoint.
- All multipart `photo` field; optional `maxDimension`, `profile`, `folder`.

## 5. Auth / authorization

- Custom JWT (`jsonwebtoken`) + `bcryptjs`; `mart_admins`, `mart_admin_sessions`, `mart_admin_store_assignments`.
- Middleware `authenticate` / `requireRole` / `requireStoreAccess` in `mart-backend/src/middleware/index.ts`.
- Customer auth separate (`authenticateCustomer`, `mart_customers`, `mart_otps`).
- Uploads are backend-authenticated; browser never holds Supabase keys.

## 6. Existing Supabase image URLs to migrate (counts)

- products.photo_url: 108
- products.photos (supabase URLs): 108
- customers.photo_url: 2
- categories.icon: 4
- stores.logo_url: 0
- carousel.image_url: 7
- campaigns.carousel_image_url: 1
- promotions.image_url: 0
- product_image_assets (supabase driver): 17

## 7. Preserving filenames and folder paths

- Supabase keys: `products/<uuid>-...-{small,thumbnail,large}.webp`, `customers/<id>-<ts>.webp`, root-level `${Date.now()}-${name}.webp`.
- Hostinger target folders: category, catalog, profile, banner, other. Map product→catalog, category→category, avatar/store→profile, carousel/campaign/promotion→banner, else→other.
- Public URL shape: `https://images.gokez.com/<folder>/<filename>.webp`. Preserve original base names where possible; uniqueness via uuid prefix already in filename.

## 8. Hardcoded image URLs

- No Supabase storage URLs are hardcoded in frontend or backend source. URLs are constructed at runtime from `SUPABASE_URL` / `MART_STORAGE_PUBLIC_BASE_URL` / response `url`.
- Storage-service public base is configurable via `PUBLIC_BASE_URL`.

## Recommended smallest safe plan

1. Deploy storage-service on VPS (already built) with `/opt/gokez-mart` mounted; verify health + 5 folders + persistence.
2. Keep `IMAGE_STORAGE_DRIVER=supabase` in production (no behavior change).
3. Test in staging with `IMAGE_STORAGE_DRIVER=hostinger` and Hostinger env vars; new uploads go to Hostinger, old Supabase URLs still render.
4. Admin Panel already uploads via backend; add preview from returned `url` (optional UX). No new image management system.
5. Do not migrate/delete Supabase files automatically; migrate manually only after verification.
6. Rollback: set driver back to `supabase`.

## Risks

- If Hostinger env vars missing while driver=hostinger, uploads return 503.
- Old Supabase images remain referenced; do not delete until all replaced.
- Hostinger cleanup of variants: multiple variant files uploaded separately; tracked via storage_id JSON.
- Nginx must serve files with correct MIME and cache headers.
