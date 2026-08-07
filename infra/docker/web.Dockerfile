# ---------------------------------------------------------------------------
# Production image for @leen-mart/customer-pwa.
#
# Build from the repository root:
#   docker build -f infra/docker/web.Dockerfile -t leenmart/web:local .
#
# In the target architecture the PWA is served by Cloudflare from object
# storage; this image exists for parity testing and for environments that need
# a container.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY packages packages
COPY apps/customer-pwa apps/customer-pwa
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @leen-mart/customer-pwa...
RUN pnpm --filter @leen-mart/customer-pwa... build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/customer-pwa/dist /usr/share/nginx/html
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
