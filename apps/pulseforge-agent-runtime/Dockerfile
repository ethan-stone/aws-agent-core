FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/pulseforge-agent-runtime/package.json apps/pulseforge-agent-runtime/
COPY shared/pulseforge-agent/package.json shared/pulseforge-agent/
COPY shared/pulseforge-tools/package.json shared/pulseforge-tools/
RUN pnpm install --frozen-lockfile

# Local development image
FROM deps AS dev
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY apps/pulseforge-agent-runtime/ apps/pulseforge-agent-runtime/

WORKDIR /app/apps/pulseforge-agent-runtime
CMD ["node", "--import", "tsx", "src/index.ts"]

# Build shared packages
FROM deps AS shared-build
COPY shared/ shared/
COPY tsconfig.base.json ./
RUN pnpm --filter @agent-core/pulseforge-agent build
RUN pnpm --filter @agent-core/pulseforge-tools build

# Bundle the app
FROM deps AS app-build
COPY --from=shared-build /app/shared/ shared/
COPY --from=shared-build /app/node_modules/ node_modules/
COPY tsconfig.base.json ./
COPY apps/pulseforge-agent-runtime/ apps/pulseforge-agent-runtime/
RUN pnpm --filter @agent-core/pulseforge-agent-runtime build

# Production image
FROM base AS runner
WORKDIR /app
COPY --from=deps /app/node_modules/ node_modules/
COPY --from=deps /app/apps/pulseforge-agent-runtime/node_modules/ apps/pulseforge-agent-runtime/node_modules/
COPY --from=shared-build /app/shared/pulseforge-tools/package.json shared/pulseforge-tools/
COPY --from=shared-build /app/shared/pulseforge-tools/dist/ shared/pulseforge-tools/dist/
COPY --from=app-build /app/apps/pulseforge-agent-runtime/dist/ apps/pulseforge-agent-runtime/dist/
COPY apps/pulseforge-agent-runtime/package.json apps/pulseforge-agent-runtime/

WORKDIR /app/apps/pulseforge-agent-runtime
CMD ["node", "--require", "@aws/aws-distro-opentelemetry-node-autoinstrumentation/register", "dist/index.mjs"]
