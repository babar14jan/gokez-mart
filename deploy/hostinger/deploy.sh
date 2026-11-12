#!/usr/bin/env bash
# Deploy the Gokez Mart API on a Hostinger VPS.
# Run from the repository root on the VPS.
set -euo pipefail

echo "==> Pulling latest code"
git pull --ff-only

echo "==> Installing dependencies"
npm ci

echo "==> Building backend"
npm run build --workspace=mart-backend
test -f mart-backend/dist/index.js

echo "==> Restarting service"
if command -v docker >/dev/null 2>&1 && [ -f deploy/hostinger/docker-compose.yml ]; then
  docker compose -f deploy/hostinger/docker-compose.yml up -d --build
else
  sudo systemctl restart gokez-mart-api
fi

echo "==> Health check"
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1; then
    echo "API is healthy"
    exit 0
  fi
  sleep 2
done
echo "API did not become healthy" >&2
exit 1
