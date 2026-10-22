# Deploying the Gokez Mart API on Render

The backend moves from Railway to Render. Nothing in the code is specific to
either platform, and `railway.json` is untouched, so Railway still works as a
fallback.

There are two ways to create the service. **Use the Blueprint** if you can:
`render.yaml` already holds every setting below and keeps it in git.

---

## Option A — Blueprint (recommended)

1. Render Dashboard → **New → Blueprint**.
2. Pick the `babar14jan/gokez-mart` repository.
3. Render reads `render.yaml` and prompts for the variables marked
   `sync: false`. Enter the values from the [Environment](#3-environment-variables)
   section below.
4. Create the service. Done — the build, start, health check, region and
   shutdown delay all come from the file.

When the build or start command needs to change, it is a commit rather than a
dashboard edit.

---

## Option B — New Web Service (the manual form)

Fill the form exactly like this.

| Field | Value |
| --- | --- |
| **Source Code** | `babar14jan / gokez-mart` |
| **Name** | `mart-api-qzml` |
| **Language** | `Node` |
| **Branch** | `main` |
| **Region** | Singapore (Southeast Asia) |
| **Root Directory** | *leave blank* |
| **Build Command** | see below |
| **Start Command** | see below |
| **Compute** | Free, or a paid instance to avoid cold starts |

### Build Command

```bash
npm ci && npm run build --workspace=mart-backend && ls -la mart-backend/dist/index.js && ls mart-backend/dist/database/migrations | wc -l
```

### Start Command

```bash
npm run start --workspace=mart-backend
```

Ignore the `yarn` and `yarn start` placeholders in the form — they are only
examples.

---

## Why these values

**`Name` must match the existing Render service (`mart-api-qzml`).** The web
apps are built against that hostname. A different name creates a *second*
service and leaves the apps pointed at the first one.

**`Root Directory` must stay blank.** This is a monorepo: `npm install` at the
root hoists every workspace's dependencies into the root `node_modules`. A
build that runs from `mart-backend/` cannot find them and fails. Render also
warns that with a root directory set, changes *outside* it stop triggering
auto-deploys — so root-level changes would silently stop redeploying.

**The build command verifies its own output.** `npm run build --workspace=mart-backend`
compiles the TypeScript *and* copies the SQL migrations into `dist/`. The
trailing `ls` commands make the build **fail loudly** if either is missing,
instead of shipping an image that crash-loops on boot with
`Cannot find module '/app/mart-backend/dist/index.js'`.

**The start command is self-healing.** `mart-backend/scripts/start.mjs` runs
the compiled output when it is there, compiles it when it is not, and falls
back to running the TypeScript source through `tsx` as a last resort. It also
knows the difference between a build step and a start step, so a Build Command
that accidentally runs this script compiles and exits instead of hanging the
deploy.

---

## 1. Create the service

Complete the form above (or the Blueprint flow), then create it. The first
deploy runs automatically.

## 2. Health check

**Settings → Health Checks → Health Check Path:**

```
/api/v1/health
```

This route reads nothing from the database, so it answers even when the
database is slow. It is also exempt from the API's rate limiter.

## 3. Environment variables

**Environment tab → add each of these.** The values are the same ones the
Railway service already has.

| Key | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | Required. Turns on the production guards. |
| `DATABASE_URL` | *your Postgres URL* | Required. |
| `MART_JWT_SECRET` | *your secret* | Required. At least 32 characters, unique to this deployment. |
| `MART_CORS_ORIGIN` | `https://mart.gokez.com,https://hub.gokez.com` | Required. Comma separated, every entry HTTPS. |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | Required for image uploads. |
| `SUPABASE_SERVICE_ROLE_KEY` | *your key* | Required for image uploads. |
| `SUPABASE_BUCKET` | `mart-products` | |
| `TWO_FACTOR_API_KEY` | *your key* | **Required.** Without it every customer sign-in fails. |
| `VAPID_PUBLIC_KEY` | *your key* | Optional — push notifications. |
| `VAPID_PRIVATE_KEY` | *your key* | Optional — push notifications. |
| `VAPID_SUBJECT` | `mailto:support@gokez.com` | Optional — push notifications. |
| `SENTRY_DSN` | *your DSN* | Optional — error reporting. |

### Do not set these

**`PORT`** — Render injects its own (usually `10000`). Setting `PORT=3000`
makes Render's health check probe the wrong port and the deploy fails. The
code falls back correctly on its own.

### Two easy mistakes

**`MART_CORS_ORIGIN` lists the web apps, not the API.** It is the set of
origins a *page* is served from — `mart.gokez.com` and `hub.gokez.com`. The
API's own hostname is never a CORS origin.

**The API refuses to boot without both guards satisfied:**

- `MART_JWT_SECRET` present, not a known placeholder, and 32+ characters
- `MART_CORS_ORIGIN` non-empty, with every entry starting `https://`

A missing one is a boot failure, not a warning. See
`mart-backend/src/config/index.ts`.

## 4. Custom domain (optional)

Only needed for a prettier address such as `api.mart.gokez.com`. Without it,
`https://mart-api-qzml.onrender.com` works fine.

1. **Render → your service → Settings → Custom Domains** → add
   `api.mart.gokez.com`. Do this **first** — Render has to verify ownership
   before the record resolves. The certificate is issued automatically.
2. **Cloudflare (or wherever `gokez.com` is managed)** → add:

   | Type | Name | Value | Proxy |
   | --- | --- | --- | --- |
   | `CNAME` | `api.mart` | `mart-api-qzml.onrender.com` | **DNS only (grey cloud)** |

   Turn the Cloudflare proxy **off**. If it stays on (orange cloud),
   Cloudflare intercepts TLS and Render cannot finish its certificate
   validation, which shows up as repeated SSL errors.

## 5. Point the web apps at the API

`VITE_API_URL` is baked in **at build time**, not read at runtime.

**Cloudflare Pages → `mart-user` and `mart-hub` → Settings → Environment
variables:**

```
VITE_API_URL=https://api.mart.gokez.com/api/v1
```

or, if you skipped the custom domain:

```
VITE_API_URL=https://mart-api-qzml.onrender.com/api/v1
```

**Then redeploy both apps.** Changing a build variable does *not* rebuild
automatically — until you redeploy, the app keeps calling the old API.

---

## Things that behave differently from Railway

### The free plan sleeps

Render stops an idle free service and starts it again on the next request.
That first request after a pause waits for the boot, database migrations
included, so a customer sees the storefront's offline notice for those
seconds before it recovers on its own. That screen was built for exactly this
case, so nothing breaks — but if the store must answer instantly at any hour,
move the service to a paid instance type.

### Migrations run at boot

`mart-backend/src/index.ts` calls `runMigrations()` before the server listens.
The runner takes a transaction-scoped advisory lock, so two instances starting
at once cannot apply the same migration twice. No separate migration step is
needed.

### The region cannot be changed later

Singapore is the closest region to Kolkata. If you want a different one, set
it at creation — Render does not allow changing it afterwards.

---

## Verifying the deploy

Once the service is live:

```bash
curl https://mart-api-qzml.onrender.com/api/v1/health
# {"status":"ok","service":"gokez-mart-api"}
```

Then check, in order:

1. **Logs** — look for `🛒 Gokez Mart API running on port` and
   `✅ Mart migrations complete`.
2. **A customer sign-in** — confirms `TWO_FACTOR_API_KEY` is set. A failure
   here means the key is missing or wrong.
3. **The storefront** — load `mart.gokez.com` and confirm products appear.
   An empty storefront with a console CORS error means `MART_CORS_ORIGIN`
   does not include that origin.
4. **An image upload** from Gokez Hub — confirms the Supabase variables match
   the same project as `DATABASE_URL`.

---

## Related files

| File | Purpose |
| --- | --- |
| `render.yaml` | The Blueprint — build, start, health check, region, shutdown delay. |
| `railway.json` | Railway's equivalent. Still valid; Railway remains a fallback. |
| `mart-backend/scripts/start.mjs` | The self-healing start command. |
| `mart-backend/src/config/index.ts` | The production guards that can refuse a boot. |
| `mart-backend/src/index.ts` | Runs migrations, then starts the server. |
| `mart-backend/src/utils/shutdown.ts` | The drain on SIGTERM, bounded to 8s. |
