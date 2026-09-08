# Gokez Mart 🛒

Hyperlocal grocery delivery platform for Kolkata.

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
# Build customer app
npm run build --workspace=mart-user

# Build Gokez Hub
npm run build --workspace=mart-hub

# Build backend
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
- Image uploads via Supabase Storage

### mart-user (Customer App)
- React + TypeScript + Vite + TailwindCSS
- PWA with service worker (push notifications)
- Auto-reload on deploy via version polling
- Zepto-style product cards with ADD button on image
- 3-column mobile product grid
- Split-view categories (sidebar + product grid)
- Floating cart bar
- Zone-based delivery (Shapoorji, Gobra)
- Customer OTP auth
- DPDP compliance (deletion requests, grievances)

### mart-hub (Gokez Hub)
- React + TypeScript + Vite + TailwindCSS
- PWA with service worker
- Auto-reload on deploy via version polling
- Adaptive bottom nav based on user role
- Role-based access: super_admin, store_manager, sales_manager, delivery_staff
- Inline profile edit in More page
- Drag-to-reorder products with batch save
- Category image upload
- Multi-store support
- Batch order dispatch
- Push notifications for new orders

## Roles (Gokez Hub)

| Role | Access |
|------|--------|
| super_admin | Full access — all stores, users, compliance |
| store_manager | Orders, products, customers, analytics, settings |
| sales_manager | Dashboard, orders, products, customers |
| delivery_staff | Orders only |

## Git Workflow

Always work in feature branches:
```
feature/* → develop → main
```
Main branch triggers Render + Cloudflare deployments.

## Contact

support@gokez.com
