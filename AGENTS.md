# Agent Core

Monorepo using pnpm workspaces.

## Structure

- `apps/` - Individual application projects
  - `apps/pulseforge-agent-runtime/` - PulseForge AgentCore runtime for copilot and incident investigation
  - `apps/webapp/` - React/Vite operator console
  - `apps/webbackend/` - Hono web backend for app auth, MongoDB access, and AgentCore invocation
- `shared/` - Shared packages consumed by apps
  - `shared/pulseforge-domain/` - domain types and demo data
  - `shared/pulseforge-tools/` - reusable PulseForge agent tool definitions and Strands adapters
- `lib/` - CDK stack definition

## Apps

### pulseforge-agent-runtime (`pnpm --filter @agent-core/pulseforge-agent-runtime <command>`)

Strands SDK agent deployed as a Bedrock AgentCore Runtime. It currently powers:

- operator copilot responses
- incident investigation workflows
- structured summaries returned to the PulseForge web backend

The handler is an `async function*` that yields SSE events (`{ event, data }`).

### webapp (`pnpm --filter @agent-core/webapp <command>`)

React/Vite SPA for the PulseForge operator console.

### webbackend (`pnpm --filter @agent-core/webbackend <command>`)

Hono web backend that:

- verifies Cognito access tokens for app auth
- reads and writes PulseForge data in MongoDB
- invokes the deployed AgentCore runtime with IAM
- passes the authenticated Cognito `sub` through as `runtimeUserId`
- exposes agent-facing `/tools/*` routes with delegated-user Cognito auth and audit logging

## Conventions

- Use `tsx` (not `ts-node`) for running TypeScript in apps.
- Shared packages use the `@agent-core/` npm scope.
- Apps may consume shared source directly when the package is bundled into a runtime image.
- All packages extend `tsconfig.base.json` at the repo root.
- Package-local Node globals should be made explicit with `@types/node` and `"types": ["node"]` in that package's `tsconfig.json`.

## Memory Integration

The PulseForge runtime treats AgentCore Memory Events as canonical short-term session state:

- `AgentCoreEventSessionStore` loads persisted Events before invocation.
- The Strands agent receives those loaded messages as its initial conversation history.
- The configured Strands conversation manager mutates/reduces messages during invocation.
- After invocation, the runtime persists final canonical `agent.messages` back to AgentCore Events.
- If `MEMORY_ID` is not configured, the runtime uses an in-process fallback store for local development.

Long-term memory retrieval is separate:

- `AgentCoreLongTermMemoryPlugin` retrieves Memory Records when `ENABLE_AGENTCORE_LONG_TERM_MEMORY=true`.
- Memory Records are used for retrieved knowledge, not short-term canonical transcript state.

## Tool Integration

Reusable agent tools live in `shared/pulseforge-tools`.

- Tool definitions declare name, input schema, required scopes, and HTTP mapping.
- The runtime wires the `ops-copilot` bundle into the Strands agent.
- Tool HTTP calls go to the web backend `/tools/*` routes.
- The web backend validates tool requests, enforces delegated-user scopes, writes audit logs, and returns curated model-friendly JSON.
- If AgentCore Identity requires user authorization, the runtime emits an `auth_required` SSE event instead of polling indefinitely.

## Authentication Architecture

There are three distinct auth paths:

- **App auth:** users sign in to the PulseForge web app with Cognito.
- **Runtime auth:** the web backend invokes the deployed AgentCore runtime with IAM.
- **Tool auth:** the agent calls backend `/tools/*` routes with delegated-user Cognito credentials obtained through AgentCore Identity.

The browser never calls the AgentCore runtime directly.

### App Auth (Cognito)

- `apps/webapp` signs users in with the shared Cognito user pool client.
- `apps/webbackend` verifies Cognito access tokens on protected `/api/*` routes.
- The authenticated Cognito `sub` is attached to web backend requests as the app user identity.

### Runtime Invocation (IAM)

- `apps/webbackend` invokes the deployed runtime with `InvokeAgentRuntimeCommand`.
- The web backend passes the authenticated Cognito `sub` through as `runtimeUserId`.
- The runtime itself is configured with `RuntimeAuthorizerConfiguration.usingIAM()`.

### Tool Invocation (Delegated User Auth)

- `/tools/*` requires a Cognito access token from the agent identity client, not the web app client.
- Every tool request must include `x-pulseforge-agent-run-id`.
- Tool scopes use the `pulseforge-backend` resource server with operations like `read:incidents`, `read:telemetry`, and `write:tickets`.
- Tool calls are audited with `actorType`, `actorId`, `onBehalfOfUserId`, `agentRunId`, scopes, route, status, and outcome.

## Local Development

```bash
pnpm mongodb:dev
pnpm webbackend:seed:local
pnpm webbackend:dev:local
pnpm webapp:dev:local
```

The web backend expects the deployed runtime ARN and qualifier in `apps/webbackend/.env.local`.

When running the runtime locally for tool development, configure:

```bash
PULSEFORGE_BACKEND_URL=http://localhost:3001
PULSEFORGE_TOOL_AUTH_MODE=local-user-id
PULSEFORGE_WORKLOAD_NAME=<agentcore-workload-name>
PULSEFORGE_LOCAL_USER_ID=<cognito-user-sub>
```

## Observability

The CDK stack configures CloudWatch log delivery and X-Ray Transaction Search. Traces are indexed at 100% sampling.
