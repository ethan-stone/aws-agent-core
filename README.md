# PulseForge

`PulseForge` is an AI-assisted IoT fleet operations application built on top of Bedrock AgentCore. The product direction is:

- React/Vite SPA frontend
- Lambda-style web backend
- Bedrock AgentCore runtime for agent orchestration
- background remediation worker for automated incident handling

This repo is now in phase 1 of that migration. The demo chat app has been replaced with the first project scaffolds for the frontend, web backend, and shared domain model.

## Repo Layout

- `apps/webapp/` - React SPA shell for the operator console
- `apps/webbackend/` - Hono-based web backend with Node local-dev, Lambda production entrypoints, and MongoDB repositories
- `apps/pulseforge-agent-runtime/` - PulseForge Bedrock AgentCore runtime app for copilot and incident investigation workflows
- `shared/pulseforge-domain/` - shared domain types and synthetic seed data
- `lib/` - CDK infrastructure

## Phase 1 Status

Implemented:

- shared PulseForge domain entities and demo snapshot data
- web backend scaffold with initial routes for dashboard, devices, telemetry, incidents, and snapshot
- Hono app shared between the Node adapter for local dev and the Lambda adapter for production
- MongoDB repository layer plus seed script for loading the PulseForge demo dataset
- local web backend dev runner
- React SPA shell with dashboard, devices, incidents, and copilot routes

Still pending:

- connect the web backend to a live MongoDB instance through `MONGODB_URI`
- add background remediation worker and ticketing pipeline

## Current Commands

Backend and shared packages that compile with the current install:

```bash
pnpm --filter @agent-core/pulseforge-domain exec tsc --noEmit
pnpm --filter @agent-core/webbackend exec tsc --noEmit
```

Recommended local dev commands:

```bash
pnpm mongodb:dev
pnpm webbackend:seed:local
pnpm webbackend:dev:local
pnpm webapp:dev:local
```

Notes:

- `pnpm mongodb:dev` runs MongoDB in the foreground with visible logs using `docker compose`
- `pnpm webbackend:seed:local` seeds the local MongoDB database with PulseForge demo data
- `pnpm webbackend:dev:local` runs the web backend against a deployed AgentCore runtime using the AWS SDK
- `pnpm webapp:dev:local` runs the SPA pointed at `http://localhost:3000`

Before running those commands, create local env files from the checked-in examples:

```bash
cp .env.example .env.local
cp apps/webbackend/.env.example apps/webbackend/.env.local
cp apps/pulseforge-agent-runtime/.env.example apps/pulseforge-agent-runtime/.env.local
cp apps/webapp/.env.example apps/webapp/.env.local
```

Then edit the `.env.local` files with your real values:

- `.env.local`
  - shared defaults such as `AWS_PROFILE`
- `apps/webbackend/.env.local`
  - MongoDB settings
  - Cognito user pool and client ids
  - deployed runtime ARN and qualifier
- `apps/pulseforge-agent-runtime/.env.local`
- optional settings for local runtime development and AgentCore Memory integration
- `apps/webapp/.env.local`
  - web backend base URL for the SPA

The AgentCore runtime itself is deployed infrastructure in the current workflow, so `apps/pulseforge-agent-runtime/.env.local` is only needed when you are running the runtime directly for manual development or memory integration testing.

The normal local path no longer relies on bash wrappers for the web backend or webapp:

- the web backend reads `.env.local` from the repo root and `apps/webbackend/.env.local` at startup
- the webapp uses Vite's built-in `.env.local` loading from `apps/webapp`
- MongoDB runs through `docker compose` so you can see container logs directly

## App Authentication

PulseForge now has an app-level Cognito auth layer that uses Cognito for app sign-in, while the AgentCore runtime itself uses IAM auth for invocation.

What is wired:

- `apps/webapp` loads auth config from `GET /api/auth/config`
- when Cognito env vars are present, the SPA requires sign-in before entering the app
- the SPA uses Cognito sign-up, sign-in, and confirmation APIs
- the web backend verifies Cognito access tokens and protects `/api/*` routes except:
  - `/api/ping`
  - `/api/auth/config`
- the stack creates one public app client on the shared user pool for the PulseForge SPA
- the stack creates a separate `pulseforge-backend` Cognito resource server and tools client for delegated agent calls
- the backend invokes the AgentCore runtime with IAM via `InvokeAgentRuntimeCommand`
- the backend supplies `runtimeUserId`; the browser never calls the runtime directly

Web backend env vars for app auth:

```bash
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
COGNITO_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_REGION=us-east-1
```

Tool endpoint env vars for delegated agent auth:

```bash
COGNITO_TOOLS_CLIENT_IDS=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_RESOURCE_SERVER_IDENTIFIER=pulseforge-backend
```

When those are omitted:

- auth is disabled
- the SPA allows entry without login
- the web backend skips token verification

Agent-facing tool routes live under `/tools/*`. They are intentionally separate
from the browser-oriented `/api/*` routes:

- `/tools/*` requires a Cognito access token issued to the tools client, not the web app client
- every `/tools/*` request must include `x-pulseforge-agent-run-id`
- each operation checks `pulseforge-backend/*` scopes such as `read:incidents`, `read:telemetry`, and `write:tickets`
- reads and writes are persisted to `audit_logs` with `actorType`, `actorId`, `onBehalfOfUserId`, `agentRunId`, route, scopes, and outcome
- records created by the agent also store `createdBy` attribution

CDK outputs for app auth:

- `PulseForgeUserPoolId`
- `PulseForgeUserPoolClientId`
- `PulseForgeUserPoolDomain`
- `PulseForgeToolsUserPoolClientId`
- `PulseForgeBackendResourceServerIdentifier`

Local flow after deployment:

1. deploy the stack and capture `PulseForgeUserPoolId` and `PulseForgeUserPoolClientId`
2. place those values into `apps/webbackend/.env.local`
3. place your deployed runtime ARN and qualifier into `apps/webbackend/.env.local`
4. start local Mongo
5. run the web backend
6. run the SPA
7. use `/signup`, then `/confirm-signup`, then `/login`

MongoDB-related environment variables for `apps/webbackend`:

```bash
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=pulseforge
```

When `MONGODB_URI` is configured:

- `pnpm seed:webbackend` loads the demo PulseForge dataset into MongoDB
- web backend reads come from MongoDB collections
- `GET /api/ping` reports `"storage": "mongodb"`

When `MONGODB_URI` is not configured:

- the web backend falls back to the in-memory demo repository
- `GET /api/ping` reports `"storage": "memory"`

Agent invocation settings for `apps/webbackend`:

```bash
AGENT_RUNTIME_ARN=arn:aws:bedrock-agentcore:...
AGENT_RUNTIME_QUALIFIER=DEFAULT
```

- `AGENT_RUNTIME_ARN` and `AGENT_RUNTIME_QUALIFIER` are required for the local web backend workflow
- the deployed runtime should be configured with IAM auth, not Cognito/JWT inbound auth

Optional local runtime memory settings in `apps/pulseforge-agent-runtime/.env.local`:

```bash
MEMORY_ID=memory-xxxxxxxxxxxxxxxx
ENABLE_AGENTCORE_LONG_TERM_MEMORY=true
AGENTCORE_MEMORY_CONTEXT_TAG=agentcore-memory-context
```

- when `MEMORY_ID` is set, the runtime uses AgentCore Memory for short-term session persistence
- when `ENABLE_AGENTCORE_LONG_TERM_MEMORY=true`, the runtime also retrieves long-term memories from the configured namespaces before the model call
- the runtime expects the backend to pass the authenticated user id through the invocation payload, and uses that as `actorId` for AgentCore Memory namespaces

Runtime memory architecture:

- short-term memory uses AgentCore Memory Events as the canonical session store
- long-term memory uses a separate runtime plugin that retrieves memory records from configured namespaces and injects them into the current user turn before the model call
- conversation management remains independent, so the runtime persists the canonical post-management message list rather than an append-only transcript
- if `MEMORY_ID` is not set, the runtime falls back to an in-process short-term memory store for local development

Background-agent authorization note:

- user-initiated copilot tool calls should use delegated user credentials and `/tools/*`
- future background agents should not receive broad all-tenant access just because they use machine-to-machine auth
- background agent capability should come from OAuth scopes, while tenant/resource boundaries should come from a persisted work item or agent run with allowed tenant, incident, devices, and actions

## Near-Term Implementation Plan

1. Install and verify the SPA toolchain.
2. Provision MongoDB Atlas and wire secrets/config through CDK or local env.
3. Continue evolving `apps/pulseforge-agent-runtime` as the PulseForge runtime for investigation and remediation workflows.
4. Add backend-owned AgentCore invocation.
5. Add incident investigation and copilot workflows.
6. Add autonomous remediation and ticket creation.
