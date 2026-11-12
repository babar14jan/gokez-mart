# Deploying the Gokez Mart API on a Hostinger VPS

This guide moves the API from Render to a Hostinger VPS. The database stays on
Supabase for the first cutover; only the API process moves. The image storage
service (`storage-service/`) is deployed on the same VPS using its own
`docker-compose.yml`.

The code is platform-agnostic: it reads `PORT`, runs migrations at boot, and
drains on `SIGTERM`. Nothing in `mart-backend` is Render-specific.

## 0. Prerequisites

- A Hostinger VPS (Ubuntu 22.04/24.04 recommended) with a public IP.
- A domain record for `api.mart.gokez.com` that you can repoint.
- Node 20 installed, or Docker + Docker Compose.
- The existing Supabase `DATABASE_URL`, JWT secret, CORS origins and 2Factor key.
- The storage service already planned per `docs/HOSTINGER_STORAGE.md`.

## 1. Point the domain at the VPS (after the API is live)

Keep `api.mart.gokez.com` on Render until the VPS answers. Then repoint:

| Type | Name | Value | Proxy |
| --- | --- | --- | --- |
| `A` | `api.mart` | `<VPS public IP>` | DNS only |

Use an `A` record (not a CNAME) because the target is an IP. Keep the proxy
grey (DNS only) so TLS terminates on nginx.

## 2. Prepare the VPS

```bash
# As root
apt update && apt upgrade -y
apt install -y git curl nginx ufw

# Node 20 (skip if using Docker only)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Docker (recommended path)
curl -fsSL https://get.docker.com | sh

# Firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

Create an unprivileged user and directories:

```bash
useradd -m -s /bin/bash gokez
mkdir -p /opt/gokez-mart-backend /opt/gokez-mart /etc/gokez
chown gokez:gokez /opt/gokez-mart-backend /opt/gokez-mart
```

## 3. Deploy the storage service first

```bash
# As gokez
git clone https://github.com/babar14jan/gokez-mart.git /opt/gokez-mart-backend
cd /opt/gokez-mart-backend/storage-service
cp .env.example .env
# edit .env (STORAGE_API_KEY, PUBLIC_BASE_URL=https://images.gokez.com, ...)
docker compose up -d --build
```

Install nginx for images using `storage-service/nginx/images.conf` and obtain a
TLS certificate for `images.gokez.com` (certbot). Verify:

```bash
curl https://images.gokez.com/api/v1/health
```

## 3.1 Docker networking for storage access

The API container cannot use `127.0.0.1:8080` to reach the storage service,
because localhost inside a container refers to that container. The API
container is attached to the existing storage Docker network and reaches it
as `http://gokez-storage:8080`. Do not publish the storage port publicly.

Before deployment, verify the network name:

```bash
docker inspect gokez-storage --format '{{json .NetworkSettings.Networks}}'
docker network ls
```

If the discovered network differs from `storage-service_default`, update
`deploy/hostinger/docker-compose.yml` accordingly.

## 4. Configure the API environment

```bash
cp /opt/gokez-mart-backend/deploy/hostinger/.env.example /opt/gokez-mart-backend/.env
# edit /opt/gokez-mart-backend/.env
chmod 600 /opt/gokez-mart-backend/.env
```

Important values:
- `NODE_ENV=production`
- `PORT=3000`
- `DATABASE_URL` = the same Supabase connection string used on Render
- `MART_JWT_SECRET` = the existing secret (32+ chars)
- `MART_CORS_ORIGIN=https://mart.gokez.com,https://hub.gokez.com`
- `MART_PUBLIC_API_URL=https://api.mart.gokez.com/api/v1`
- `IMAGE_STORAGE_DRIVER=hostinger`
- `HOSTINGER_STORAGE_URL=http://gokez-storage:8080`
- `HOSTINGER_STORAGE_API_KEY` = same key as the storage service
- `TWO_FACTOR_API_KEY` = existing key

Do **not** set `PORT` to anything other than what nginx proxies (3000).

## 5. Build and run the API

### Option A — Docker (recommended)

```bash
cd /opt/gokez-mart-backend
cp /opt/gokez-mart-backend/.env deploy/hostinger/.env
docker compose -f deploy/hostinger/docker-compose.yml up -d --build
```

The container exposes the API on `127.0.0.1:3000` only; nginx is the public
entry point.

### Option B — Node + systemd

```bash
cd /opt/gokez-mart-backend
npm ci
npm run build --workspace=mart-backend
sudo cp deploy/hostinger/gokez-mart-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gokez-mart-api
```

Verify:

```bash
curl http://127.0.0.1:3000/api/v1/health
# {"status":"ok","service":"gokez-mart-api"}
```

## 6. nginx reverse proxy for the API

```bash
sudo cp /opt/gokez-mart-backend/deploy/hostinger/nginx-api.mart.gokez.com.conf \
  /etc/nginx/sites-available/api.mart.gokez.com
sudo ln -s /etc/nginx/sites-available/api.mart.gokez.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Obtain TLS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.mart.gokez.com
```

Certbot rewrites the nginx file with the certificate paths; the shipped config is
the pre-certbot template.

## 7. Verify before cutover

```bash
curl https://api.mart.gokez.com/api/v1/health
```

Check logs for `🛒 Gokez Mart API running on port` and
`✅ Mart migrations complete`. Test customer sign-in, storefront load, and one
image upload from Gokez Hub.

## 8. Cutover

1. Confirm the VPS answers on `https://api.mart.gokez.com`.
2. Repoint DNS `api.mart` to the VPS IP (section 1).
3. Wait for propagation; keep Render running during propagation.
4. Stop the Render service once traffic has moved.

Because the hostname does not change, the web apps need no rebuild and no change
to `VITE_API_URL`.

## 9. Updates / redeploy

```bash
cd /opt/gokez-mart-backend
bash deploy/hostinger/deploy.sh
```

Migrations run automatically at boot under an advisory lock, so overlapping
instances cannot apply the same migration twice.

## 10. Rollback

- DNS: repoint `api.mart` back to Render and restart Render.
- Code/config: set `IMAGE_STORAGE_DRIVER=supabase` and restart the API to revert
  new uploads to Supabase. Existing Hostinger URLs stay readable.
- Database: unchanged throughout; no rollback needed.

## Related files

| File | Purpose |
| --- | --- |
| `deploy/hostinger/Dockerfile` | Container build for the API (monorepo-aware). |
| `deploy/hostinger/docker-compose.yml` | Runs the API on `127.0.0.1:3000`. |
| `deploy/hostinger/.env.example` | Production env template. |
| `deploy/hostinger/gokez-mart-api.service` | systemd unit (non-Docker path). |
| `deploy/hostinger/nginx-api.mart.gokez.com.conf` | nginx reverse proxy template. |
| `deploy/hostinger/deploy.sh` | Pull, build, restart, health check. |
| `storage-service/docker-compose.yml` | Storage service on the same VPS. |
| `docs/HOSTINGER_STORAGE.md` | Image storage driver and folders. |
