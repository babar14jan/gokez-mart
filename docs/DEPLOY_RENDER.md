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
| **Name** | `gokez-mart-backend` |
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

The name only needs to be unique within the Render account. It becomes the
`onrender.com` subdomain, but nothing in the repository depends on it, because
the web apps and the Android builds call `api.mart.gokez.com` rather than the
`onrender.com` address.

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

## 4. Custom domain — you already have one

The domain `api.mart.gokez.com` already exists and pointed at the Railway
service. So there was **no new DNS record to create** — the existing one had to
be **repointed** once Render was live. Until it was, the domain kept serving
from Railway.

The order below avoids downtime, because the old service stays up until the
new one is answering.

1. **Confirm Render is serving before touching DNS.** Hit the Render URL
   directly and check the health route:

   ```bash
   curl https://gokez-mart-backend.onrender.com/api/v1/health
   # {"status":"ok","service":"gokez-mart-api"}
   ```

2. **Render → your service → Settings → Custom Domains** → add
   `api.mart.gokez.com`. Render shows the target to use and issues the
   certificate automatically. Add it here first — it has to verify ownership
   before the record resolves.

3. **Cloudflare (or wherever `gokez.com` is managed)** → edit the **existing**
   record for `api.mart`:

   | Type | Name | Value | Proxy |
   | --- | --- | --- | --- |
   | `CNAME` | `api.mart` | `gokez-mart-backend.onrender.com` | **DNS only (grey cloud)** |

   If it was an `A` record pointing at a Railway IP, replace it with the
   `CNAME` above. Only one record for `api.mart` may exist.

   Keep the Cloudflare proxy **off** (grey cloud). If it stays on (orange
   cloud), Cloudflare intercepts TLS and Render cannot finish its certificate
   validation, which shows up as repeated SSL errors.

4. **Stop the Railway service** once the domain resolves to Render. Leaving
   both running is not harmful to the cutover — the DNS decides who answers —
   but two services on one database is two sets of migrations and two
   connection pools, and Railway's free plan will not keep it alive anyway.

Because the hostname does not change, the web apps need no rebuild and no
change to `VITE_API_URL`.

## 5. Point the web apps at the API

Only needed if you are **not** using `api.mart.gokez.com`. `VITE_API_URL` is
baked in **at build time**, not read at runtime.

**Cloudflare Pages → `mart-user` and `mart-hub` → Settings → Environment
variables:**

```
VITE_API_URL=https://api.mart.gokez.com/api/v1
```

If you skipped the custom domain and want to call Render directly:

```
VITE_API_URL=https://gokez-mart-backend.onrender.com/api/v1
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

### `PORT` is assigned, not chosen

Railway pins a target port (the existing service uses `3000`) and expects the
app to listen on it. Render assigns one of its own, usually `10000`, and
health-checks that port. The code reads `process.env.PORT` and falls back to
`3004` for local development, so nothing needs to change — but do not set
`PORT` as an environment variable on Render, or the health check will probe
the wrong port.

### The region cannot be changed later

Singapore is the closest region to Kolkata, and is what the Railway service
already uses. If you want a different one, set it at creation — Render does
not allow changing it afterwards.

### Railway's config file is being retired

Railway's dashboard reports **Config as Code is deprecated**, with existing
`railway.json` files working only until **2026-12-01**, and services that have
never used it unable to opt in after 2026-08-28. The running service also
reports **Railpack** as its builder, while `railway.json` names `NIXPACKS`,
and its Build Command and Healthcheck Path fields are empty even though the
file sets both. Treat `railway.json` as a record of intent rather than as the
configuration actually in force, and configure Railway from the dashboard if
you keep using it.

### Migrations run at boot

`mart-backend/src/index.ts` calls `runMigrations()` before the server listens.
The runner takes a transaction-scoped advisory lock, so two instances starting
at once cannot apply the same migration twice. No separate migration step is
needed. This also means two services sharing one database apply migrations
concurrently during a cutover; the lock makes that safe, but it is a reason
not to leave both running long-term.

---

## Verifying the deploy

Once the service is live:

```bash
curl https://api.mart.gokez.com/api/v1/health
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
| `railway.json` | Railway's equivalent. Being retired by Railway; see above. |
| `mart-backend/scripts/start.mjs` | The self-healing start command. |
| `mart-backend/src/config/index.ts` | The production guards that can refuse a boot. |
| `mart-backend/src/index.ts` | Runs migrations, then starts the server. |
| `mart-backend/src/utils/shutdown.ts` | The drain on SIGTERM, bounded to 8s. |
