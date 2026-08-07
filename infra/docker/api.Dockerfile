# ---------------------------------------------------------------------------
# Production image for @leen-mart/api.
#
# Build from the repository root:
#   docker build -f infra/docker/api.Dockerfile -t leenmart/api:local .
#
# Multi-stage so the runtime image carries no compiler, no dev dependencies and
# no source. Runs as a non-root user (SDD 23.1, A05).
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# ---------- dependencies ----------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/domain-kit/package.json packages/domain-kit/
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @leen-mart/api...

# ---------- build ----------
FROM deps AS build
COPY tsconfig.base.json turbo.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @leen-mart/api... exec prisma generate --schema apps/api/prisma/schema.prisma \
 || pnpm --filter @leen-mart/api exec prisma generate
RUN pnpm --filter @leen-mart/api... build
RUN pnpm deploy --filter @leen-mart/api --prod --legacy /app/deploy

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# OpenSSL is required by the Prisma query engine on Debian slim images.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=build --chown=node:node /app/deploy ./
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/prisma ./prisma

USER node
EXPOSE 4000

# Liveness only. Readiness is checked by the load balancer against /readyz,
# because a dependency blip must drain traffic, not restart the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
