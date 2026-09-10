# Gokez Mart 🛒

Hyperlocal grocery delivery platform for Kolkata — a multi-store marketplace that helps local stores go online and compete with big apps.

## Structure

```
gokez_mart/
├── mart-backend/   # Node.js + Express API (Render)
├── mart-user/      # Customer web app — Gokez Mart (Cloudflare Pages)
└── mart-hub/       # Operations app — Gokez Hub (Cloudflare Pages)
```

## Services

| Service | URL |
|---------|-----|
| API | https://mart-api-qzml.onrender.com |
| Customer App | https://mart.gokez.com |
| Gokez Hub | https://hub.gokez.com |
| Store Onboarding | https://hub.gokez.com/apply |
| Hub Landing Page | https://hub.gokez.com/hub |

## Development

```bash
# Install all dependencies (from root)
npm install

# Run backend API
npm run dev:api

# Run customer app
npm run dev:web

# Run Gokez Hub
npm run dev:admin
```

## Build & Deploy

```bash
npm run build --workspace=mart-user
npm run build --workspace=mart-hub
npm run build --workspace=mart-backend
```

## Cloudflare Pages Build Settings

### mart-user (Customer App)
- Build command: `npm ci && npm run build --workspace=mart-user`
- Build output: `mart-user/dist`

### mart-hub (Gokez Hub)
- Build command: `npm ci && npm run build --workspace=mart-hub`
- Build output: `mart-hub/dist`

## Architecture

### mart-backend
- Node.js + Express + TypeScript
- PostgreSQL (Supabase)
- Hosted on Render
- Auto-runs DB migrations on startup
- Push notifications via Web Push API
- Image uploads via Supabase Storage (1-year cache-control)
- Multi-store marketplace API
- Team management API (store assignments)

### mart-user (Customer App)
- React + TypeScript + Vite + TailwindCSS
- PWA with service worker (push notifications)
- Auto-reload on deploy via version polling
- Zepto-style product cards with ADD button on image
- 3-column mobile product grid
- Split-view categories (sidebar + product grid)
- Floating cart pill → direct checkout overlay (no page shift)
- Zepto-style checkout — items editable, address, delivery preference, payment
- Zone-based delivery
- Customer OTP auth
- Order history with Order Again, item thumbnails, bottom sheet detail
- Order receipt (browser print / save as PDF)
- "Fulfilled by [Store Name]" on orders
- DPDP compliance (deletion requests, grievances)
- Home carousel — marketing cards (swipeable, auto-scroll)
- SEO optimised with JSON-LD structured data

### mart-hub (Gokez Hub)
- React + TypeScript + Vite + TailwindCSS
- PWA with service worker
- Auto-reload on deploy via version polling
- Public landing page at `/hub`
- Store partner application page at `/apply`
- Adaptive bottom nav based on user role
- Role-based access control (6 roles)
- Inline profile edit in More page
- Drag-to-reorder products with batch save
- Category image upload
- Multi-store marketplace support
- Master product catalog (super admin manages, stores pick + price)
- Store onboarding wizard (create store → assign manager → go live)
- Store credentials management (reset password, copy login details)
- My Team page (store owner manages their team)
- Batch order dispatch
- Push notifications for new orders
- Store deactivation with team access removal
- Dedicated delivery staff view with Google Maps navigation
- Order receipt printing

## Multi-Store Marketplace

Gokez Mart is a platform where local stores can go online. Each store is independently managed by a store owner.

### How it works

```
Platform (Gokez — Super Admin)
    │
    ├── Shapoorji Store (Store Owner: Arman Ali)
    │       ├── Store Manager
    │       ├── Sales Manager
    │       ├── Staff
    │       └── Delivery Staff (can be shared)
    │
    └── Gobra Store (Store Owner: TBD)
            └── ...
```

### Store Onboarding Flow

1. Store owner applies at `hub.gokez.com/apply`
2. Super admin reviews application → approves
3. Super admin creates store + assigns store owner account
4. Store owner logs in → configures store (hours, logo, delivery settings)
5. Store owner picks products from master catalog → sets prices
6. Store owner adds their team
7. Super admin marks store as Live ✅

### Revenue Models

Each store can have:
- **Commission** — % of each order (default 10%)
- **Flat** — fixed monthly fee
- **Both** — commission + monthly fee

## Roles (Gokez Hub)

| Role | Access |
|------|--------|
| super_admin | Full platform — all stores, users, compliance, catalog |
| store_owner | Their store — full control + team management |
| store_manager | Their store — orders, products, customers, analytics |
| sales_manager | Their store — orders, customers |
| staff | Their store — orders, packing, inventory, delivery |
| delivery_staff | Assigned orders only (can be tagged to multiple stores) |

### Role Hierarchy

- **super_admin** — onboards stores, manages platform
- **store_owner** — owns the store, manages their team
- **store_manager** — day-to-day operations
- **sales_manager** — customer-facing operations
- **staff** — operations + delivery
- **delivery_staff** — delivery only, can serve multiple stores

## Order Status Flow

```
pending → confirmed → preparing → ready_to_pickup → out_for_delivery → picked_up → delivered
```

| Status | Who acts | Customer sees |
|--------|----------|---------------|
| pending | — | Order Placed |
| confirmed | Store owner/manager | Confirmed |
| preparing | Store staff | Being Prepared |
| ready_to_pickup | Store staff | Being Prepared |
| out_for_delivery | Manager dispatches | Being Prepared |
| picked_up | Delivery staff | On the Way 🛵 |
| delivered | Delivery staff | Delivered 🎉 |

## Order Number Format

`MRT` + `YYMMDD` + `4 random chars` = `MRT2509086THE`

- No dashes, short, readable
- Date embedded for easy sorting

## Order Receipt

- Available for delivered orders only
- Browser print / Save as PDF
- Shows: Gokez Mart logo, Order #, date, items, bill details, payment, fulfilled by store
- Disclaimer: "This is a purchase receipt, not a GST invoice"
- Powered by Gokez Technologies Pvt. Ltd.

## PWA Cache Management

Each app (`mart-user` and `mart-hub`) has two version files:

| File | Updated by | Purpose |
|------|------------|---------| 
| `public/version.json` | Auto — Vite on every build | Triggers silent page reload when new code is deployed |
| `public/cache-version.json` | You manually | Forces full SW cache clear on all devices |

### When to bump `cache-version.json`

| Scenario | Action |
|----------|--------|
| Bad deploy cached broken JS/CSS | Bump cache version |
| Android PWA showing stale/broken UI | Bump cache version |
| SW updated but old cache still served | Bump cache version |
| App crashing on specific Android phones | Bump cache version |
| Routine code/price/product updates | ❌ Not needed |

### How to bump

1. Edit `mart-user/public/cache-version.json` and/or `mart-hub/public/cache-version.json`:
```json
{ "v": "2" }
```
2. Commit and deploy via feature branch
3. All users get fresh cache automatically on next open

## Database Migrations

Migrations run automatically on backend startup. To run manually:

```bash
npm run db:migrate --workspace=mart-backend
```

Key migrations:
- `001` — Initial schema
- `010` — Multi-store support
- `023` — Drop legacy product columns
- `024` — Store branding, hours, revenue model
- `025` — Master product catalog
- `026` — Gobra store setup
- `027` — Rename store_manager → store_owner
- `028` — Multi-store role management (store assignments table)
- `029` — Add picked_up status
- `030` — Add ready_to_pickup status

## Git Workflow

Always work in feature branches:
```
feature/* → develop → main
```
Main branch triggers Render + Cloudflare deployments.

## Contact

support@gokez.com
