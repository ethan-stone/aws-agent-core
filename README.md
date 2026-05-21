# PulseForge

`PulseForge` is an AI-assisted IoT fleet operations application built on top of Bedrock AgentCore. The product direction is:

- React/Vite SPA frontend
- Lambda-style web backend
- Bedrock AgentCore runtime for agent orchestration
- background remediation worker for automated incident handling

This repo is now in phase 1 of that migration. The demo chat app has been replaced with the first project scaffolds for the frontend, web backend, and shared domain model.

## Repo Layout

- `apps/webapp/` - React SPA shell for the operator console
- `apps/webbackend/` - Hono-based web backend for the SPA, app auth, and AgentCore runtime invocation
- `apps/tools-api/` - Hono/OpenAPI agent-facing tools API with delegated-user auth and audit logging
- `apps/pulseforge-agent-runtime/` - PulseForge Bedrock AgentCore runtime app for copilot and incident investigation workflows
- `shared/pulseforge-backend/` - shared MongoDB repositories, auth helpers, and PulseForge service functions
- `shared/pulseforge-domain/` - shared domain types and synthetic seed data
- `shared/pulseforge-agent/` - agent configs, prompts, and tool bundle composition
- `shared/pulseforge-tools/` - reusable tool definitions and Strands adapters
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

- add background remediation worker and ticketing pipeline

## Current Commands

Build and test everything:

```bash
pnpm run build
pnpm run test
```

Recommended local dev commands:

```bash
pnpm mongodb:dev
pnpm pulseforge:seed
pnpm agent:dev:local
pnpm agent:invoke:local -- --user-id <cognito-user-sub> --incident-id inc-1001
pnpm webbackend:dev:local
pnpm tools-api:dev:local
pnpm webapp:dev:local
```

Notes:

- `pnpm mongodb:dev` runs MongoDB in the foreground with visible logs using `docker compose`
- `pnpm pulseforge:seed` seeds the local MongoDB database with PulseForge demo data
- `pnpm agent:dev:local` runs the AgentCore runtime locally on port 8080
- `pnpm agent:invoke:local -- --user-id <cognito-user-sub>` invokes the local runtime with generated run/session ids
- `pnpm webbackend:dev:local` runs the web backend against a deployed AgentCore runtime using the AWS SDK
- `pnpm tools-api:dev:local` runs the agent-facing tools API on port 3001
- `pnpm webapp:dev:local` runs the SPA pointed at `http://localhost:3000`
- `pnpm webapp:dev:deployed-backend` runs the SPA locally against a deployed web backend

Before running those commands, create local env files from the checked-in examples:

```bash
cp .env.example .env.local
cp apps/webbackend/.env.example apps/webbackend/.env.local
cp apps/tools-api/.env.example apps/tools-api/.env.local
cp apps/pulseforge-agent-runtime/.env.example apps/pulseforge-agent-runtime/.env.local
cp apps/webapp/.env.example apps/webapp/.env.local
```

Then edit the `.env.local` files with your real values:

- `.env.local`
  - shared defaults such as `AWS_PROFILE`
- `apps/webbackend/.env.local`
  - Cognito user pool and client ids
  - deployed runtime ARN and qualifier
- `apps/tools-api/.env.local`
  - MongoDB settings
  - Cognito user pool and agent identity client ids
- `apps/pulseforge-agent-runtime/.env.local`
- optional settings for local runtime development and AgentCore Memory integration
- `apps/webapp/.env.local`
  - web backend base URL for the SPA
- `apps/webapp/.env.deployed-backend.local`
  - optional private override for the deployed web backend base URL used by `pnpm webapp:dev:deployed-backend`

The AgentCore runtime itself is deployed infrastructure in the current workflow, so `apps/pulseforge-agent-runtime/.env.local` is only needed when you are running the runtime directly for manual development or memory integration testing.

The normal local path no longer relies on bash wrappers for the web backend or webapp:

- each local Node entrypoint loads its own app-local `.env.local`/`.env` with an explicit dotenv path
- the webapp uses Vite's built-in env loading from `apps/webapp`; the deployed-backend script runs Vite with `--mode deployed-backend`, which loads the committed `.env.deployed-backend` file and can be overridden by `.env.deployed-backend.local`
- MongoDB runs through `docker compose` so you can see container logs directly

## App Authentication

PulseForge now has an app-level Cognito auth layer that uses Cognito for app sign-in, while the AgentCore runtime itself uses IAM auth for invocation.

What is wired:

- `apps/webapp` loads auth config from `GET /api/auth/config`
- when Cognito env vars are present, the SPA requires sign-in before entering the app
- the SPA uses Cognito sign-up, sign-in, and confirmation APIs
- the web backend verifies Cognito access tokens and protects `/api/*` routes except:
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
COGNITO_AGENT_IDENTITY_CLIENT_IDS=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_RESOURCE_SERVER_IDENTIFIER=pulseforge-backend
```

When app auth env vars are omitted:

- auth is disabled
- the SPA allows entry without login
- the web backend skips app token verification

Agent-facing tool routes are served by a separate tools API. In a real domain
layout this would be something like `https://tools.example.com`, while the
browser-oriented API would live separately.

- the tools API requires a Cognito access token issued to the tools client, not the web app client
- every tools request must include `x-pulseforge-agent-run-id`
- each operation checks `pulseforge-backend/*` scopes such as `read:incidents`, `read:telemetry`, and `write:tickets`
- reads and writes are persisted to `audit_logs` with `actorType`, `actorId`, `onBehalfOfUserId`, `agentRunId`, route, scopes, and outcome
- records created by the agent also store `createdBy` attribution

Agent runtime env vars for tool calls:

```bash
PULSEFORGE_TOOLS_API_URL=http://localhost:3001
PULSEFORGE_REQUIRE_TOOLS=true # deployed runtime should fail fast if tools are not configured
PULSEFORGE_TOOL_AUTH_MODE=agentcore-runtime # optional; defaults to agentcore-runtime
PULSEFORGE_TOOLS_PROVIDER_NAME=pulseforge-backend-user-federation
PULSEFORGE_TOOLS_RESOURCE_SERVER_IDENTIFIER=pulseforge-backend
OAUTH_CALLBACK_URL=http://localhost:5173/oauth2/callback # browser return URL after AgentCore finishes delegated auth
PULSEFORGE_WORKLOAD_NAME=pulseforge-agent-runtime # required for local-user-id
PULSEFORGE_LOCAL_USER_ID=local-cognito-user-sub # optional local fallback
```

When `PULSEFORGE_TOOLS_API_URL` is omitted, runtime tool wiring is disabled and
the runtime still starts unless `PULSEFORGE_REQUIRE_TOOLS=true`. The CDK stack
sets `PULSEFORGE_REQUIRE_TOOLS=true` for deployed runtimes and wires this value
from the deployed `PulseForgeToolsApi`.

The deployed runtime also gets an AgentCore outbound auth provider named
`pulseforge-backend-user-federation`. The runtime requests one lazy
provider-level scope grant for the configured agent tool bundle, then lets
AgentCore Identity reuse that grant across individual tool calls. It exchanges the runtime workload identity
for delegated Cognito user tokens issued to the tools client, then requests
fully-qualified OAuth scopes such as `pulseforge-backend/read:incidents`.
When AgentCore Identity returns an authorization URL, the runtime streams an
`auth_required` event and keeps the same invocation open while `withAccessToken`
polls for OAuth completion.

`OAUTH_CALLBACK_URL` is the final browser return URL after AgentCore completes
the OAuth session. It is intentionally different from the AgentCore OAuth
provider callback URL, which CDK registers on the Cognito tools client via the
provider's `CallbackUrl` attribute.

The deployed `PulseForgeToolsApi` and `PulseForgeWebBackendApi` should share the
same MongoDB database. Create a general Secrets Manager secret for PulseForge
configuration, for example `pulseforge-secrets`, with JSON like:

```json
{
  "mongodbUri": "mongodb+srv://..."
}
```

Pass that pre-created secret ARN when deploying:

```bash
pnpm run cdk deploy -- --context pulseForgeSecretsArn=arn:aws:secretsmanager:us-east-1:123456789012:secret:pulseforge-secrets-AbCdEf
```

CDK imports that existing secret, exposes its ARN to both deployed backend
Lambdas as `PULSEFORGE_SECRETS_ARN`, and grants
`secretsmanager:GetSecretValue`. The backend fetches and caches the secret at
runtime, then reads `mongodbUri`.

If `pulseForgeSecretsArn` is omitted, the Lambdas fall back to in-memory storage,
which is only useful for smoke testing because the two APIs will not share agent
run state.

`local-user-id` mode is for running the runtime outside AgentCore. It obtains a
workload access token with `GetWorkloadAccessTokenForUserId`; prefer the
`x-amzn-bedrock-agentcore-runtime-custom-user-id` invocation header locally so
the simulated delegated user is explicit.

CDK outputs for app auth:

- `PulseForgeUserPoolId`
- `PulseForgeUserPoolClientId`
- `PulseForgeUserPoolDomain`
- `PulseForgeToolsUserPoolClientId`
- `PulseForgeBackendResourceServerIdentifier`
- `PulseForgeToolsApiUrl`
- `PulseForgeWebBackendApiUrl`

Local flow after deployment:

1. deploy the stack and capture `PulseForgeUserPoolId` and `PulseForgeUserPoolClientId`
2. place those values into `apps/webbackend/.env.local`
3. place your deployed runtime ARN and qualifier into `apps/webbackend/.env.local`
4. start local Mongo
5. run the web backend
6. run the SPA
7. use `/signup`, then `/confirm-signup`, then `/login`

MongoDB-related environment variables for local `apps/tools-api` and local webbackend fallback:

```bash
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=pulseforge
```

When `MONGODB_URI` is configured locally:

- `pnpm pulseforge:seed` loads the demo PulseForge dataset into MongoDB
- web backend reads come from MongoDB collections

When `MONGODB_URI` is not configured:

- the web backend falls back to the in-memory demo repository

In deployed Lambda, both APIs read the Mongo URI from the pre-created Secrets
Manager secret `pulseforge-secrets`, JSON key `mongodbUri`. CDK imports the
secret and grants each Lambda read access; it does not create or mutate the
secret.

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

- user-initiated copilot tool calls should use delegated user credentials and the separate tools API
- future background agents should not receive broad all-tenant access just because they use machine-to-machine auth
- background agent capability should come from OAuth scopes, while tenant/resource boundaries should come from a persisted work item or agent run with allowed tenant, incident, devices, and actions

## Near-Term Implementation Plan

1. Install and verify the SPA toolchain.
2. Provision MongoDB Atlas and wire secrets/config through CDK or local env.
3. Continue evolving `apps/pulseforge-agent-runtime` as the PulseForge runtime for investigation and remediation workflows.
4. Add backend-owned AgentCore invocation.
5. Add incident investigation and copilot workflows.
6. Add autonomous remediation and ticket creation.
