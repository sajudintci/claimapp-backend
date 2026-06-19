# syntax=docker/dockerfile:1
# Build from backend/:
#   cd backend && docker build -t claimora-backend .
#
# Requires PostgreSQL + Redis at runtime (env vars). Mount storage for uploads.

FROM node:20-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
ENV NODE_ENV=development
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
RUN node -e "const fs=require('fs');const p='package-lock.json';if(!fs.existsSync(p)||fs.statSync(p).size<1000)throw new Error('package-lock.json missing — commit and push');JSON.parse(fs.readFileSync(p,'utf8'));" \
  && npm install --no-audit --no-fund

FROM base AS builder
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json register-paths.cjs ./
COPY src ./src

RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PORT=4000
ENV STORAGE_PATH=/app/storage
ENV STORAGE_DRIVER=s3
ENV LOG_DIR=/app/storage/logs

RUN groupadd --system --gid 1001 app \
  && useradd --system --uid 1001 --gid app app

COPY package.json register-paths.cjs ./
COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist

RUN npm prune --omit=dev

RUN mkdir -p storage/logs \
  && chown -R app:app storage

USER app
EXPOSE 4000
VOLUME ["/app/storage"]

CMD ["npm", "run", "start"]
