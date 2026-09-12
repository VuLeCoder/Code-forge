FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY backend backend
RUN pnpm --filter backend build
RUN pnpm deploy --filter backend --prod /app/release

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install --no-install-recommends -y git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs api \
  && mkdir -p /data/git \
  && chown -R api:nodejs /data/git
WORKDIR /app
COPY --from=builder --chown=api:nodejs /app/release ./
COPY --from=builder --chown=api:nodejs /app/backend/dist ./dist
USER api
EXPOSE 4000
CMD ["node", "dist/main.js"]
