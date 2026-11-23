# Gokez Mart

Gokez Mart is a hyperlocal grocery marketplace for Kolkata. Local stores sell
through the customer storefront, run day-to-day operations from Gokez Hub, and
fulfil orders with their own staff and delivery handlers. Gokez provides the
software, storefront, operations tooling and platform administration; customer
payments go directly to the merchant.

## Release highlights (October–November 2026)

- **Zone-first multi-store marketplace.** Zones now group stores, own opening
  hours/closure and the delivery promise, and have a primary “head” store.
  Customers browse one combined catalogue; each order line records the store
  that fulfils it.
- **Per-store fulfilment.** A single customer order can be prepared and picked
  up store by store, including member-store pickup tracking, without changing
  the customer-facing master status.
- **Scheduled delivery overhaul.** Scheduling is next-day only with 60-minute
  windows, campaign-aware rules, stored customer-facing labels, and
  owner/super-admin rescheduling.
- **Daily Sales ledger.** Online order figures are merged with itemised offline
  cash/UPI counter sales; access is limited to super admins and head-store
  owners/managers.
- **Order restore.** Super admins can recover accidentally deleted orders from
  surviving cart, coupon, funnel, inventory and attribution records, choosing
  status and payment method from the UI.
- **Top selling products.** Zone head stores and super admins can view all
  products ranked by delivered orders, with units sold and custom date ranges.
- **Promotional Web Push.** Audience cohorts, zone targeting, quiet hours,
  preview/test/send, per-delivery audit and click analytics.
- **Recommendations and search.** Cart-aware recommendations bridge the
  free-delivery gap or fall back to personalised discovery; catalogue search
  ranks exact names ahead of local names and aliases.
- **Product operations.** Excel/CSV catalogue import, category-scoped product
  codes, generated image variants, bulk image upload and storage cleanup.
- **Hub operations.** Browse-date dashboard/analytics, in-progress KPI, live
  order alarm with custom ringtone, PWA session refresh and a Hub update policy.
- **Customer UX.** OTP auto-fill, configurable Fresh page, cancellation
  requests, partial-delivery adjustments, notification prompts, refreshed
  splash/navigation and address controls.
- **Backend hardening.** Automatic order-transition recovery, no-store API
  responses, database-backed session roles, stricter phone validation and the
  2Factor `Login_OTP` SMS flow.

### 2026-11-20 (current `main`)

- **Referral and Earn.** Customers get a personal code/link, a homepage referral
  banner, checkout credit with first-order minimum/discount handling, staged
  rewards and credit reservation/release. Hub adds overview, campaigns, records,
  customer rewards, reward ledger, fraud review, reports and CSV export.
- **Native customer Android app.** `mart-user/android` wraps the production web
  app with Capacitor 7, branded splash/icons, allowed in-app routes and a
  build-time `VITE_API_URL`; GitHub Actions builds a debug APK on `mart-user`
  changes. FCM deep links are wired in the app, but backend FCM token routes are
  still pending.
- **Catalog pricing and options.** Products support selectable weight/quantity
  options with per-option price, discount and default choice; cards show option
  counts and struck-through original prices. Combo products can be removed from
  a store and the master catalog, and inventory is managed per component.
- **Fresh and customer UX.** Fresh is a normal in-flow page with scoped search,
  suggestions, recent searches, an empty-search state and active nav highlight.
  Header/chrome collapse and dark-mode styling were polished, product sheets
  close reliably on pull-down, notification opt-in has a cooldown and login can
  auto-request permission, and standalone iOS installs are tracked.
- **Inventory.** Hub stock editing moved to inline rows with a floating save bar
  and reviewable drafts; cards show only the user's latest add/remove/set
  actions while the full log stays in Stock History/Ledger. Movements have
  Today/Yesterday/All filtering, reduction reasons, costed stock lines, daily
  valuation snapshots, KPI cards and profitability views.
- **Analytics and Hub operations.** Store-scoped analytics helpers, custom date
  validation, order insights, authenticated product leaders, top-15 product
  ordering, zone-scoped settings, an image manager and retry/Done bulk upload
  handling were added; sidebar, login, splash and icons were rebranded.
- **Promotions.** Audience/cohort fixes, WhatsApp deep links, test recipients,
  promotion open tracking and click fallback, emoji picker, and automatic
  marketing consent on signup/first notification grant.
- **Reliability and deployment.** Cart conflicts are replaced instead of
  rejected; catalog SSE is stamp-gated and scope-capped; OOS cart lines are
  excluded from totals; after-hours orders auto-confirm without auto-preparing,
  and preparing requires confirmation with delivery-time recalculation. Images
  now use the Hostinger storage service; Hostinger VPS deployment docs and
  Docker networking fixes are in place, Supabase storage references removed,
  both PWA update policies set to `silent`, and apps bumped to v0.1.7.

## What is in this repository

| Part | Purpose | Package |
| --- | --- | --- |
| `mart-backend` | Express + TypeScript API, PostgreSQL, migrations, Web Push, image uploads, SSE | `mart-backend` |
| `mart-user` | Current production customer storefront and installed PWA; source of truth for customer web behaviour, with a Capacitor native Android project under `mart-user/android` | `mart-user` |
| `mart-hub` | Store owner, staff, delivery and super-admin operations app | `mart-hub` |
| `mart-mobile` | Native Expo customer app under active development; currently behind `mart-user` and not in root workspaces | `mart-mobile` |
| `docs` | Deployment, cost and homepage UX audit notes | — |

```text
gokez-mart/
├── mart-backend/          # API, migrations, backend tests
├── mart-user/             # customer React app + PWA + Android wrapper
│   └── android/           # Capacitor 7 native customer app
├── mart-hub/              # operations React app + PWA
├── mart-mobile/           # Expo / React Native app
├── docs/
│   ├── BACKEND_COST_AUDIT.md
│   ├── DEPLOY_HOSTINGER.md
│   ├── DEPLOY_RENDER.md
│   ├── HOSTINGER_STORAGE.md
│   ├── HOMEPAGE_UX_AUDIT.md
│   └── marketing/
├── storage-service/       # Hostinger image storage API
├── .github/workflows/     # Android APK and deployment workflows
├── docker-compose.local.yml
├── render.yaml            # primary API deployment
├── railway.json           # fallback API deployment
└── package.json           # workspaces: backend, user, hub
```

The root npm workspaces are **only** `mart-backend`, `mart-user` and `mart-hub`.
`mart-mobile` has its own lockfile and must be installed separately. The
production customer experience lives in `mart-user`; the backend and
`mart-user` are authoritative whenever they differ from the mobile app.

## Production services

| Service | URL |
| --- | --- |
| API | `https://api.mart.gokez.com` |
| Customer storefront | `https://mart.gokez.com` |
| Gokez Hub | `https://hub.gokez.com` |
| Store application | `https://hub.gokez.com/apply` |
| Merchant terms | `https://hub.gokez.com/merchant-terms` |
| Hub landing page | `https://hub.gokez.com/hub` |

The API prefix is `/api/v1`. The unauthenticated health endpoint is
`/api/v1/health` and does not read the database.

## Technology

| Area | Stack |
| --- | --- |
| Backend | Node.js 20+, Express 4, TypeScript 5, PostgreSQL, `pg`, JWT, `bcryptjs`, Multer, Sharp, Web Push, Sentry |
| Customer web | React 18, TypeScript 5, Vite 5, Tailwind 3, Zustand, Axios |
| Hub | React 18, React Router 6, TypeScript 5, Vite 5, Tailwind 3, Zustand, Axios, React Hook Form, `xlsx` |
| Mobile | Expo SDK 54, React Native 0.81, React 19, Expo Router 6, NativeWind 4, Zustand, Expo SecureStore |
| Customer Android | Capacitor 7 wrapping `mart-user`, Java 21+, Android SDK 35, FCM push plumbing |
| Database | PostgreSQL 16 locally; Supabase-compatible PostgreSQL in production |
| Storage | Hostinger storage service; WebP variants and public reads through `images.gokez.com` |
| Deployments | Render (API blueprint), Hostinger VPS (API/VPS path), Cloudflare Pages (web), GitHub Actions (customer debug APK), EAS (Expo mobile, not yet configured) |

Node `20.15.0` is pinned in `.nvmrc`; both root and backend require Node
`>=20.9.0`.

## Quick start

### Prerequisites

- Node.js 20.15 or newer
- npm
- Docker only if you want the bundled local PostgreSQL
- Java 21+ and Android Studio with SDK platform 35/build tools 35+ for native
  Android builds
- Expo Go / Xcode / Android tooling only if working on `mart-mobile`

### Install and run the three main apps

```bash
# From the repository root
npm ci

# Terminal 1 — local PostgreSQL
docker compose -f docker-compose.local.yml up -d

# Create the backend development environment
cp mart-backend/.env.example mart-backend/.env.local

# Apply migrations
npm run db:migrate --workspace=mart-backend

# Terminal 2 — API on http://localhost:3004
npm run dev:api

# Terminal 3 — customer app on http://localhost:5177
npm run dev:web

# Terminal 4 — Gokez Hub on http://localhost:5178
npm run dev:admin
```

The Docker database is `gokez_mart_dev` on port `5433` with user/password
`postgres`/`postgres`. If you use an existing local PostgreSQL instead, change
`DATABASE_URL` in `mart-backend/.env.local`.

Local development loads **`mart-backend/.env.local`**, not
`mart-backend/.env`. Deployed environments use only variables set by the
platform. The committed sample is deliberately minimal; add the optional
2Factor, VAPID, Sentry and Nominatim values from the table below when needed.

### Local customer OTP

In non-production, `123456` is accepted as a customer OTP; the production SMS
provider is not called. Production uses 2Factor with the `AUTOGEN` /
`Login_OTP` template and requires `TWO_FACTOR_API_KEY`; verification uses the
code echoed back at send time or falls back to the 2Factor session-verify
endpoint. OTPs expire after 10 minutes and allow five verification attempts; the
database also refuses more than three non-expired OTP rows for the same phone.

### Mobile app

```bash
cd mart-mobile
npm ci
cp .env.example .env
npx expo start
```

For a physical device on the same network, set `EXPO_PUBLIC_API_URL` to the
machine's LAN address, for example `http://192.168.1.20:3004/api/v1`, and make
sure the backend is listening on that interface. The `start:local` script passes
the macOS `en0` IP to `app.config.js` as `DEV_IP`, but the API client reads only
`EXPO_PUBLIC_API_URL`, so set that value explicitly in `.env` for a device.

### Customer Android app

`mart-user/android` is a Capacitor 7 wrapper around the production customer web
app, not the Expo app in `mart-mobile`. `VITE_API_URL` is baked into the JS at
build time and is required; without it the app calls the frontend origin.

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
VITE_API_URL="https://api.mart.gokez.com/api/v1" npm run apk:debug --workspace=mart-user
```

The debug APK is written to
`mart-user/android/app/build/outputs/apk/debug/app-debug.apk`. The application
id is `com.gokez.mart.customer` and the WebView origin is
`https://mart.gokez.com`. See `mart-user/docs/android-capacitor.md` for Android
Studio, Firebase `google-services.json`, allowed deep links and notification
payload details. Native push is not operational until backend FCM token
registration/unregistration routes are added.

### Ports and proxies

| Process | Port |
| --- | --- |
| API | `3004` |
| Customer web | `5177` |
| Hub | `5178` |
| Local PostgreSQL (Docker) | `5433` |

Both Vite apps proxy `/api` to `http://localhost:3004`. A production web build
must set `VITE_API_URL` to the public API URL including `/api/v1`; Vite bakes
this value in at build time.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev:api` | Start the API with `tsx watch` |
| `npm run dev:web` | Start the customer app |
| `npm run dev:admin` | Start Gokez Hub |
| `npm run db:migrate --workspace=mart-backend` | Apply pending migrations |
| `npm run build --workspace=mart-backend` | Compile TypeScript and copy SQL migrations into `dist` |
| `npm run images:export-local --workspace=mart-backend` | Export locally stored product images for migration to object storage |
| `npm run start --workspace=mart-backend` | Self-healing production start script |
| `npm test --workspace=mart-backend` | Backend Node test suite |
| `npm run build --workspace=mart-user` | Type-check, Vite build, stamp versions, prerender public pages, run SEO checks |
| `npm run cap:build --workspace=mart-user` | Build the customer web app, then `cap sync android` |
| `npm run cap:open --workspace=mart-user` | Open the Capacitor Android project in Android Studio |
| `npm run cap:run --workspace=mart-user` | Run the customer Android app on a connected device/emulator |
| `npm run apk:debug --workspace=mart-user` | Build the customer web app, sync Capacitor and assemble a debug APK |
| `npm run seo:check --workspace=mart-user` | Verify SEO source/build contract without a full build |
| `npm test --workspace=mart-user` | Customer app test suite |
| `npm run build --workspace=mart-hub` | Type-check, Vite build and stamp versions |
| `npm run preview --workspace=mart-user` | Preview the customer build on port `5177` |
| `npm run preview --workspace=mart-hub` | Preview the Hub build on port `5178` |

Expo mobile commands live in `mart-mobile/package.json`: `start`, `android`,
`ios`, `start:local`, `build:preview` and `build:prod` (EAS). Customer Android
branding helpers in `mart-user/package.json` include `gen:ios-splash`,
`gen:native-splash`, `gen:app-icons` and `gen:brand-assets`.

## Environment variables

### Backend

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Production | `production` enables production guards and disables local OTP/storage shortcuts |
| `PORT` | No | Defaults to `3004`; do not set on Render; Hostinger sets `3000` explicitly |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ALLOW_REMOTE_DATABASE` | Local only | Set to `true` only to deliberately allow a non-local database in development |
| `MART_JWT_SECRET` | Yes in production | Unique secret, at least 32 characters |
| `MART_JWT_EXPIRES_IN` | No | Admin session lifetime, default `90d` |
| `MART_CORS_ORIGIN` | Yes in production | Comma-separated HTTPS page origins, for example `https://mart.gokez.com,https://hub.gokez.com` |
| `MART_PUBLIC_API_URL` | Production promotions | Public API base including `/api/v1`; used to build promotion click-tracking URLs |
| `MART_CUSTOMER_APP_URL` | Optional | Customer storefront origin used to resolve promotion destinations; defaults to the first CORS origin |
| `IMAGE_STORAGE_DRIVER` | Production uploads | `hostinger`; the only supported driver |
| `HOSTINGER_STORAGE_URL` | Production uploads | `http://gokez-storage:8080` inside the VPS Docker network; `http://localhost:8080` locally |
| `HOSTINGER_STORAGE_API_KEY` | Production uploads | Shared key with the storage service |
| `HOSTINGER_STORAGE_PROJECT_ID` | No | Defaults to `gokez-mart` |
| `MART_BACKGROUND_JOBS_ENABLED` | No | Defaults to `true`; set `false` on an overlapping API instance to avoid duplicate jobs |
| `TWO_FACTOR_API_KEY` | Production | Sends customer OTPs; without it customer sign-in fails |
| `VAPID_PUBLIC_KEY` | Optional | Web Push public key |
| `VAPID_PRIVATE_KEY` | Optional | Web Push private key |
| `VAPID_SUBJECT` | Optional | Defaults to `mailto:support@gokez.com` |
| `SENTRY_DSN` | Optional | Enables Sentry only in production |
| `NOMINATIM_BASE_URL` | Optional | Reverse geocoding provider |
| `NOMINATIM_USER_AGENT` | Optional | Required by public Nominatim etiquette |

Public image reads are served by `storage-service` at
`https://images.gokez.com`; the old `MART_STORAGE_PUBLIC_BASE_URL` override and
Supabase storage variables have been removed from code and env examples.

Production refuses to boot when `MART_JWT_SECRET` is missing, is a known
placeholder, is shorter than 32 characters, or when `MART_CORS_ORIGIN` is empty
or contains a non-HTTPS origin.

Development refuses to connect to a non-local database host unless
`ALLOW_REMOTE_DATABASE=true`. This is deliberate protection against running a
local code path against production data.

`MART_ADMIN_USERNAME` and `MART_ADMIN_PASSWORD` still appear in the sample env
file but are not read by the backend. Admin accounts are managed through the
database and Gokez Hub.

### Customer web

`VITE_API_URL` is required for production, must include `/api/v1`, and is baked
into the bundle at build time. In Vite development the app falls back to
`http://localhost:3004/api/v1`.

### Hub

`VITE_API_URL` is required for production and is baked in at build time. The
Hub's source fallback is `http://localhost:3004/api/v1`, which is suitable only
for local development.

### Mobile

`EXPO_PUBLIC_API_URL` controls the client API base URL and defaults to
`https://api.mart.gokez.com/api/v1`. `APP_ENV=production` enables production
Expo config; `DEV_IP` is used by the local start script.

## Backend architecture

The API entry point is `mart-backend/src/index.ts`. It runs migrations before
listening, then starts the Express app in `mart-backend/src/app.ts`.

### Request pipeline

- Helmet security headers and a restrictive content security policy
- Explicit CORS allowlist
- JSON and URL-encoded bodies limited to 100 KB
- MongoDB-style key sanitisation and HTTP parameter-pollution protection
- General and endpoint-specific rate limits
- Compression and request logging that deliberately omits query strings and IP
  addresses
- API responses are sent with `Cache-Control: no-store` and ETags are disabled so
  catalog, order and admin data are never served stale by a browser or proxy
- Global 404 and error handlers; internal 5xx messages are not exposed

### Authentication and authorisation

- Admin and customer tokens use the same JWT secret but different signed
  `type` claims. A customer token cannot be used as an admin token and a token
  without the correct type is rejected.
- Admin sessions have a `mart_admin_sessions` row with a `jti`; logout revokes
  the session and the middleware checks the row on every request.
- Every authenticated request reloads the admin’s role, primary store and active
  state from the database; a deleted/deactivated user or invalid role is
  rejected even if the JWT is still valid.
- Non-`super_admin` users need an active store subscription to sign in and to
  use authenticated endpoints.
- Store-scoped routes use `requireStoreAccess`, which checks both the admin's
  primary store and active rows in `mart_admin_store_assignments`.
- Unknown or missing roles fail closed; there is no default elevation.

### Orders, realtime and notifications

- Order placement runs in a transaction and supports idempotency keys.
- Pending orders auto-confirm after 2 seconds, including after-hours orders.
  Auto-preparing was removed: staff must confirm preparation, which recalculates
  the promised delivery time. Auto-confirm is recoverable after a restart.
  Scheduled orders still auto-confirm, but remain `confirmed` until staff start
  preparing them for the delivery window.
- The Hub receives live order events over Server-Sent Events at
  `GET /api/v1/admin/events`.
- Web Push subscriptions are stored for customers, guests and admins. Guests
  are addressed by the order tracking token. Promotional pushes support
  cohorts, zone targeting, quiet hours, preview/test sends and click tracking.
- Inventory is deducted when an order becomes `delivered`, but only when the
  store has inventory tracking enabled; bundle lines consume stock from their
  components.
- Campaign redemptions are reversed when an order becomes `cancelled`,
  `failed_delivery` or `terminated`.
- Guests can use first-order/all campaigns, but inactive-customer and
  targeted-customer offers require a signed-in customer.
- Multi-store orders record a per-store fulfilment row. Store staff can mark
  their own portion prepared, delivered or picked up; the master order status
  remains the customer-facing source of truth.
- Customers can request cancellation from `pending`/`confirmed`; scheduled
  orders have a 30-minute cutoff before the promised slot. Staff can approve or
  reject the request with a reason.
- Store owners/managers can add/remove items, change quantities or record
  payment adjustments; only owners and super admins can reschedule. The order
  keeps an adjustment audit trail.
- An order that is placed while the store is closed can be confirmed for the
  next opening. Scheduled delivery is a preference, not a guaranteed
  appointment, and must be a valid future 30-minute IST window within published
  store hours.

### Uploads

Multer keeps uploads in memory, limits them to 5 MB, and Sharp converts images
to WebP. Files are written through the Hostinger storage service
(`IMAGE_STORAGE_DRIVER=hostinger`) and served publicly from
`https://images.gokez.com`; local storage remains only for development and
migration. On the VPS the API must reach the storage container at
`http://gokez-storage:8080`, not `127.0.0.1`.

Product images generate thumbnail and large variants (`photo_variants`,
`mart_product_image_assets`). The storefront uses the thumbnail for cards and
the large variant for detail views. Hub's Image Manager lists, inspects and
deletes stored images and shows where each is referenced. A background cleanup
loop removes orphaned image assets and storage objects; `images:export-local`
exports legacy local files for migration.

### Operations

Sentry is initialised only in production when `SENTRY_DSN` is set. SIGTERM
handling drains in-flight requests and the database pool within an 8-second
budget; Render waits up to 30 seconds before killing the process.

Background work includes recovery of pending auto-confirm transitions,
scheduled promotional-push dispatch, product-image cleanup, daily inventory
snapshot creation and referral reward/reservation processing. Each loop is
idempotent; set `MART_BACKGROUND_JOBS_ENABLED=false` on an overlapping API
instance to avoid duplicate work.

## Roles and access

The current role list is defined by `ADMIN_ROLES` in
`mart-backend/src/middleware/index.ts` and the database constraint from
migration `056`:

| Role | Scope |
| --- | --- |
| `super_admin` | Whole platform: stores, subscriptions, store applications, users, catalog, compliance, customers, campaigns, promotions, zones, daily sales, carousel, home sections |
| `store_owner` | Their store: operations, catalog selection, team, campaigns, home sections, analytics; daily sales if it is the zone head store |
| `store_manager` | Their store: orders, products, inventory, catalog, analytics, feedback; daily sales if it is the zone head store |
| `staff` | Their store: orders, products, inventory and delivery |
| `delivery_staff` | Assigned deliveries only; can be assigned to multiple stores |

`sales_manager` is retired and is not a valid role. Any code or documentation
that still lists it is out of date. Daily Sales is deliberately restricted to
super admins and head-store owners/managers; member-store staff cannot view the
zone-wide ledger.

### Hub page availability

| Pages | Roles |
| --- | --- |
| `/`, `/orders`, `/profile`, `/change-password`, `/more` | All signed-in roles |
| `/products`, `/inventory` | `super_admin`, `store_owner`, `store_manager`, `staff` |
| `/catalog` | `super_admin`, `store_owner`, `store_manager` |
| `/categories` | `super_admin`, `store_owner` |
| `/delivery` | `staff`, `delivery_staff` |
| `/feedback` | `super_admin`, `store_owner`, `store_manager` |
| `/analytics`, `/top-selling` | `super_admin`, `store_owner`, `store_manager` |
| `/daily-sales` | `super_admin`, `store_owner`, `store_manager` (head store only) |
| `/stores` | `super_admin`, `store_owner`, `store_manager` |
| `/campaigns`, `/home-sections` | `super_admin`, `store_owner` |
| `/promotions`, `/zones`, `/subscriptions`, `/store-applications`, `/users`, `/compliance`, `/customers`, `/customer-leads`, `/suggestions`, `/install-analytics`, `/carousel`, `/restore-order`, `/image-manager` | `super_admin` |
| `/referrals` and its `/referral-*` redirects | `super_admin` |
| `/login`, `/apply`, `/merchant-terms`, `/hub`, `/landing` | Public |

`/team` redirects to `/stores`; the separate Team and Settings pages were
removed. Details, Plan, Staff and Inventory are now tabs on `/stores`.

The backend remains the authoritative permission check; the Hub route
allowlist is a navigation guard, not the security boundary.

## Multi-store marketplace

Gokez Mart is a marketplace, not a single grocery store. Each store has its own
catalog selection, pricing, zones, hours, team and delivery handlers.

### Zones and multi-store fulfilment

A **zone** is the customer-facing delivery area. Zones can contain multiple
stores and have:

- a primary **head store** (`mart_zones.primary_store_id`) that owns the
  customer-facing hours, closure state and delivery promise;
- member stores (`mart_zone_stores`) whose catalog, prices and stock are merged
  into the zone catalogue;
- zone-level settings (`mart_zone_settings`) for hours, delivery policy and
  closure, overriding the head store defaults where configured.

When a customer orders from a zone, the catalogue can span several stores. Each
order line records its fulfilling store, and `mart_order_store_fulfilments`
tracks that store’s portion through `pending`, `prepared`, `delivered`,
`picked_up` or `cancelled`. Member-store pickup is synced back without forcing
the master order out of its customer-facing status. The zone head can manage
member-store inventory, and order lines retain their source store for
fulfilment.

### Store onboarding

1. A merchant applies at `hub.gokez.com/apply`.
2. A super admin reviews the application.
3. A store is created and a store owner account is assigned.
4. The owner configures hours, branding, delivery settings and products.
5. A subscription is recorded and activated.
6. The store is marked live only after an active subscription exists.

### Subscriptions, not commission

The current revenue model is **subscription access only**:

- `mart_stores.revenue_model` is constrained to `subscription`.
- The old `commission`, `flat` and `both` modes are retired.
- The merchant keeps customer order payments.
- Gokez does not receive, hold, settle or process customer funds.
- Subscription fees are separate from customer orders and do not create a
  payout or settlement obligation.

A non-super-admin cannot use the Hub without an active subscription. A store
cannot be taken live without an active subscription.

### Team assignments

- `mart_admins.store_id` is a user's primary store.
- `mart_admin_store_assignments` grants access to additional stores.
- Creating or updating a user writes both the primary store and the active
  assignment in one transaction.
- Deactivating a store deactivates its assignments.
- Store name and address have a single source of truth: `mart_stores`. The old
  duplicate `store_name` and `store_address` settings keys were removed.

## Customer ordering and storefront

`mart-user` is the current production customer app and the source of truth for
customer-facing behaviour. The Expo app in `mart-mobile` is a separate client
under active development and may lag behind this feature set.

The customer web app is a single-page app with hand-rolled view routing in
`mart-user/src/App.tsx`. `react-router-dom` is installed but is not used by this
app.

### Customer web features

- Phone OTP sign-in with six-digit SMS auto-fill, and guest checkout
- Guest order tracking through an unguessable tracking token
- Address book with zones, coordinates and geofence checks
- Split-view category browsing and three-column mobile product grid
- Selectable product weight/quantity options with per-option price, discount and
  default choice; bundles and search aliases; search ranks exact product names
  ahead of local names and aliases
- Floating cart and checkout overlay that does not lose the underlying page
- Delivery preferences: fastest delivery or a scheduled **next-day 60-minute**
  IST window with a 30-minute lead; legacy `within_30`/`within_60` values still
  render
- Cart-aware recommendations that bridge the free-delivery gap or fall back to
  personalised discovery
- Minimum order, delivery fee, free-delivery threshold and free-delivery offers
- Campaigns, coupons, first-order and inactive-customer eligibility; campaigns
  can require scheduled delivery, exclude the first hour, or target zones and
  categories
- Referral page with personal code/link, share flow, credit balance and reward
  details; referral banners can be placed in dynamic homepage sections
- Dynamic homepage sections, carousel, deals, personalised rows and an
  admin-configurable **Fresh** page in the centre navigation with scoped search,
  suggestions, recent searches and an empty-search state
- Order history, order again, detailed tracking, status timeline, cancellation
  requests and partial-delivery adjustment history
- Browser-printable receipt/save-as-PDF, marked as a purchase receipt rather
  than a GST invoice
- DPDP controls: deletion request, grievance, data export and marketing consent
- Feedback and product suggestions
- PWA installation, offline shell, Web Push and an in-app notification prompt
- Thumbnail/large product image variants for faster cards and sharper detail
- SEO for the public pages and noindex for private/legal/support pages

### Customer views

`home`, `about`, `what-is-gokez-mart`, `categories`, `deals`, `orders`,
`account`, `privacy`, `terms`, `grievance`, `delete-account`, `feedback`,
`referral`, `fresh`.

Checkout is an overlay mounted over the current view, not a standalone route;
`/checkout` restores the overlay on reload. The public pages `/about/` and
`/what-is-gokez-mart/` are prerendered for search engines.

## Gokez Hub

Gokez Hub is the operations and management app.

### Hub features

- Role-adaptive sidebar and bottom navigation
- Dashboard and analytics for orders, revenue, customers, offers, order insights
  and authenticated product leaders, with a shared browse-date basis, custom
  ranges, top-15 ordering and an in-progress KPI
- Live order stream over SSE, a live-order alarm and a configurable ringtone
- Order confirmation, preparation, dispatch, delivery, cancellation,
  failed-delivery and termination flows
- Cancellation-request review, order rescheduling, and a Manage Order dialog for
  item additions/removals, quantity changes and payment adjustments
- Per-store fulfilment controls for multi-store orders
- Delivery assignment with active team-member filtering
- Delivery view with Google Maps navigation and status progression
- Product management with selectable weight/quantity options (per-option price,
  discount and default), drag-to-reorder, combo removal and Excel/CSV catalog
  import with retry/Done feedback
- Category slug normalisation/validation, category-scoped product codes
  (editable prefix, immutable once products exist) and generated
  thumbnail/large image variants with bulk upload
- Image Manager for listing stored images, checking usage references and
  deleting orphaned or replaced assets
- Master product catalog managed by super admins and priced per store by owners
- Inventory inline editing with reviewable drafts, restock/adjustment history,
  movement ledger filters, costed stock lines, daily valuation snapshots and
  profitability views; zone heads can manage member-store inventory
- Daily Sales ledger: online app orders plus itemised offline cash/UPI counter
  sales, restricted to super admins and head-store owners/managers
- Store onboarding wizard, subscriptions, branding, hours and deactivation;
  Details, Plan, Staff and Inventory are tabs on `/stores`
- Team management, username lookup and multi-store assignments
- Customer, lead and funnel views for super admins
- Campaigns, coupons, carousel, dynamic homepage sections and the Fresh page
- Referral/Earn management: campaigns, records, customer rewards, reward ledger,
  fraud review, reports, CSV export and credit adjustments
- Promotional Web Push: cohorts, zone targeting, quiet hours, preview/test/send,
  test recipients, delivery audit, open/click tracking and click fallback
- Zone management with head store, member stores, zone hours and delivery policy
- Compliance: deletion requests, grievances and audit logs
- Feedback and product-suggestion review
- Receipt printing
- PWA with push notifications, deploy-aware reloads, silent session refresh and
  a `public/update-policy.json` update policy

## Mobile app

`mart-mobile` is a separate native Expo app under active development, distinct
from the Capacitor customer Android wrapper in `mart-user/android`. It is not
part of the root workspace and currently has no CI or production EAS project
configured.
It is behind the current `mart-user` web experience; the sections below document
the mobile snapshot and its gaps, not feature parity with the web app.

### Current screens

- Auth: `login`, `setup-profile`
- Tabs: `home`, `categories`, `orders`, `profile`
- Shopping: `product/[id]`, `checkout`, `addresses`, `address-form`
- Orders: `order/[id]` tracking, `order-detail/[id]`
- Account: `feedback`, `grievance`, `notification-settings`, `privacy`, `terms`

### Implemented areas

- SecureStore session persistence
- Cart persistence with AsyncStorage
- OTP authentication with six-digit auto-fill boxes
- Product browsing, weight options, search and cart
- Zone-aware catalogue and settings, with a confirmation prompt that clears the
  cart when the delivery area changes
- Coupons and offers
- Delivery address and notes
- Order history, tracking and cancellation
- DPDP deletion request, grievances and marketing consent
- Theme store with light/dark palettes
- Push-permission screen and Expo Notifications package
- Zone ID and source-store ID sent with orders; thumbnail image variants in cards

### Mobile caveats

- Push-token registration and backend subscription are not implemented yet.
- The offline banner planned with NetInfo is not implemented.
- The post-delivery feedback trigger is not wired automatically.
- `app.config.js` declares `userInterfaceStyle: 'light'`; dark theme support is
  only partially configured.
- `eas.projectId` is empty; run `eas init` before an EAS build.
- Mobile checkout currently submits `cod` as the placeholder payment method.
- `start:local` sets `DEV_IP` in `app.config.js`, but the client does not read
  `extra.apiUrl`; set `EXPO_PUBLIC_API_URL` in `.env` instead.
- Guest tracking calls `GET /orders/track/guest`, which is not a mounted backend
  route. The backend exposes guest lookup through `/orders/track/tokens`.

## Order lifecycle

```text
pending ──► confirmed ──► preparing ──► ready_to_pickup ──► out_for_delivery ──► delivered
   │            │
   └─ cancelled ┘

out_for_delivery / picked_up ──► failed_delivery
any non-terminal order ──► terminated (super_admin or store_owner)
```

| Status | Meaning | Rules |
| --- | --- | --- |
| `pending` | Order placed | Orders auto-confirm after 2 seconds, including after-hours; staff can also confirm or cancel |
| `confirmed` | Store accepted the order | Staff must confirm preparation, which recalculates the promised delivery time; staff can cancel or reschedule |
| `preparing` | Being packed | Moves to ready-to-pickup |
| `ready_to_pickup` | Packed and assigned | Requires an active delivery handler for the store; member-store pickup marks the fulfilment prepared |
| `out_for_delivery` | Assigned handler started delivery | Only the assigned handler can start |
| `delivered` | Completed | Requires `cash` or `upi`; stamps payment and delivery time; deducts inventory when enabled; marks member-store fulfilments picked up |
| `cancelled` | Customer/store cancellation | Allowed from pending or confirmed; scheduled orders have a 30-minute cutoff before the slot |
| `failed_delivery` | Delivery could not be completed | Allowed from out-for-delivery or legacy picked-up |
| `terminated` | Super admin/store owner force-close | Allowed on any non-terminal order |

`picked_up` remains in the master status constraint for legacy rows, but the
normal delivery path still goes from `ready_to_pickup` to `out_for_delivery`.
For multi-store orders, `picked_up` is a per-store fulfilment status in
`mart_order_store_fulfilments`; the Hub and dashboard count it as in progress.
All orders auto-confirm like any other order, but none auto-start preparing;
they stay `confirmed` until staff begin preparation. Scheduled orders wait for
the delivery window.

### Cancellation, rescheduling and adjustments

- Customers can request cancellation while the order is `pending` or
  `confirmed`; the request is stored for staff review rather than cancelling
  immediately.
- Scheduled orders can be cancelled up to 30 minutes before the promised slot.
- A customer can edit the delivery address while the order is `pending` or
  `confirmed`, and can report a delay after the promised time.
- Store owners and super admins can reschedule an order to another valid future
  slot.
- Store owners/managers can add or remove items, change quantities or record a
  payment adjustment; every change is written to the order adjustment audit
  trail and reflected in the customer’s order history.

### After-hours and scheduled orders

- Orders placed while the store is closed are still accepted and auto-confirm
  like other orders, but they never auto-start preparing.
- The customer is told the store is closed and when it opens next.
- A manager can use “confirm for next opening”, which sets the order to
  `confirmed`, records `confirmed_next_open`, and sets `scheduled_for` to the
  next opening time.
- The customer storefront currently offers **next-day only** scheduling in
  **60-minute windows** with a 30-minute lead time. Campaigns can require
  scheduled delivery and exclude the first hour of the day.
- The backend still validates any scheduled order as a future 30-minute IST
  window within published store hours, so keep the storefront window and backend
  validation in sync if scheduling expands.
- Scheduled orders store a customer-facing label (`scheduled_label`) and remain
  `confirmed` until staff start preparing them.

## Payment handling

There is no online payment gateway, wallet or card integration.

- Checkout displays “Pay Cash / UPI On Delivery”.
- The customer web checkout sends no payment method at placement, so
  `mart_orders.payment_method` stays null until delivery. The mobile checkout
  currently submits `cod` as a placeholder.
- When the delivery handler completes the order in Gokez Hub, they must record
  **Cash** or **UPI**. The backend refuses to mark the order delivered without
  one of those two values.
- Cash is stored as `cod`; UPI is stored as `upi`. The legacy database value
  `phonepay` is still readable in old data, but the delivery API accepts only
  `cash` or `upi`.
- The Hub payment dialog supports an optional merchant UPI/PhonePe QR. Cash
  submits immediately; UPI requires either an immediate confirmation or a QR
  scan followed by confirmation.
- Web Push and the admin UI also show the payment state after collection.

Gokez does not receive, hold, settle or process customer payments. The merchant
is the seller and fulfiller, sets its own prices and taxes, handles refunds, and
receives payment directly.

## API overview

There is no generated OpenAPI/Swagger document. The authoritative route list is
`mart-backend/src/routes/index.ts`, which currently declares 218 routes:

- 93 GET
- 71 POST
- 42 PUT
- 12 DELETE
- 0 PATCH

The root `GET /` returns basic service information. `GET /api/v1/health` is the
health check and is exempt from the general rate limiter. All other routes are
mounted under `/api/v1`.

| Group | Representative paths | Notes |
| --- | --- | --- |
| Customer auth | `/auth/send-otp`, `/auth/verify-otp`, `/auth/me`, `/auth/profile`, `/auth/logout` | OTP; production uses 2Factor `Login_OTP` |
| Customer profile/orders | `/auth/orders`, `/auth/orders/:id/cancel`, `/auth/orders/:id/cancellation-request`, `/auth/addresses`, `/auth/upload/photo` | Customer JWT required |
| Public catalog | `/stores`, `/zones`, `/categories`, `/products`, `/settings/public`, `/catalog/stamp`, `POST /recommendations` | Store/zone-scoped queries; recommendations are cart-aware |
| Orders | `POST /orders`, `/guest-details`, `/orders/track`, `/orders/track/tokens`, `/orders/track/:id/cancel`, `/orders/track/:id/cancellation-request` | Guest and signed-in flows |
| Referrals | `/referrals/me`, `/referrals/validate`, `/referrals/claim`, `/referrals/credits`, `/referrals/credits/reserve`, `/referrals/credits/:id/release` | Customer codes, first-order credit and reward ledger |
| Admin auth | `/admin/login`, `/admin/logout`, `/admin/me`, `/admin/change-password` | Session-backed JWT |
| Admin orders | `/admin/orders`, `/admin/orders/:id/status`, `/admin/orders/:id/items`, `/admin/orders/:id/fulfilments/:storeId`, `/admin/orders/:id/reschedule`, `/admin/orders/:id/confirm-next-open`, `/admin/orders/:id/terminate`, `/admin/events` | SSE live stream, adjustments and per-store fulfilment |
| Daily sales | `/admin/daily-sales`, `/admin/daily-sales/day`, `/admin/daily-sales/entries` | Online totals plus offline counter sales |
| Catalog and products | `/admin/products`, `/admin/categories`, `/admin/catalog`, `/admin/products/bulk-from-catalog`, `/admin/products/:id/components` | Per-store pricing, option fields, product codes, master catalog |
| Stores and subscriptions | `/admin/stores`, `/admin/stores/:id/settings`, `/admin/store-subscriptions`, `/admin/store-applications` | Super-admin operations |
| Zones | `/admin/zones`, `/admin/zones/:id/stores`, `/admin/zones/:id/primary`, `/admin/zones/:id/settings` | Head store, member stores and zone policy |
| Team | `/admin/stores/:storeId/team`, `/admin/users/lookup`, `/admin/users/:userId/stores` | Store-scoped assignments |
| Inventory | `/admin/inventory`, `/admin/inventory/bulk-restock`, `/admin/inventory/movements`, `/admin/inventory/valuation`, `/admin/inventory/valuation-summary`, `/admin/inventory/profitability`, `/admin/inventory/:productId/stock`, `/admin/inventory/:productId/history` | Idempotency on writes; ledger, snapshots and costed views |
| Customers, funnel and analytics | `/admin/customers`, `/admin/customer-leads`, `/admin/customer-funnel/extended`, `/admin/install-analytics`, `/admin/analytics/summary`, `/admin/analytics/customers`, `/admin/analytics/top-products`, `/admin/analytics/order-insights`, `/admin/analytics/product-leaders` | Super-admin/funnel analytics and scoped Hub analytics |
| Campaigns and homepage | `/admin/campaigns`, `/admin/carousel`, `/admin/home-sections`, `/campaigns/eligible`, `/campaigns/validate` | Public and admin sides; referral banner is a home-section kind |
| Promotions | `/admin/promotions`, `/admin/promotions/audience/preview`, `/admin/promotions/audience/customers`, `/admin/promotions/:id/preview`, `/admin/promotions/:id/test`, `/admin/promotions/:id/send`, `/promotions/:id/click` | Web Push cohorts, test recipients and click/open tracking |
| Image manager | `/admin/storage/clean`, `/admin/storage/images`, `/admin/storage/images/:id`, `/admin/storage/images/:id/delete` | Hostinger storage inspection and cleanup |
| Admin referrals | `/admin/referral/campaigns`, `/admin/referral/records`, `/admin/referral/customers`, `/admin/referral/ledger`, `/admin/referral/fraud`, `/admin/referral/reports/:type`, `/admin/referral/export` | Super-admin campaign, reward, fraud and reporting controls |
| Compliance | `/compliance/deletion`, `/compliance/grievances`, `/compliance/data-export`, `/compliance/marketing-consent`, `/admin/compliance/audit-logs` | DPDP flows |
| Push | `/push/vapid-public-key`, `/push/subscribe/customer`, `/push/subscribe/guest`, `/push/subscribe/admin` | Web Push/VAPID only; guest uses tracker token, FCM routes pending |
| Feedback and suggestions | `POST /feedback`, `POST /suggestions`, `/admin/feedback`, `/admin/suggestions` | Public suggestion submission |

Responses use:

```json
{ "success": true, "data": {} }
```

Errors use:

```json
{ "success": false, "error": "Readable message" }
```

### Rate limits

Production limits include:

- General API: 300 requests per 15 minutes per IP
- OTP send: 10 per network and 3 per phone per 15 minutes
- OTP verify: 5 per phone per 15 minutes
- Admin login: 15 per IP and 5 per username/IP per 15 minutes
- Order placement: 10 per 5 minutes per IP
- Guest cancellation: 20 per 5 minutes per IP
- Guest cancellation request: 20 per 5 minutes per IP
- Guest order lookup: 240 per 15 minutes per IP
- Guest push subscription: 30 per 15 minutes per IP
- Reverse geocoding: 20 per 15 minutes per IP

Development limits are deliberately higher.

### Idempotency

`Idempotency-Key` is required for order placement, feedback, grievances and
inventory restock/stock changes. The header is allowed by CORS.

## Database

The backend owns the schema and applies migrations automatically before it
starts listening. There is no separate production migration step.

- 148 SQL migration files exist in `mart-backend/src/database/migrations`.
- 71 application tables are declared in those migrations, plus the runtime
  `mart_migrations` ledger.
- Applied migrations are recorded in `mart_migrations`.
- Each migration runs in its own transaction under a PostgreSQL
  transaction-scoped advisory lock, so two instances booting during a deploy
  cannot apply the same migration twice.
- There are no down migrations.

### Main table groups

| Area | Tables |
| --- | --- |
| Catalog | `mart_categories`, `mart_products`, `mart_store_products`, `mart_bundle_components`, `mart_product_suggestions`, `mart_product_image_assets` |
| Stores and zones | `mart_stores`, `mart_store_applications`, `mart_store_subscriptions`, `mart_zones`, `mart_zone_stores`, `mart_zone_settings` |
| Admin/team | `mart_admins`, `mart_admin_store_assignments`, `mart_admin_sessions` |
| Customers | `mart_customers`, `mart_customer_addresses`, `mart_customer_leads`, `mart_otps`, `mart_consents`, `mart_token_blacklist` |
| Orders | `mart_orders`, `mart_order_items`, `mart_order_item_bundle_components`, `mart_order_status_events`, `mart_order_delivery_events`, `mart_order_store_fulfilments`, `mart_order_item_adjustments` |
| Inventory | `mart_inventory_log`, `mart_inventory_movements`, `mart_inventory_daily_snapshots`, `mart_purchase_batches`, `mart_purchase_receipts`, `mart_purchase_receipt_lines`, `mart_stock_adjustments`, `mart_stock_reservations`, `mart_stock_transfers`, `mart_stock_transfer_lines` |
| Sales | `mart_offline_sales` |
| Campaigns | `mart_campaigns`, `mart_campaign_targets`, `mart_campaign_uses`, `mart_campaign_changes`, `mart_campaign_zones`, `mart_campaign_categories`, `mart_carousel_slides`, `mart_carousel_settings`, `mart_home_sections` |
| Promotions | `mart_promotions`, `mart_promotion_deliveries` |
| Referral | `mart_referral_campaigns`, `mart_referral_codes`, `mart_referrals`, `mart_referral_rewards`, `mart_referral_credits`, `mart_referral_transactions`, `mart_referral_audit_logs` |
| Funnel/analytics | `mart_funnel_sessions`, `mart_funnel_events`, `mart_visitor_attribution`, `mart_install_events`, `mart_install_rollup`, `mart_carts` |
| Engagement | `mart_feedback`, `mart_push_subscriptions` |
| Compliance | `mart_deletion_requests`, `mart_grievances`, `mart_data_exports`, `mart_audit_logs` |
| Configuration | `mart_settings` |

### Migration numbering

The directory contains 148 files but the sequence is not perfectly contiguous:

- `049` and `050` are absent.
- `079`, `080` and `103` each have two files with different suffixes.
- `148_inventory_daily_snapshots.sql` is currently the highest file.

Migrations are applied in **lexicographic filename order** and are recorded by
filename. Do not renumber migrations that have already run in an environment.
Add new migrations with the next unused number and a descriptive suffix.

### Database safety

Local development refuses a non-local database host unless
`ALLOW_REMOTE_DATABASE=true`. Do not set that flag in a normal development
setup. Production uses `NODE_ENV=production` and platform-provided variables
only; never commit `.env`, `.env.local` or credentials.

Early migrations include demo/admin seed accounts and a dev OTP shortcut.
Audit `mart_admins`, rotate seeded passwords, and remove or replace demo
accounts before using a database for a new production launch.

## Testing

| Area | Test files | Command |
| --- | --- | --- |
| Backend | 30 | `npm test --workspace=mart-backend` |
| Customer web | 10 | `npm test --workspace=mart-user` |
| Hub | 0 | — |
| Mobile | 0 | — |

Newer coverage includes backend referral, referral Hub tab and inventory
valuation tests, plus customer referral login/UI tests.

The backend suite uses Node's built-in test runner with `tsx`. Some tests need a
configured local PostgreSQL and complete environment; a fresh checkout should
not be assumed to be green without checking the failure output. The backend
suite has historically had environment-dependent failures. Record the actual
result before claiming a release is fully tested.

There is no lint script in the repository. TypeScript checks run as part of each
`build` script.

## Deployment

### API on Render (existing blueprint)

`render.yaml` describes the service:

- Root directory: repository root (required for npm workspaces)
- Branch: `main`
- Region: Singapore
- Build: `npm ci && npm run build --workspace=mart-backend`, followed by checks
  that `dist/index.js` and copied migrations exist
- Start: `npm run start --workspace=mart-backend`
- Health check: `/api/v1/health`
- Shutdown delay: 30 seconds, with an 8-second application drain budget
- Migrations: automatic at boot

Set the secrets listed in the backend environment table. Do **not** set `PORT`
on Render; Render provides it. The free plan can sleep, so the first request
after an idle period may wait while the service boots.

See `docs/DEPLOY_RENDER.md` for the complete cutover and DNS procedure.

### Railway (fallback)

`railway.json` remains in the repository as a record of intent. Railway reports
Config as Code as deprecated, with existing files supported only until
**2026-12-01**; configure Railway from its dashboard if it is still used. Use the
same root directory, build/start commands and environment variables as Render.

### Hostinger VPS

`deploy/hostinger/`, `.github/workflows/deploy-backend-hostinger.yml` and
`docs/DEPLOY_HOSTINGER.md` describe the VPS path that moves the API off Render.
Deploy `storage-service` first, then set `HOSTINGER_STORAGE_URL` to
`http://gokez-storage:8080` (container-to-container, not `127.0.0.1`). The API
runs on port `3000` behind nginx, reuses the existing PostgreSQL database, and
keeps the same variable names as Render. Set
`MART_BACKGROUND_JOBS_ENABLED=false` on an overlapping instance. See
`docs/HOSTINGER_ENV_MAPPING.md`, `docs/HOSTINGER_STORAGE.md` and
`docs/HOSTINGER_MIGRATION_PROCEDURE.md` for the full checklist.

### Customer web and Hub on Cloudflare Pages

| App | Build command | Output | Required build variable |
| --- | --- | --- | --- |
| `mart-user` | `npm ci && npm run build --workspace=mart-user` | `mart-user/dist` | `VITE_API_URL=https://<api-host>/api/v1` |
| `mart-hub` | `npm ci && npm run build --workspace=mart-hub` | `mart-hub/dist` | `VITE_API_URL=https://<api-host>/api/v1` |

Changing a Pages build variable does not rebuild an app; redeploy after changing
it.

### Mobile

There is no production Expo mobile deployment yet. Builds use EAS profiles in
`mart-mobile/eas.json`. Run `eas init` first and set the resulting project ID in
`app.config.js`. `build:preview` produces an internal Android APK;
`build:prod` produces an Android App Bundle and iOS build per the EAS profile.

The separate customer Capacitor app is built by
`.github/workflows/build-android.yml` on `mart-user` changes to `main` and by
manual dispatch. It runs `VITE_API_URL=https://api.mart.gokez.com/api/v1 npm run
cap:build --workspace=mart-user`, then assembles and uploads a debug APK. It is
not a signed Play Store release.

### Hub Android workflow

`.github/workflows/build-hub-android.yml` is still stale: it tries to sync
Capacitor in `mart-hub` and build `mart-hub/android`, but that project and its
Capacitor dependencies do not exist. Do not rely on it unless it is reimplemented.

## PWA and versioning

Both web apps are installable PWAs with service workers and offline shells.

### Automatic build IDs

Every Vite build writes a unique ID derived from the git short SHA plus a base36
timestamp. The same ID is written to:

- `/version.json` and `/cache-version.json`
- the service worker's own bytes, forcing the browser to install the new worker
- the bundle as `__BUILD_ID__`
- versioned iOS splash filenames, so iOS does not keep an old launch image

Do **not** manually bump `cache-version.json`. That instruction in older
documentation is obsolete; a normal build stamps it automatically.

### Update policy

- Both `mart-user/public/update-policy.json` and
  `mart-hub/public/update-policy.json` support `silent` (default) and `force`;
  both are currently set to `silent`.
- `silent` applies a new deploy on the next open/background, without
  interrupting an active session.
- `force` makes an open tab or installed PWA switch to the new build within about
  two minutes and should be used only for a planned deploy, then reset.
- The customer app also guards against reload loops and defers reloads during an
  OTP flow or active checkout.
- The Hub waits for a quiet period or the tab being hidden before reloading, and
  preserves the authenticated session across a forced update.

### Cloudflare caching

`_headers` files set `no-store` for `sw.js`, `version.json`,
`cache-version.json`, the HTML entry and both update-policy files. Hashed
`/assets/*` files are immutable for one year. Icons, splash images and stable
artwork use a short cache so new artwork can still reach returning users.

The customer app intentionally has **no active `_redirects` rules** and no
`404.html`; Cloudflare Pages provides native SPA fallback. Adding a catch-all
rewrite would shadow `robots.txt`, `sitemap.xml`, `manifest.json`, `sw.js` and
deep links.

## SEO

The customer storefront is the only indexed app. Hub is intentionally excluded
with `User-agent: *`, `Disallow: /` and `noindex` metadata.

Indexable URLs:

- `https://mart.gokez.com/`
- `https://mart.gokez.com/about/`
- `https://mart.gokez.com/what-is-gokez-mart/`

The sitemap contains exactly those three URLs. `/privacy/`, `/terms/`,
`/grievance/` and `/feedback/` are public but deliberately `noindex` and absent
from the sitemap. Private and transactional views are also excluded.

`npm run build --workspace=mart-user` prerenders the public pages and runs
`scripts/seo-check.mjs`. The check verifies:

- canonical URL agreement across `index.html`, `sitemap.xml` and runtime SEO
- a single title, description, robots and `og:image`
- valid JSON-LD without fabricated entities
- no private URLs in the sitemap
- no `404.html` and no active catch-all `_redirects` rule
- sitemap and robots declarations

Run `npm run seo:check --workspace=mart-user` after changing public pages,
metadata or Cloudflare files.

## Known gaps and caveats

These are current code-level limitations, not aspirational features:

1. **Batch dispatch is not wired end to end.** Hub still calls
   `POST /admin/orders/batch-dispatch`, but neither the route nor the controller
   exists in the backend. The UI call will 404.
2. **Mobile guest tracking points at a missing route.** Mobile calls
   `GET /orders/track/guest`; the backend exposes `/orders/track`
   (authenticated) and `/orders/track/tokens` (guest/token based).
3. **Mobile push is not complete.** Permission UI exists, but no Expo push token
   is registered or sent to the backend, and the backend currently stores Web
   Push subscriptions rather than Expo push tokens.
4. **Mobile offline and polish work is incomplete.** No NetInfo offline banner,
   no automatic post-delivery feedback trigger, and skeleton/haptic/empty-state
   polish remains.
5. **Mobile dark mode needs an audit.** Theme colors and a toggle exist, but
   `app.config.js` declares `userInterfaceStyle: 'light'`.
6. **Mobile is not deployable through EAS yet.** `eas.projectId` is empty and
   there is no mobile CI. For Android, `build:preview` targets an APK;
   production uses an app bundle.
7. **Master-order `picked_up` remains legacy.** Per-store fulfilments now use
   `picked_up` normally, but the master order still has no transition into it;
   the operational path is `ready_to_pickup → out_for_delivery → delivered`.
   Hub/mobile still display the legacy master status where old rows exist.
8. **The Hub Android workflow is stale.** `build-hub-android.yml` references a
   removed `mart-hub/android` Capacitor project. The customer
   `build-android.yml` workflow is valid and produces a debug APK.
9. **No online payment gateway exists.** Cash/UPI is collected and recorded at
   delivery; the app does not process cards, wallets or online UPI.
10. **No OpenAPI/Swagger document exists.** The route file is the API reference.
11. **The backend test suite is environment-sensitive.** It should not be
    described as fully passing without a fresh run in the target environment.
12. **Seed accounts need audit.** Early migrations contain demo/admin seed data;
    rotate or remove it before a new production launch.
13. **Hub and mobile have no automated tests.** TypeScript builds are the main
    static checks for both.
14. **Moving a primary store leaves the old assignment active.** The user keeps
    access to the previous store through `mart_admin_store_assignments`; confirm
    whether that is intended multi-store behaviour or should be revoked.
15. **`start:local` does not configure the mobile API client.** It supplies
    `DEV_IP` to `app.config.js`, but `services/api.ts` reads only
    `EXPO_PUBLIC_API_URL`; set that variable explicitly for device testing.
16. **Guest campaign redemptions are not counted per phone.** The per-customer
    limit counts non-null `mart_campaign_uses.customer_id`; other eligibility
    checks may still apply, but that limit does not bind guest rows.
17. **Scheduled window rules differ between client and server.** The storefront
    offers next-day 60-minute windows, while the backend still validates any
    future 30-minute IST window. Keep both sides in sync if scheduling expands.
18. **Mobile is behind the current customer web app.** `mart-user` is the
    production source of truth; `mart-mobile` has fewer implemented flows and
    should not be treated as feature-equivalent.
19. **Native customer push is not fully wired.** The Capacitor app handles FCM
    payloads and deep links, but the backend has no FCM token
    register/unregister routes; `google-services.json` is supplied outside the
    repo. Web Push on the website/PWA is unchanged.
20. **The customer Android build needs a build-time API URL.** `VITE_API_URL` is
    baked into the JS bundle; omitting it makes the app call the frontend origin
    and show no data. CI sets it to the production API.

## Git workflow

```text
feature/* -> develop -> main
```

Work in a feature branch. `main` triggers the Render API deploy, Cloudflare
Pages builds and the customer Capacitor debug APK workflow. Do not commit
secrets, `.env` files, service-role keys, storage API keys, VAPID private keys,
JWT secrets or Supabase database credentials.

## Documentation

- `docs/DEPLOY_RENDER.md`: Render blueprint, manual setup, DNS cutover, Railway
  differences, health verification and rollback context
- `docs/DEPLOY_HOSTINGER.md`: Hostinger VPS API/storage deployment, Docker
  networking, nginx, cutover and rollback
- `docs/HOSTINGER_ENV_MAPPING.md`, `docs/HOSTINGER_STORAGE.md`,
  `docs/HOSTINGER_MIGRATION_PROCEDURE.md`, `docs/IMAGE_STORAGE_AUDIT.md`:
  Hostinger storage and environment references
- `docs/BACKEND_COST_AUDIT.md`: backend resource usage and cost review
- `docs/DESIGN_UX_AUDIT_AND_PLAN.md`: design and UX audit notes
- `docs/HOMEPAGE_UX_AUDIT.md`: storefront homepage UX notes
- `INVENTORY_AUDIT_AND_PLAN.md`: inventory console and stock-accounting audit
- `ZONE_MULTI_STORE_IMPLEMENTATION_PLAN.md`: zone/multi-store design and
  rollout reference
- `mart-user/docs/android-capacitor.md`: Capacitor customer app build, identity,
  Firebase and notification setup
- `docs/marketing/`: brand and QR assets/scripts
- `mart-mobile/PLAN.md` and `mart-mobile/RULES.md`: mobile planning and product
  reference documents; verify details against current code rather than treating
  them as the implementation source of truth

## Contact

`support@gokez.com`
