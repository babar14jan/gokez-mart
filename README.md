# Gokez Mart

Gokez Mart is a hyperlocal grocery marketplace for Kolkata. Local stores sell
through the customer storefront, run day-to-day operations from Gokez Hub, and
fulfil orders with their own staff and delivery handlers. Gokez provides the
software, storefront, operations tooling and platform administration; customer
payments go directly to the merchant.

## What is in this repository

| Part | Purpose | Package |
| --- | --- | --- |
| `mart-backend` | Express + TypeScript API, PostgreSQL, migrations, Web Push, image uploads, SSE | `mart-backend` |
| `mart-user` | Current production customer storefront and installed PWA; source of truth for customer web behaviour | `mart-user` |
| `mart-hub` | Store owner, staff, delivery and super-admin operations app | `mart-hub` |
| `mart-mobile` | Native Expo customer app under active development; currently behind `mart-user` and not in root workspaces | `mart-mobile` |
| `docs` | Deployment, cost and homepage UX audit notes | — |

```text
gokez-mart/
├── mart-backend/          # API, migrations, backend tests
├── mart-user/             # customer React app + PWA
├── mart-hub/              # operations React app + PWA
├── mart-mobile/           # Expo / React Native app
├── docs/
│   ├── BACKEND_COST_AUDIT.md
│   ├── DEPLOY_RENDER.md
│   ├── HOMEPAGE_UX_AUDIT.md
│   └── marketing/
├── .github/workflows/     # legacy Android build workflows
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
| Hub | React 18, React Router 6, TypeScript 5, Vite 5, Tailwind 3, Zustand, Axios, React Hook Form |
| Mobile | Expo SDK 54, React Native 0.81, React 19, Expo Router 6, NativeWind 4, Zustand, Expo SecureStore |
| Database | PostgreSQL 16 locally; Supabase-compatible PostgreSQL in production |
| Storage | Supabase Storage, optional |
| Deployments | Render (API), Cloudflare Pages (web), EAS (mobile, not yet configured) |

Node `20.15.0` is pinned in `.nvmrc`; both root and backend require Node
`>=20.9.0`.

## Quick start

### Prerequisites

- Node.js 20.15 or newer
- npm
- Docker only if you want the bundled local PostgreSQL
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
provider is not called. Production uses 2Factor and requires
`TWO_FACTOR_API_KEY`. OTPs expire after 10 minutes and allow five verification
attempts; the database also refuses more than three non-expired OTP rows for the
same phone.

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
| `npm run start --workspace=mart-backend` | Self-healing production start script |
| `npm test --workspace=mart-backend` | Backend Node test suite |
| `npm run build --workspace=mart-user` | Type-check, Vite build, stamp versions, prerender public pages, run SEO checks |
| `npm run seo:check --workspace=mart-user` | Verify SEO source/build contract without a full build |
| `npm test --workspace=mart-user` | Customer app test suite |
| `npm run build --workspace=mart-hub` | Type-check, Vite build and stamp versions |
| `npm run preview --workspace=mart-user` | Preview the customer build on port `5177` |
| `npm run preview --workspace=mart-hub` | Preview the Hub build on port `5178` |

Mobile commands live in `mart-mobile/package.json`: `start`, `android`, `ios`,
`start:local`, `build:preview` and `build:prod` (EAS).

## Environment variables

### Backend

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Production | `production` enables production guards and disables local OTP/storage shortcuts |
| `PORT` | No | Defaults to `3004`; do not set on Render |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ALLOW_REMOTE_DATABASE` | Local only | Set to `true` only to deliberately allow a non-local database in development |
| `MART_JWT_SECRET` | Yes in production | Unique secret, at least 32 characters |
| `MART_JWT_EXPIRES_IN` | No | Admin session lifetime, default `90d` |
| `MART_CORS_ORIGIN` | Yes in production | Comma-separated HTTPS page origins, for example `https://mart.gokez.com,https://hub.gokez.com` |
| `SUPABASE_URL` | For uploads | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | For uploads | Server-side Supabase key |
| `SUPABASE_BUCKET` | No | Defaults to `mart-products` |
| `TWO_FACTOR_API_KEY` | Production | Sends customer OTPs; without it customer sign-in fails |
| `VAPID_PUBLIC_KEY` | Optional | Web Push public key |
| `VAPID_PRIVATE_KEY` | Optional | Web Push private key |
| `VAPID_SUBJECT` | Optional | Defaults to `mailto:support@gokez.com` |
| `SENTRY_DSN` | Optional | Enables Sentry only in production |
| `NOMINATIM_BASE_URL` | Optional | Reverse geocoding provider |
| `NOMINATIM_USER_AGENT` | Optional | Required by public Nominatim etiquette |

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
- Global 404 and error handlers; internal 5xx messages are not exposed

### Authentication and authorisation

- Admin and customer tokens use the same JWT secret but different signed
  `type` claims. A customer token cannot be used as an admin token and a token
  without the correct type is rejected.
- Admin sessions have a `mart_admin_sessions` row with a `jti`; logout revokes
  the session and the middleware checks the row on every request.
- Non-`super_admin` users need an active store subscription to sign in and to
  use authenticated endpoints.
- Store-scoped routes use `requireStoreAccess`, which checks both the admin's
  primary store and active rows in `mart_admin_store_assignments`.
- Unknown or missing roles fail closed; there is no default elevation.

### Orders, realtime and notifications

- Order placement runs in a transaction and supports idempotency keys.
- The Hub receives live order events over Server-Sent Events at
  `GET /api/v1/admin/events`.
- Web Push subscriptions are stored for customers, guests and admins. Guests
  are addressed by the order tracking token.
- Inventory is deducted when an order becomes `delivered`, but only when the
  store has inventory tracking enabled.
- Campaign redemptions are reversed when an order becomes `cancelled`,
  `failed_delivery` or `terminated`.
- Guests can use first-order/all campaigns, but inactive-customer and
  targeted-customer offers require a signed-in customer.
- An order that is placed while the store is closed can be confirmed for the
  next opening. Scheduled delivery is a preference, not a guaranteed
  appointment, and must be a valid future 30-minute IST window within published
  store hours.

### Uploads

Multer keeps uploads in memory, limits them to 5 MB, and Sharp converts images
to WebP. Files are written to Supabase Storage when configured; local
development can fall back to the local uploads directory. Uploaded product
images are served with a one-year cache policy from Supabase.

### Operations

Sentry is initialised only in production when `SENTRY_DSN` is set. SIGTERM
handling drains in-flight requests and the database pool within an 8-second
budget; Render waits up to 30 seconds before killing the process.

## Roles and access

The current role list is defined by `ADMIN_ROLES` in
`mart-backend/src/middleware/index.ts` and the database constraint from
migration `056`:

| Role | Scope |
| --- | --- |
| `super_admin` | Whole platform: stores, subscriptions, store applications, users, catalog, compliance, customers, campaigns, carousel, home sections |
| `store_owner` | Their store: operations, catalog selection, team, campaigns, home sections, analytics, settings |
| `store_manager` | Their store: orders, products, inventory, catalog, analytics, feedback, settings |
| `staff` | Their store: orders, products, inventory and delivery |
| `delivery_staff` | Assigned deliveries only; can be assigned to multiple stores |

`sales_manager` is retired and is not a valid role. Any code or documentation
that still lists it is out of date.

### Hub page availability

| Pages | Roles |
| --- | --- |
| `/`, `/orders`, `/profile`, `/change-password`, `/more` | All signed-in roles |
| `/products`, `/inventory` | `super_admin`, `store_owner`, `store_manager`, `staff` |
| `/catalog` | `super_admin`, `store_owner`, `store_manager` |
| `/categories` | `super_admin`, `store_owner` |
| `/delivery` | `staff`, `delivery_staff` |
| `/feedback` | `super_admin`, `store_owner`, `store_manager` |
| `/analytics`, `/settings` | `super_admin`, `store_owner`, `store_manager` |
| `/team`, `/campaigns`, `/home-sections` | `super_admin`, `store_owner` |
| `/stores`, `/subscriptions`, `/store-applications`, `/users`, `/compliance`, `/customers`, `/customer-leads`, `/suggestions`, `/install-analytics`, `/carousel` | `super_admin` |
| `/login`, `/apply`, `/merchant-terms`, `/hub`, `/landing` | Public |

The backend remains the authoritative permission check; the Hub route
allowlist is a navigation guard, not the security boundary.

## Multi-store marketplace

Gokez Mart is a marketplace, not a single grocery store. Each store has its own
catalog selection, pricing, zones, hours, team and delivery handlers.

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

- Phone OTP sign-in and guest checkout
- Guest order tracking through an unguessable tracking token
- Address book with zones, coordinates and geofence checks
- Split-view category browsing and three-column mobile product grid
- Product weight/unit options, bundles and search aliases
- Floating cart and checkout overlay that does not lose the underlying page
- Delivery preferences: fastest delivery or a scheduled 30-minute IST window
  within store hours, offered for today/tomorrow with a 30-minute lead time;
  legacy `within_30`/`within_60` values still render
- Minimum order, delivery fee, free-delivery threshold and free-delivery offers
- Campaigns, coupons, first-order and inactive-customer eligibility
- Dynamic homepage sections, carousel, deals and personalised rows
- Order history, order again, detailed tracking and status timeline
- Browser-printable receipt/save-as-PDF, marked as a purchase receipt rather
  than a GST invoice
- DPDP controls: deletion request, grievance, data export and marketing consent
- Feedback and product suggestions
- PWA installation, offline shell and Web Push
- SEO for the public pages and noindex for private/legal/support pages

### Customer views

`home`, `about`, `what-is-gokez-mart`, `categories`, `deals`, `orders`,
`account`, `privacy`, `terms`, `grievance`, `delete-account`, `feedback`.

Checkout is an overlay mounted over the current view, not a standalone route;
`/checkout` restores the overlay on reload. The public pages `/about/` and
`/what-is-gokez-mart/` are prerendered for search engines.

## Gokez Hub

Gokez Hub is the operations and management app.

### Hub features

- Role-adaptive sidebar and bottom navigation
- Dashboard and analytics for orders, revenue, customers and offers
- Live order stream over SSE
- Order confirmation, preparation, dispatch, delivery, cancellation,
  failed-delivery and termination flows
- Delivery assignment with active team-member filtering
- Delivery view with Google Maps navigation and status progression
- Product management, drag-to-reorder, category images and bulk catalog import
- Master product catalog managed by super admins and priced per store by owners
- Inventory, restock and adjustment history with idempotency keys
- Store onboarding wizard, subscriptions, branding, hours and deactivation
- Team management, username lookup and multi-store assignments
- Customer, lead and funnel views for super admins
- Campaigns, coupons, carousel and dynamic homepage section management
- Compliance: deletion requests, grievances and audit logs
- Feedback and product-suggestion review
- Receipt printing
- PWA with push notifications and deploy-aware reloads

## Mobile app

`mart-mobile` is a native Expo app under active development. It is not part of
the root workspace and currently has no CI or production EAS project configured.
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
- OTP authentication and guest checkout
- Product browsing, weight options, search and cart
- Zone/store selection
- Coupons and offers
- Delivery address and notes
- Order history, tracking and cancellation
- DPDP deletion request, grievances and marketing consent
- Theme store with light/dark palettes
- Push-permission screen and Expo Notifications package

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
| `pending` | Order placed | Store staff can confirm or cancel |
| `confirmed` | Store accepted the order | Moves to preparing |
| `preparing` | Being packed | Moves to ready-to-pickup |
| `ready_to_pickup` | Packed and assigned | Requires an active delivery handler for the store |
| `out_for_delivery` | Assigned handler started delivery | Only the assigned handler can start |
| `delivered` | Completed | Requires `cash` or `upi`; stamps payment and delivery time; deducts inventory when enabled |
| `cancelled` | Customer/store cancellation | Allowed from pending or confirmed |
| `failed_delivery` | Delivery could not be completed | Allowed from out-for-delivery or legacy picked-up |
| `terminated` | Super admin/store owner force-close | Allowed on any non-terminal order |

`picked_up` exists in the database constraint and is accepted as an inbound
state for legacy orders, but the current backend has no transition **into**
`picked_up`. The current operational path goes from `ready_to_pickup` directly
to `out_for_delivery`. The mobile app and some Hub views still display the
legacy `picked_up` step.

### After-hours and scheduled orders

- Orders placed while the store is closed are still accepted.
- The customer is told the store is closed and when it opens next.
- A manager can use “confirm for next opening”, which sets the order to
  `confirmed`, records `confirmed_next_open`, and sets `scheduled_for` to the
  next opening time.
- A scheduled order must be a valid future 30-minute IST window and must fall
  within published store hours.

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
`mart-backend/src/routes/index.ts`, which currently declares 142 routes:

- 59 GET
- 43 POST
- 30 PUT
- 10 DELETE
- 0 PATCH

The root `GET /` returns basic service information. `GET /api/v1/health` is the
health check and is exempt from the general rate limiter. All other routes are
mounted under `/api/v1`.

| Group | Representative paths | Notes |
| --- | --- | --- |
| Customer auth | `/auth/send-otp`, `/auth/verify-otp`, `/auth/me`, `/auth/logout` | OTP; production uses 2Factor |
| Customer profile/orders | `/auth/orders`, `/auth/orders/:id/cancel`, `/auth/addresses` | Customer JWT required |
| Public catalog | `/stores`, `/zones`, `/categories`, `/products`, `/settings/public`, `/catalog/stamp` | Store-scoped queries |
| Orders | `POST /orders`, `/guest-details`, `/orders/track`, `/orders/track/tokens`, `/orders/track/:id/cancel` | Guest and signed-in flows |
| Admin auth | `/admin/login`, `/admin/logout`, `/admin/me`, `/admin/change-password` | Session-backed JWT |
| Admin orders | `/admin/orders`, `/admin/orders/:id/status`, `/admin/orders/:id/confirm-next-open`, `/admin/orders/:id/terminate`, `/admin/events` | SSE live stream |
| Catalog and products | `/admin/products`, `/admin/categories`, `/admin/catalog`, `/admin/products/bulk-from-catalog` | Per-store pricing and master catalog |
| Stores and subscriptions | `/admin/stores`, `/admin/stores/:id/settings`, `/admin/store-subscriptions`, `/admin/store-applications` | Super-admin operations |
| Team | `/admin/stores/:storeId/team`, `/admin/users/lookup`, `/admin/users/:userId/stores` | Store-scoped assignments |
| Inventory | `/admin/inventory`, `/admin/inventory/bulk-restock`, `/admin/inventory/:productId/stock`, `/admin/inventory/:productId/history` | Idempotency required on writes |
| Customers and funnel | `/admin/customers`, `/admin/customer-leads`, `/admin/customer-funnel/extended`, `/admin/install-analytics` | Super-admin analytics |
| Campaigns and homepage | `/admin/campaigns`, `/admin/carousel`, `/admin/home-sections`, `/campaigns/eligible`, `/campaigns/validate` | Public and admin sides |
| Compliance | `/compliance/deletion`, `/compliance/grievances`, `/compliance/data-export`, `/compliance/marketing-consent`, `/admin/compliance/audit-logs` | DPDP flows |
| Push | `/push/vapid-public-key`, `/push/subscribe/customer`, `/push/subscribe/guest`, `/push/subscribe/admin` | Guest subscription uses tracker token |
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
- Guest order lookup: 20 per 15 minutes per IP
- Guest push subscription: 30 per 15 minutes per IP
- Reverse geocoding: 20 per 15 minutes per IP

Development limits are deliberately higher.

### Idempotency

`Idempotency-Key` is required for order placement, feedback, grievances and
inventory restock/stock changes. The header is allowed by CORS.

## Database

The backend owns the schema and applies migrations automatically before it
starts listening. There is no separate production migration step.

- 99 SQL migration files exist in `mart-backend/src/database/migrations`.
- 43 application tables are declared in those migrations, plus the runtime
  `mart_migrations` ledger.
- Applied migrations are recorded in `mart_migrations`.
- Each migration runs in its own transaction under a PostgreSQL
  transaction-scoped advisory lock, so two instances booting during a deploy
  cannot apply the same migration twice.
- There are no down migrations.

### Main table groups

| Area | Tables |
| --- | --- |
| Catalog | `mart_categories`, `mart_products`, `mart_store_products`, `mart_bundle_components`, `mart_product_suggestions` |
| Stores | `mart_stores`, `mart_store_applications`, `mart_store_subscriptions`, `mart_zones` |
| Admin/team | `mart_admins`, `mart_admin_store_assignments`, `mart_admin_sessions` |
| Customers | `mart_customers`, `mart_customer_addresses`, `mart_customer_leads`, `mart_otps`, `mart_consents`, `mart_token_blacklist` |
| Orders | `mart_orders`, `mart_order_items`, `mart_order_item_bundle_components`, `mart_order_status_events` |
| Inventory | `mart_inventory_log` |
| Campaigns | `mart_campaigns`, `mart_campaign_targets`, `mart_campaign_uses`, `mart_campaign_changes`, `mart_carousel_slides`, `mart_carousel_settings`, `mart_home_sections` |
| Funnel/analytics | `mart_funnel_sessions`, `mart_funnel_events`, `mart_visitor_attribution`, `mart_install_events`, `mart_install_rollup`, `mart_carts` |
| Engagement | `mart_feedback`, `mart_push_subscriptions` |
| Compliance | `mart_deletion_requests`, `mart_grievances`, `mart_data_exports`, `mart_audit_logs` |
| Configuration | `mart_settings` |

### Migration numbering

The directory contains 99 files but the sequence is not perfectly contiguous:

- `049` and `050` are absent.
- `079` and `080` each have two files with different suffixes.
- `099_backfill_admin_store_assignments.sql` is currently the highest file.

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
| Backend | 18 | `npm test --workspace=mart-backend` |
| Customer web | 8 | `npm test --workspace=mart-user` |
| Hub | 0 | — |
| Mobile | 0 | — |

The backend suite uses Node's built-in test runner with `tsx`. Some tests need a
configured local PostgreSQL and complete environment; a fresh checkout should
not be assumed to be green without checking the failure output. The backend
suite has historically had environment-dependent failures. Record the actual
result before claiming a release is fully tested.

There is no lint script in the repository. TypeScript checks run as part of each
`build` script.

## Deployment

### API on Render (primary)

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

### Customer web and Hub on Cloudflare Pages

| App | Build command | Output | Required build variable |
| --- | --- | --- | --- |
| `mart-user` | `npm ci && npm run build --workspace=mart-user` | `mart-user/dist` | `VITE_API_URL=https://<api-host>/api/v1` |
| `mart-hub` | `npm ci && npm run build --workspace=mart-hub` | `mart-hub/dist` | `VITE_API_URL=https://<api-host>/api/v1` |

Changing a Pages build variable does not rebuild an app; redeploy after changing
it.

### Mobile

There is no production mobile deployment yet. Builds use EAS profiles in
`mart-mobile/eas.json`. Run `eas init` first and set the resulting project ID in
`app.config.js`. `build:preview` produces an internal Android APK;
`build:prod` produces an Android App Bundle and iOS build per the EAS profile.

### Legacy Android workflows

`.github/workflows/build-android.yml` and
`.github/workflows/build-hub-android.yml` still attempt Capacitor sync/builds
against `mart-user/android` and `mart-hub/android`. Those directories and the
Capacitor dependencies no longer exist. These workflows are stale and will fail
if triggered. The current native path is `mart-mobile` with Expo/EAS.

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

- `mart-user/public/update-policy.json` supports `silent` (default) and `force`.
- `silent` applies a new deploy on the next open/background, without
  interrupting an active session.
- `force` makes an open tab or installed PWA switch to the new build within about
  two minutes and should be used only for a planned deploy, then reset.
- The customer app also guards against reload loops and defers reloads during an
  OTP flow or active checkout.
- The Hub waits for a quiet period or the tab being hidden before reloading.

### Cloudflare caching

`_headers` files set `no-store` for `sw.js`, `version.json`,
`cache-version.json`, the HTML entry and the customer update policy. Hashed
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

1. **Batch dispatch is not wired end to end.** Hub calls
   `POST /admin/orders/batch-dispatch`, and the controller exists, but the route
   is not registered in `mart-backend/src/routes/index.ts`. The UI call will 404.
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
7. **Legacy `picked_up` is inconsistent.** The database accepts it and Hub/mobile
   display it, but the backend never transitions an order into it.
8. **The old Android workflows are stale.** They reference removed Capacitor
   projects and will fail if triggered.
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
17. **Mobile is behind the current customer web app.** `mart-user` is the
    production source of truth; `mart-mobile` has fewer implemented flows and
    should not be treated as feature-equivalent.

## Git workflow

```text
feature/* -> develop -> main
```

Work in a feature branch. `main` triggers the Render API deploy and the
Cloudflare Pages builds. Do not commit secrets, `.env` files, service-role keys,
VAPID private keys, JWT secrets or Supabase credentials.

## Documentation

- `docs/DEPLOY_RENDER.md`: Render blueprint, manual setup, DNS cutover, Railway
  differences, health verification and rollback context
- `docs/BACKEND_COST_AUDIT.md`: backend resource usage and cost review
- `docs/HOMEPAGE_UX_AUDIT.md`: storefront homepage UX notes
- `docs/marketing/`: brand and QR assets/scripts
- `mart-mobile/PLAN.md` and `mart-mobile/RULES.md`: mobile planning and product
  reference documents; verify details against current code rather than treating
  them as the implementation source of truth

## Contact

`support@gokez.com`
