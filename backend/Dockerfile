FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update \
  && apt-get install --no-install-recommends -y openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY backend backend
RUN pnpm --filter backend prisma:generate
RUN pnpm --filter backend build
RUN pnpm deploy --filter backend --prod /app/release

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install --no-install-recommends -y git ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs api \
  && mkdir -p /data/git \
  && chown -R api:nodejs /data/git
WORKDIR /app
COPY --from=builder --chown=api:nodejs /app/release ./
COPY --from=builder --chown=api:nodejs /app/backend/dist ./dist
COPY --from=builder --chown=api:nodejs /app/backend/prisma ./prisma
USER api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "const port=process.env.PORT||'4000'; const prefix=(process.env.API_PREFIX||'api/v1').replace(/^\\/+|\\/+$/g,''); fetch('http://127.0.0.1:'+port+'/'+prefix+'/health/live').then(response=>{if(!response.ok) process.exit(1); response.body?.cancel(); process.exit(0)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
