FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/hello-world/package.json apps/hello-world/
COPY shared/hello-world/package.json shared/hello-world/
RUN pnpm install --frozen-lockfile

# Build shared packages
FROM deps AS shared-build
COPY shared/ shared/
COPY tsconfig.base.json ./
RUN pnpm --filter @agent-core/hello-world build

# Bundle the app
FROM deps AS app-build
COPY --from=shared-build /app/shared/ shared/
COPY --from=shared-build /app/node_modules/ node_modules/
COPY tsconfig.base.json ./
COPY apps/hello-world/ apps/hello-world/
RUN pnpm --filter @agent-core/hello-world-app build

# Production image
FROM base AS runner
WORKDIR /app
COPY --from=deps /app/node_modules/ node_modules/
COPY --from=deps /app/apps/hello-world/node_modules/ apps/hello-world/node_modules/
COPY --from=app-build /app/apps/hello-world/dist/ apps/hello-world/dist/
COPY apps/hello-world/package.json apps/hello-world/

WORKDIR /app/apps/hello-world
CMD ["node", "dist/index.mjs"]
