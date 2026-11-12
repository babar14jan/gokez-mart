# Hostinger backend environment variable mapping

Render and the current source code already use the same variable names. The
Hostinger deployment keeps those names unchanged; only their values and the
runtime context change.

| Source variable | Required on Hostinger | Notes |
| --- | --- | --- |
| `NODE_ENV` | Yes | `production` |
| `PORT` | Yes | Set to `3000`; nginx proxies to this port |
| `DATABASE_URL` | Yes | Existing Supabase PostgreSQL URL; unchanged |
| `ALLOW_REMOTE_DATABASE` | No | Local-development guard only |
| `MART_JWT_SECRET` | Yes | Existing secret, 32+ characters |
| `MART_JWT_EXPIRES_IN` | No | Default `90d` |
| `MART_CORS_ORIGIN` | Yes | `https://mart.gokez.com,https://hub.gokez.com` |
| `MART_PUBLIC_API_URL` | Yes for promotions | `https://api.mart.gokez.com/api/v1` |
| `MART_CUSTOMER_APP_URL` | Optional | Defaults to first CORS origin |
| `MART_STORAGE_PUBLIC_BASE_URL` | Removed | No longer read; legacy Supabase public URL is constructed directly |
| `SUPABASE_URL` | For legacy uploads/rollback | Existing value |
| `SUPABASE_SERVICE_ROLE_KEY` | For legacy uploads/rollback | Existing value |
| `SUPABASE_BUCKET` | Removed | No longer read from env; legacy Supabase bucket is fixed to `mart-products` in code |
| `IMAGE_STORAGE_DRIVER` | Yes | `hostinger` |
| `HOSTINGER_STORAGE_URL` | Yes | `http://gokez-storage:8080` on the VPS (container-to-container), not `127.0.0.1` |
| `HOSTINGER_STORAGE_API_KEY` | Yes | Same key as storage service |
| `HOSTINGER_STORAGE_PROJECT_ID` | No | Default `gokez-mart` |
| `TWO_FACTOR_API_KEY` | Yes | Existing key |
| `VAPID_PUBLIC_KEY` | Optional | Web Push |
| `VAPID_PRIVATE_KEY` | Optional | Web Push |
| `VAPID_SUBJECT` | Optional | Default `mailto:support@gokez.com` |
| `SENTRY_DSN` | Optional | Error reporting |
| `NOMINATIM_BASE_URL` | Optional | Reverse geocoding |
| `NOMINATIM_USER_AGENT` | Optional | Reverse geocoding |
| `MART_BACKGROUND_JOBS_ENABLED` | No | New flag; defaults to `true`. Set `false` on an overlapping instance to avoid duplicate recurring jobs |
| `MART_ADMIN_USERNAME` | Not read | Present in sample env only; not used by backend |
| `MART_ADMIN_PASSWORD` | Not read | Present in sample env only; not used by backend |

No variable is renamed. `PORT` is the only value whose handling changes: Render
injects it, while Hostinger sets it explicitly to `3000`.
