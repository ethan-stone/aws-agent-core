# Agent Core

Monorepo using pnpm workspaces.

## Structure

- `apps/` - Individual application projects
  - `apps/pulseforge-agent-runtime/` - PulseForge AgentCore runtime for copilot and incident investigation
  - `apps/webapp/` - React/Vite operator console
  - `apps/api/` - Hono API for app auth, MongoDB access, and AgentCore invocation
- `shared/` - Shared packages consumed by apps
- `lib/` - CDK stack definition

## Apps

### pulseforge-agent-runtime (`pnpm --filter @agent-core/pulseforge-agent-runtime <command>`)

Strands SDK agent deployed as a Bedrock AgentCore Runtime. It currently powers:
- incident investigation
- operator copilot responses
- structured summaries returned to the PulseForge API

The handler is an `async function*` that yields SSE events (`{ event, data }`).

### webapp (`pnpm --filter @agent-core/webapp <command>`)

React/Vite SPA for the PulseForge operator console.

### api (`pnpm --filter @agent-core/api <command>`)

Hono API that:
- verifies Cognito access tokens for app auth
- reads and writes PulseForge data in MongoDB
- invokes the deployed AgentCore runtime with IAM
- passes the authenticated Cognito `sub` through as `runtimeUserId`

## Conventions

- Use `tsx` (not `ts-node`) for running TypeScript in apps.
- Shared packages use the `@agent-core/` npm scope.
- Apps depend on shared packages via `workspace:*`.
- All packages extend `tsconfig.base.json` at the repo root.

## Memory Integration

The PulseForge runtime persists conversation history to AgentCore Memory using a Strands SDK hook:

- `MemoryHook` (in `apps/pulseforge-agent-runtime/src/memory-hook.ts`) implements `HookProvider` and registers an `AfterInvocationEvent` callback.
- After each agent invocation, it maps Strands `Message` objects to AgentCore `Conversational` payloads and calls `CreateEventCommand`.
- The `MEMORY_ID` env var is set by the CDK stack from the provisioned `Memory` resource.
- The runtime's IAM role is granted `bedrock-agentcore:CreateEvent` and `bedrock-agentcore:ListEvents` on the memory ARN.

## Authentication Architecture

There are two distinct auth layers:

- **App auth:** users sign in to the PulseForge web app with Cognito
- **Runtime auth:** the backend API invokes the deployed AgentCore runtime with IAM

The browser never calls the AgentCore runtime directly.

### App Auth (Cognito)

- `apps/webapp` signs users in with the shared Cognito user pool client
- `apps/api` verifies Cognito access tokens on protected `/api/*` routes
- the authenticated Cognito `sub` is attached to API requests as the app user identity

### Runtime Invocation (IAM)

- `apps/api` invokes the deployed runtime with `InvokeAgentRuntimeCommand`
- the API passes the authenticated Cognito `sub` through as `runtimeUserId`
- the runtime itself is configured with `RuntimeAuthorizerConfiguration.usingIAM()`

### Local Development

```bash
pnpm mongodb:dev
pnpm api:seed:local
pnpm api:dev:local
pnpm webapp:dev:local
```

The API expects the deployed runtime ARN and qualifier in `apps/api/.env.local`.

## Observability

The CDK stack configures X-Ray Transaction Search with CloudWatch Logs as the trace segment destination. All traces are indexed at 100% sampling.
