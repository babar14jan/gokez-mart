# Build context must be the repository root:
#   docker build -f deploy/hostinger/Dockerfile .
FROM node:20-slim AS build
WORKDIR /app

# Install all workspaces so the monorepo resolves its dependencies.
COPY package.json package-lock.json ./
COPY mart-backend/package.json mart-backend/
COPY mart-user/package.json mart-user/
COPY mart-hub/package.json mart-hub/
RUN npm ci

# Compile the API and copy its SQL migrations into dist/.
COPY mart-backend ./mart-backend
RUN npm run build --workspace=mart-backend \
    && test -f mart-backend/dist/index.js \
    && test "$(ls mart-backend/dist/database/migrations | wc -l)" -gt 0

# Runtime image: production dependencies only.
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY mart-backend/package.json mart-backend/
COPY mart-user/package.json mart-user/
COPY mart-hub/package.json mart-hub/
RUN npm ci --omit=dev

COPY --from=build /app/mart-backend/dist ./mart-backend/dist

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "--workspace=mart-backend"]
