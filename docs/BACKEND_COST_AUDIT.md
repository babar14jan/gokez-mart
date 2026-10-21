# Gokez MART Backend — Railway Cost & Resource Audit

**Scope:** `mart-backend` (Node 20, Express 4, TypeScript, CommonJS) on Railway Hobby, against Supabase PostgreSQL via the `pg` Pool.
**Status:** Audit only. **No code has been changed.** Every fix below is proposed and awaiting approval.
**Business context:** live production system, ~20–25 orders/day, must stay available 24/7.

---

## Part 1 — Executive summary

The backend is already efficient in the way that matters most for an always-on service: **it does no work when idle.** There is exactly one `setInterval` in the entire codebase (`controllers/index.ts:685`, a per-connection SSE keepalive) — no cron jobs, no polling loops, no reconciliation timers, no background work of any kind. There is a single `pg` Pool with no connection leaks.

So the bill is **not** driven by CPU. At 20–25 orders/day, request handling is negligible. The bill is dominated by **RAM-hours** — the process is always on, so Railway charges for its memory every minute of every day.

That makes **baseline process memory the single highest-value lever**. Measured on the real running process (see Part 5 for the method):

| Variant | Boot RSS | Δ |
|---|---|---|
| As-is | **89.6 MB** | — |
| Without `@sentry/node` | 73.8 MB | **−15.8 MB (−17.6%)** |
| Without `sharp` (lazy-loaded) | 78.6 MB | **−11.0 MB (−12.3%)** |
| Without both | **61.8 MB** | **−27.8 MB (−31.0%)** |

Both modules are imported eagerly at startup but are barely used. Two small changes buy a **31% cut in always-on RAM** with no behavioural change.

Alongside that, the audit found one genuine production-safety gap (no graceful shutdown), one CPU cost vector in the login path (bcrypt at 12 rounds — 255 ms measured per compare), and four outbound HTTP calls with no timeout.

---

## Part 2 — Findings, ranked by priority

### P1 — `@sentry/node` is loaded even when Sentry is unused

**Files / lines**
- `mart-backend/src/app.ts:10` — `import * as Sentry from '@sentry/node';` (module scope, always executed)
- `mart-backend/src/app.ts:18-24` — the **only** use, guarded by `config.env === 'production' && process.env.SENTRY_DSN`

**Root cause and evidence**

The import is unconditional; only `init()` is conditional. The SDK drags in `@opentelemetry/{api,core,instrumentation,sdk-trace-base}` — **none of which this codebase imports directly** (verified: `grep -rn "@opentelemetry" src/` → no matches). `Sentry.*` is referenced nowhere else in `src/`.

```
src/app.ts:10   import * as Sentry from '@sentry/node';
src/app.ts:18   if (config.env === 'production' && process.env.SENTRY_DSN) {
src/app.ts:19     Sentry.init({
src/app.ts:22       tracesSampleRate: 0.1,
```

Isolated measurement (plain Node, fresh process): **29.5 MB → 84.4 MB** on import. In the real application the V8 heap is shared, so the *marginal* cost is the measured **15.8 MB** of the app's 89.6 MB.

**Impact:** −15.8 MB always-on RAM (17.6%) **if `SENTRY_DSN` is unset**. If it is set, the cost is the price of error tracking and the import is genuinely needed.

**Risk:** Low if `SENTRY_DSN` is unset (the import is simply not required). **Medium** if it is set — a lazy import must still initialise before the first request is served.

**Railway effect:** RAM only.

> **Open question 1: is `SENTRY_DSN` set on the Railway service?** If unset, this is pure waste. If set, the right move is to move the import off the boot path rather than remove it.

**Recommended fix (if DSN unset):** delete the import and the `init` block, or guard both behind a dynamic `import()`.
**Verification:** boot the service and confirm `/api/v1/health` responds; confirm the boot RSS dropped; confirm no `Sentry` reference errors.

---

### P2 — `sharp` is loaded at startup for a rarely-used image path

**Files / lines**
- `mart-backend/src/controllers/index.ts:5` — `import sharp from 'sharp';`
- `mart-backend/src/controllers/index.ts:48-65` — the **only** use, `prepareImage()`

**Root cause and evidence**

`sharp` is a native module (libvips). It is used only to re-encode an uploaded product image to WebP (`prepareImage`). A lazy `await import('sharp')` inside `prepareImage` defers the load to the first image upload — identical behaviour, no cost until an image is actually processed.

**Impact:** −11.0 MB always-on RAM (12.3%). CPU is unchanged — the work still only happens on upload.

**Risk:** Low. The only nuance is a one-off module-load latency (~100 ms) on the first upload after a deploy.

**Railway effect:** RAM only.

**Recommended fix**

```ts
// controllers/index.ts — inside prepareImage()
const { default: sharp } = await import('sharp');
const image = sharp(buffer, { failOn: 'error' }).rotate().resize({ ... });
```

**Verification:** upload a product image and confirm the emitted WebP is byte-comparable to today's; confirm the boot RSS dropped by ~11 MB.

---

### P3 — No graceful shutdown

**Files / lines**
- `mart-backend/src/index.ts:1-18` — the entire entry point

**Root cause and evidence**

```
$ grep -rn "pool.end|SIGTERM|SIGINT|process.on(" src/
(no matches anywhere in the backend)
```

Railway sends `SIGTERM` on every deploy and restart. Node's default `SIGTERM` behaviour terminates the process immediately, so:

- in-flight requests are **cut off mid-response** — a customer placing an order during a deploy can see a dropped connection;
- the PG pool is not drained; open client sockets are abandoned;
- the SSE streams opened at `controllers/index.ts:664-694` are not closed.

**Impact:** not a direct cost saving — it is an **availability and correctness** gap, and it makes every deploy riskier than necessary. Cleaner, faster restarts also reduce crash-loop time.

**Risk:** Low. `server.close()` + `pool.end()` + a bounded timeout is a standard pattern. The one subtlety is making sure the process still exits if a connection refuses to close.

**Railway effect:** indirect (fewer dropped requests, faster restarts).

**Recommended fix** — capture the server from `app.listen()`, then on `SIGTERM`/`SIGINT`: stop accepting, close the server, `pool.end()`, and exit 0, with a hard timeout so the process cannot hang.

**Verification:** `SIGTERM` the server; confirm a clean shutdown log, a closed pool, and exit code 0 within the timeout.

---

### P4 — `bcryptjs` at 12 rounds is 255 ms of CPU per login

**Files / lines**
- `mart-backend/src/controllers/index.ts:348` — `bcrypt.compare` on admin login
- `mart-backend/src/controllers/index.ts:455, 458` — password change (compare + hash)
- `mart-backend/src/controllers/index.ts:1507, 1543` — `bcrypt.hash(password, 12)` on user creation
- `mart-backend/src/services/team.service.ts:102` — `bcrypt.hash(data.password, 12)`

**Root cause and evidence**

Measured on this machine (fast M-series; a shared Railway vCPU is roughly 2–3× slower):

| Rounds | hash | compare |
|---|---|---|
| 8 | 38 ms | 17 ms |
| 10 | 65 ms | 64 ms |
| **12 (current)** | **258 ms** | **255 ms** |

`bcryptjs` is the pure-JS implementation; native `bcrypt` is 2–4× faster at the same cost factor.

Two things make this worth attention:

1. **The rate limiter allows 5 admin-login attempts per IP per 15 minutes** (`app.ts:124-134`). At ~700 ms CPU per attempt on Railway hardware that is ~8 minutes of CPU per day *per attacking IP* — a cheap CPU-burn vector.
2. `adminLogin` correctly short-circuits the compare when the username does not exist (`!admin || !(await bcrypt.compare(...))`), so unknown usernames cost **no** CPU. Good — no timing-oracle or CPU-amplification issue there.

**Impact:** CPU, and only on the admin-auth path. Legitimate logins are a handful per day, so steady-state cost is negligible. This matters mainly if login attempts are being brute-forced.

**Risk:** **Medium — this is a security parameter.** 12 rounds is a deliberate hardening choice; OWASP treats lower factors as weaker. Dropping to 10 (still accepted) is a 4× CPU reduction; 8 is 7×.

**Railway effect:** CPU.

> **Open question 2: do you want the bcrypt rounds reduced?** Cost and security pull in opposite directions here, and this sits squarely in the "do not change authentication without approval" category. My recommendation is to **leave it at 12** unless login attempts are actually being brute-forced — in which case the correct fix is tightening the limiter, not weakening the hash. The alternative that buys CPU without the security trade is the native `bcrypt` package, which is a new dependency and needs its own approval.

---

### P5 — Outbound HTTP calls have no timeout

**Files / lines**
- `mart-backend/src/controllers/index.ts:169` — Nominatim reverse-geocode
- `mart-backend/src/controllers/index.ts:1734` — Supabase Storage upload
- `mart-backend/src/controllers/index.ts:1936` — Supabase Storage upload
- `mart-backend/src/services/customerAuth.service.ts:52` — 2Factor SMS (OTP delivery)

**Root cause and evidence**

Node's global `fetch` (undici) defaults to `headersTimeout`/`bodyTimeout` of **300 s (5 minutes)** — not infinite, but five minutes is a long time to hold an HTTP request open, a socket, and (inside a transaction) a pool connection. Nominatim is a free public service with no SLA, and 2Factor is on the critical path of customer login.

**Impact:** adverse conditions only — not a steady-state cost, but it is the one path that can exhaust the pool and pin sockets.

**Risk:** Low, with one caveat: the 2Factor call sits on the critical path of customer authentication, so its timeout must be generous enough (8–10 s) and the existing `badGateway` handling must keep returning a clean error.

**Railway effect:** RAM/socket usage under load; not a steady-state cost.

**Recommended fix:** `AbortSignal.timeout(8000)` on the geocode and storage calls, `AbortSignal.timeout(10000)` on the OTP call.

**Verification:** point each call at a host that never responds and confirm the request fails within the timeout rather than hanging.

---

### P6 — PG pool ceiling of 10 is generous for this traffic

**Files / lines**
- `mart-backend/src/database/db.ts:13-19` — `max: 10`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 10000`

**Root cause and evidence**

The configuration is otherwise **correct**:

- `idleTimeoutMillis: 30000` means idle connections close after 30 s, so in steady state the pool holds 1–2 connections, not 10. `max` is a ceiling, not a steady-state value.
- `query()` (`db.ts:21-29`) and `transaction()` (`db.ts:31-44`) both call `client.release()` inside a `finally` — **no leaks**.
- There is exactly **one** `new Pool` in the codebase (`db.ts:13`) — no accidental duplicate pools.

What remains is that `max: 10` permits 10 simultaneous connections to Supabase on a burst, and Supabase's pooler has its own connection ceiling. Exceeding it is a real failure mode, and each open connection holds memory in both the process and the database.

**Impact:** lower peak connection count and slightly less process RAM. At 20–25 orders/day this is a robustness improvement more than a cost one.

**Risk:** Low. 5 is ample at this traffic volume. The one plausible concurrency spike is a push-notification fan-out, which should be checked before settling on 5.

**Railway effect:** DB connections, a little RAM. Not a direct Railway charge.

**Recommended fix:** `max: 5`.
**Verification:** place a burst of concurrent requests and confirm no pool-exhaustion error; confirm `pool.waitingCount` stays at 0.

---

### P7 — `morgan('combined')` logs every request to Railway's log store

**Files / lines**
- `mart-backend/src/app.ts:197-199` — `app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));`

**Root cause and evidence**

`combined` is the most verbose format: remote user, method, URL, referrer, user-agent, response time, bytes. Railway meters **log storage** as a separate charge. The `/health` endpoint is explicitly skipped by the rate limiter (`app.ts:78`) but **not** by the logger.

The PWA fetches the catalogue with `Cache-Control: no-store` (`controllers/index.ts:94`), so every customer app open produces several log lines, and the hub polls every 15–30 s while an admin tab is open.

**Impact:** log volume, plus a small per-request CPU cost.

**Risk:** Low. A shorter format (`short`/`tiny`) still carries method, path, status and duration. I would **not** silence `/health` outright — health-check traffic is useful when diagnosing an incident; I would only use a more compact format.

**Railway effect:** log storage (a direct charge) + a little CPU.

---

### P8 — Sentry traces sample 10% of requests

**Files / lines**
- `mart-backend/src/app.ts:22` — `tracesSampleRate: 0.1`

**Root cause and evidence**

Tracing is the most expensive Sentry feature: 10% of requests generate a full span. **Error reporting is unaffected — errors are still captured at 100%.** Only performance tracing is sampled.

**Impact:** CPU per traced request. Sentry bills on its own (free) tier, so this is a Railway CPU cost, not a Sentry cost.

**Risk:** Low. `tracesSampleRate: 0` keeps error reporting and removes tracing; `0.02` keeps a trickle.

**Railway effect:** CPU.

---

### P9 — Admin auth costs two DB round trips per request

**Files / lines**
- `mart-backend/src/middleware/index.ts:81-84` — session lookup
- `mart-backend/src/middleware/index.ts:89` — `StoreSubscriptionService.adminHasActiveSubscription(...)`

**Root cause and evidence**

Every authenticated admin request runs two queries before the handler executes. The hub polls every 15–30 s, so this is the backend's main steady query source. A single JOIN would halve it.

**Impact:** DB queries, not Railway CPU.

**Risk:** **Medium** — it touches authorisation. The two checks have different failure semantics (401 "session expired" vs 403 "subscription inactive") that must be preserved exactly, along with the fail-closed role logic at `middleware/index.ts:72-80`.

**Railway effect:** negligible.

---

### P10 — `getProducts` returns the whole catalogue with no pagination

**Files / lines**
- `mart-backend/src/controllers/index.ts:83-96` — the public catalogue endpoint
- `mart-backend/src/services/product.service.ts` — `findAll` has no `LIMIT`

**Root cause and evidence**

75 products in dev, so this is not a problem today, but the response is unbounded and is served with `Cache-Control: no-store`, so it is re-fetched on every app open.

**Impact:** negligible today; grows with the catalogue.

**Risk:** Adding a `LIMIT` is an **API contract change** — the storefront expects the full list and would need a matching client change. **Not recommended now.**

**Related, also not recommended:** adding edge caching to the catalogue. It carries price and stock, and caching inventory data is explicitly out of bounds.

---

## Part 3 — What was checked and found healthy

Recorded so it is clear these were examined rather than missed.

| Area | Result |
|---|---|
| **Background activity** | One `setInterval` in the whole backend (`controllers/index.ts:685`, SSE keepalive), cleared on `close` (`:690`). No cron, no polling, no retry loops, no reconciliation timers. The 3-minute catalogue poll is **client-side** in the PWA, not on the server. |
| **Connection leaks** | `client.release()` in a `finally` in both `query()` and `transaction()` (`db.ts:26-28`, `41-43`). No leaks. |
| **Duplicate pools** | One `new Pool` in the codebase (`db.ts:13`). |
| **Indexes** | 35 indexes across the hot tables — `mart_orders` 14, `mart_funnel_sessions` 8, `mart_admin_sessions` 4, `mart_products` 2, `mart_customer_leads` 2, `mart_store_products` 3, `mart_funnel_events` 3, `mart_otps` 1. The funnel range queries on `first_seen_at` are covered by the `channel_seen` / `platform_seen` / `source_seen` composites. **No index recommendation is warranted** at this data volume. |
| **Rate limiting** | 8 limiters: general API, OTP send (IP + per-phone), OTP verify, admin login (IP + username), guest cancel, token tracking, guest push, order placement, geocode. `express-rate-limit` 7.5.1 uses a `MemoryStore` that unrefs its cleanup interval, so it does not keep the event loop alive. |
| **HTTP server timeouts** | Node 20 defaults are sane: `requestTimeout` 300 s, `headersTimeout` 60 s, `keepAliveTimeout` 5 s. No change needed. |
| **In-memory growth** | No unbounded arrays/maps/caches in the backend. |
| **SSE listener cleanup** | `controllers/index.ts:688-693` removes the listener on `close`. `orderEventBus` uses `setMaxListeners(0)`; leaks are bounded by the number of admin tabs. |
| **Password compare on unknown user** | `adminLogin` short-circuits before `bcrypt.compare` when the username does not exist — no CPU cost and no timing oracle. |
| **Duplicate work per request** | None found beyond P9. |

---

## Part 4 — Railway billing: what is and is not reducible

| Cost | Nature | Can code reduce it? |
|---|---|---|
| **RAM** | Billed per GB-hour for as long as the service runs | **Yes — this is the lever.** −27.8 MB (−31%) is available from P1 + P2. A floor remains, because the API must stay available. |
| **CPU** | Billed per CPU-second actually used | **Partly.** bcrypt (P4) and Sentry tracing (P8) are the only meaningful consumers. At this traffic volume, CPU is a rounding error. |
| **Network egress** | Per GB | Only via caching the catalogue — **not recommended** (P10). |
| **Log storage** | Per GB retained | **Yes — P7.** `combined` is the most expensive format per line. |
| **Build minutes** | Per build | Build once, not per commit. Not a code concern. |

**What will not go away:** the service must run 24/7 to serve orders, so a RAM floor remains. Sleep / serverless mode is deliberately **not** proposed — a sleeping order API means a customer opening the app during a wake-up window can see a failed order.

**No monthly figure is quoted here.** The percentages above are measured. Converting them to money requires actual Railway usage numbers (RAM-hours, CPU-seconds, log GB), which are not visible from the repository. With a Railway usage export for a typical month, these measured deltas can be turned into a defensible figure.

---

## Part 5 — Method (reproducible)

**Boot RSS** — the real built server, measured as resident memory of the running process:

```bash
cd mart-backend
npm run build
PORT=3999 NODE_ENV=development node dist/index.js &
PID=$!
sleep 14
ps -o rss= -p $PID | awk '{printf "%.1f MB\n", $1/1024}'
kill $PID
```

Each variant was produced by patching the source, rebuilding, and re-measuring with the identical procedure; the sources were then restored and `git diff` confirmed clean.

**bcrypt** — `bcryptjs` 2.4.3, wall-clock around `hash` and `compare` at rounds 8/10/12.

**Caveats**
- RSS was measured in development mode, so it excludes the Sentry *transport* (only initialised with a DSN in production). The *import* cost — the finding — is included, because the import is unconditional.
- Absolute RSS on Railway will differ from these numbers. The **deltas** are the meaningful figure.
- The bcrypt figures are from a fast local CPU; a shared Railway vCPU is roughly 2–3× slower.

---

## Part 6 — Files that would change

| File | Change | Priority |
|---|---|---|
| `mart-backend/src/app.ts` | Lazy-load Sentry; `tracesSampleRate`; morgan format | P1, P7, P8 |
| `mart-backend/src/controllers/index.ts` | Lazy-load `sharp`; add fetch timeouts | P2, P5 |
| `mart-backend/src/index.ts` | Graceful shutdown | P3 |
| `mart-backend/src/database/db.ts` | Pool `max` 10 → 5 | P6 |
| `mart-backend/src/services/customerAuth.service.ts` | Fetch timeout on the OTP call | P5 |
| `mart-backend/src/middleware/index.ts` | *Optional:* combine the two auth queries | P9 |

No schema changes. No new dependencies. No API contract changes. No changes to order, checkout, payment, inventory or delivery logic.

---

## Part 7 — Tests and verification

For each approved change:

1. **`tsc --noEmit`** on `mart-backend` (currently clean).
2. **`node --import tsx --test tests/*.test.ts`** — currently **308 tests, 279 pass, 29 fail**. Those 29 are **pre-existing** failures that need a live DB/server; they were verified unchanged by stashing all work in progress. They are neither caused by nor may be hidden by these changes.
3. **New test** — a boot test asserting the API still starts and serves `/api/v1/health` with Sentry and `sharp` lazily loaded. This is what stops a future eager import silently re-adding the 27 MB.
4. **New test** — asserting `Sentry.init` is not called without a DSN and *is* called with one.
5. **Manual** — upload a product image (exercises the `sharp` lazy path end to end) and confirm the emitted WebP matches today's.
6. **Manual** — `SIGTERM` the server and confirm a clean shutdown, a closed pool, and exit code 0 within the timeout.
7. **Before/after RSS** using the Part 5 procedure, so the saving is verified rather than assumed.

---

## Part 8 — Deployment and rollback

**Deploy** — one Railway deploy; the backend has no schema change and no contract change. It is still worth splitting in two:

- **Deploy 1 (zero behavioural risk):** P2 (`sharp` lazy), P3 (graceful shutdown), P6 (pool `max`), P7 (log format), P8 (traces). None of these change a response, a status code, or a payload.
- **Deploy 2 (needs the Sentry answer):** P1. If `SENTRY_DSN` is unset, this is a deletion with no risk. If set, it moves the import off the boot path and needs a Sentry error check after deploy.

**Rollback** — `git revert` the commit(s) and redeploy. A standard Railway deploy with no data migration to undo. The graceful-shutdown change is the only one worth staging on its own, since it is the only change that alters process lifecycle.

**Post-deploy verification**

```bash
# RAM, from inside the container
ps -o rss= -p 1        # expect ~62 MB, down from ~90 MB

# Health
curl -fsS https://<api-domain>/api/v1/health

# Deploy log shows a clean start, and Sentry still receives errors
```

---

## Part 9 — Open questions

1. **Is `SENTRY_DSN` set on the Railway service?** It decides whether P1 is a ~16 MB saving or a no-op.
2. **Do you want the bcrypt rounds reduced?** It is the one finding where cost and security pull in opposite directions, and it sits in the "do not change authentication without approval" category. Recommendation: leave it at 12 unless login attempts are actually being brute-forced — in which case tighten the limiter rather than weaken the hash.
