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

## PWA Cache Management

Each app (`mart-user` and `mart-hub`) has two version files that work together to keep users on the latest version:

| File | Updated by | Purpose |
|------|------------|---------|
| `public/version.json` | Auto — Vite on every build | Triggers silent page reload when new code is deployed |
| `public/cache-version.json` | You manually | Forces full SW cache clear on all devices |

### How it works

**`version.json`** — Every time you deploy, Vite generates a unique timestamp in this file. The app polls it every 2 minutes and on every foreground resume (critical for iOS PWA). When the version changes, the app silently reloads — users always get the latest prices, products and UI without doing anything.

**`cache-version.json`** — Controls the SW cache name (e.g. `gokez-mart-v1`). When you bump it to `v2`, the SW on next activation deletes all old caches and starts fresh. This is your emergency fix when the normal reload isn't enough.

### Why you need both

- `version.json` handles **routine deploys** — new code, price changes, product updates
- `cache-version.json` handles **broken cache situations** — when old broken files are stuck in the SW cache and won't go away

### When to bump `cache-version.json`

Only bump this when `version.json` auto-reload is not enough:

| Scenario | Action |
|----------|--------|
| Bad deploy cached broken JS/CSS | Bump cache version |
| Android PWA showing stale/broken UI after update | Bump cache version |
| SW updated but old cache still served on some devices | Bump cache version |
| App crashing on specific Android phones after deploy | Bump cache version |
| Routine code/price/product updates | ❌ Not needed — `version.json` handles this |

### How to bump

1. Edit `mart-user/public/cache-version.json` and/or `mart-hub/public/cache-version.json`:
```json
{ "v": "2" }
```
2. Commit and deploy via feature branch as usual
3. On next app open, all users get a completely fresh cache automatically

### Benefits
- ✅ No manual app reinstall needed by users
- ✅ Works on both Android and iOS PWA
- ✅ Zero downtime — cache clears silently in background
- ✅ Free — served from Cloudflare CDN, no server cost

## Git Workflow

Always work in feature branches:
```
feature/* → develop → main
```
Main branch triggers Render + Cloudflare deployments.

## Contact

support@gokez.com
