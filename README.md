# PulseForge

`PulseForge` is an AI-assisted IoT fleet operations application built on top of Bedrock AgentCore. The product direction is:

- React/Vite SPA frontend
- Lambda-style REST API backend
- Bedrock AgentCore runtime for agent orchestration
- background remediation worker for automated incident handling

This repo is now in phase 1 of that migration. The demo chat app has been replaced with the first project scaffolds for the frontend, API, and shared domain model.

## Repo Layout

- `apps/webapp/` - React SPA shell for the operator console
- `apps/api/` - Hono-based REST API scaffold with Node local-dev, Lambda production entrypoints, and MongoDB repositories
- `apps/hello-world/` - current Bedrock AgentCore runtime app, to be evolved into the production agent runtime
- `apps/scripts/` - helper scripts for local runtime invocation
- `shared/pulseforge-domain/` - shared domain types and synthetic seed data
- `lib/` - CDK infrastructure

## Phase 1 Status

Implemented:

- shared PulseForge domain entities and demo snapshot data
- API scaffold with initial routes for dashboard, devices, telemetry, incidents, and snapshot
- Hono app shared between the Node adapter for local dev and the Lambda adapter for production
- MongoDB repository layer plus seed script for loading the PulseForge demo dataset
- local API dev runner
- React SPA shell with dashboard, devices, incidents, and copilot routes
- containerized local dev path for the AgentCore runtime

Still pending:

- install frontend dependencies newly added to `apps/webapp/package.json`
- connect the API to a live MongoDB instance through `MONGODB_URI`
- add backend-owned AgentCore invocation service using `InvokeAgentRuntimeCommand`
- add background remediation worker and ticketing pipeline

## Current Commands

Backend and shared packages that compile with the current install:

```bash
pnpm --filter @agent-core/pulseforge-domain exec tsc --noEmit
pnpm --filter @agent-core/api exec tsc --noEmit
```

Phase-1 dev commands:

```bash
pnpm dev:api
pnpm seed:api
pnpm dev:webapp
pnpm docker:hello-world:build
AWS_REGION=us-east-1 AWS_PROFILE=<profile> pnpm docker:hello-world:run
pnpm dev:hello-world:invoke --prompt "hello there"
```

MongoDB-related environment variables for `apps/api`:

```bash
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=pulseforge
```

When `MONGODB_URI` is configured:

- `pnpm seed:api` loads the demo PulseForge dataset into MongoDB
- API reads come from MongoDB collections
- `GET /api/ping` reports `"storage": "mongodb"`

When `MONGODB_URI` is not configured:

- the API falls back to the in-memory demo repository
- `GET /api/ping` reports `"storage": "memory"`

## Important Note

The new SPA and API toolchains have been scaffolded, but the repo does not yet have the required newly-added packages installed in `node_modules`. Until you run a workspace install, `pnpm dev:webapp`, `pnpm dev:api`, and package-level type checks that rely on `vite`, `hono`, `@hono/node-server`, or `mongodb` will fail.

## Near-Term Implementation Plan

1. Install and verify the SPA toolchain.
2. Provision MongoDB Atlas and wire secrets/config through CDK or local env.
3. Replace the current demo runtime framing in `apps/hello-world` with the PulseForge agent runtime.
4. Add backend-owned AgentCore invocation.
5. Add incident investigation and copilot workflows.
6. Add autonomous remediation and ticket creation.
