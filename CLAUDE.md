# Agent Core

Monorepo using pnpm workspaces.

## Structure

- `apps/` - Individual application projects
  - `apps/hello-world/` - Strands-based agent with memory and outbound identity
  - `apps/webapp/` - Fastify web app for chat UI and OAuth callback handling
  - `apps/scripts/` - Utility scripts for interacting with deployed resources
- `shared/` - Shared packages consumed by apps
- `lib/` - CDK stack definition

## Apps

### hello-world (`pnpm --filter @agent-core/hello-world-app <command>`)

Strands SDK agent deployed as a Bedrock AgentCore Runtime. Supports two modes:
- **Conversational**: Normal prompts are handled by the Strands agent with conversation memory.
- **Introspect**: Prompt `"introspect"` triggers the outbound USER_FEDERATION OAuth flow.

The handler is an `async function*` that yields SSE events (`{ event, data }`).

### webapp (`pnpm --filter @agent-core/webapp <command>`)

Fastify server that acts as a frontend + OAuth callback handler for the hello-world agent. Three responsibilities:
- `GET /` - Serves a chat UI (static HTML from `public/`)
- `POST /api/chat` - Proxies requests to the AgentCore runtime with the user's JWT, streams SSE events back
- `GET /oauth2/callback` - Handles the OAuth redirect after user authenticates; calls `CompleteResourceTokenAuthCommand` to complete the token exchange

**Environment variables:**
- `AGENT_RUNTIME_ARN` (required) - ARN of the deployed agent runtime
- `AWS_PROFILE` (optional) - AWS profile for credentials
- `AWS_REGION` (optional, default: `us-east-1`)
- `WEBAPP_PORT` (optional, default: `9090`)

### scripts (`pnpm --filter @agent-core/scripts <command>`)

- `invoke-agent` - Invoke a deployed Bedrock AgentCore runtime via direct HTTPS + bearer token
  - `--agent-runtime-arn <arn>` (required) - ARN of the deployed agent runtime
  - `--prompt <prompt>` (required) - Prompt to send to the agent
  - `--token <token>` (required) - Cognito access token (obtain via `get-token`)
  - `--session-id <id>` (optional) - Session ID for the invocation; defaults to a random UUID
- `get-token` - Obtain a Cognito access token via Cognito AdminInitiateAuth
  - `--user-pool-id <id>` (required) - Cognito User Pool ID from stack outputs
  - `--client-id <id>` (required) - Cognito User Pool Client ID from stack outputs
  - `--username <user>` (required) - Cognito username
  - `--password <pass>` (required) - User password
  - `--profile <name>` (optional) - AWS profile to use

## Conventions

- Use `tsx` (not `ts-node`) for running TypeScript in apps.
- Shared packages use the `@agent-core/` npm scope.
- Apps depend on shared packages via `workspace:*`.
- All packages extend `tsconfig.base.json` at the repo root.

## Memory Integration

The hello-world agent persists conversation history to AgentCore Memory using a Strands SDK hook:

- `MemoryHook` (in `apps/hello-world/src/memory-hook.ts`) implements `HookProvider` and registers an `AfterInvocationEvent` callback.
- After each agent invocation, it maps Strands `Message` objects to AgentCore `Conversational` payloads and calls `CreateEventCommand`.
- The `MEMORY_ID` env var is set by the CDK stack from the provisioned `Memory` resource.
- The runtime's IAM role is granted `bedrock-agentcore:CreateEvent` and `bedrock-agentcore:ListEvents` on the memory ARN.

## Authentication Architecture

There are two distinct auth layers — **inbound** (who can call the agent) and **outbound** (agent acting on behalf of a user).

### Inbound Auth (Cognito)

Callers must present a valid Cognito access token to invoke the agent runtime. The CDK stack configures `RuntimeAuthorizerConfiguration.usingCognito(userPool, [userPoolClient])` on the runtime. The token is sent as `Authorization: Bearer <token>` via direct HTTPS to the AgentCore endpoint (not via AWS SDK SigV4).

The runtime populates `context.workloadAccessToken` from the caller's JWT, which is then used for the outbound identity flow.

**CDK resources:**
- User Pool (`AgentCoreIdentityPool`) with Cognito-hosted domain
- User Pool Client with `generateSecret: true`, `adminUserPassword` auth flow, authorization code grant
- OAuth scopes: openid, profile, email

**Stack outputs:** `UserPoolId`, `UserPoolClientId`

**Invoking the runtime (direct HTTPS, not AWS SDK):**
```
POST https://bedrock-agentcore.<region>.amazonaws.com/runtimes/<encoded-arn>/invocations?qualifier=DEFAULT
Authorization: Bearer <cognito-access-token>
Content-Type: application/json
Accept: text/event-stream
X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: <session-id>
```

> **Important:** You cannot use the AWS SDK `InvokeAgentRuntimeCommand` with Cognito auth. You must use direct HTTPS with a Bearer token. The `invoke-agent` script and webapp both use `fetch()` for this reason.

### Outbound Auth (USER_FEDERATION via AgentCore Identity)

The agent can obtain OAuth2 tokens on behalf of the authenticated user. This is done via the `withAccessToken` HOF from `bedrock-agentcore/identity`.

**How it works:**
1. Agent calls `withAccessToken({ providerName, authFlow: "USER_FEDERATION", workloadIdentityToken: context.workloadAccessToken, callbackUrl, onAuthUrl, ... })`
2. AgentCore Identity redirects the user to Cognito's hosted UI for login
3. After login, Cognito redirects to AgentCore Identity's own callback URL
4. AgentCore Identity then redirects the user to our `callbackUrl` (the webapp's `/oauth2/callback`) with `?session_id=<sessionUri>`
5. The webapp calls `CompleteResourceTokenAuthCommand({ sessionUri, userIdentifier: { userToken: jwt } })` to complete the exchange
6. The `withAccessToken` call in the agent resolves with the access token

**Key pattern - `createAuthSignal`:** Bridges the async `onAuthUrl` callback into the generator's `yield` flow. The callback calls `authSignal.emit(url)`, and the generator awaits `authSignal.wait()` to get the URL and yield it as an SSE event.

**Critical setup requirements:**

1. **Cognito callback URLs must include the AgentCore Identity callback URL.** When you register a resource provider in the AgentCore Identity console, it provides a stable callback URL (e.g., `https://bedrock-agentcore.us-east-1.amazonaws.com/identities/oauth2/callback/<uuid>`). This URL must be added to the Cognito User Pool Client's allowed callback URLs in the CDK stack, otherwise Cognito returns a `redirect_mismatch` error.

2. **The webapp's callback URL** (`http://localhost:9090/oauth2/callback`) is the `callbackUrl` passed to `withAccessToken` — this is where AgentCore Identity redirects the user *after* the Cognito flow. This is separate from the Cognito callback URL.

3. **Runtime IAM permissions** must include: `bedrock-agentcore:GetResourceOauth2Token`, `GetWorkloadAccessToken`, `GetWorkloadAccessTokenForJWT`, and `secretsmanager:GetSecretValue`.

### Creating a test user (post-deploy)

```bash
aws cognito-idp admin-create-user --user-pool-id <UserPoolId> --username testuser --temporary-password 'TempPass123!' --user-attributes Name=email,Value=test@example.com Name=email_verified,Value=true

aws cognito-idp admin-set-user-password --user-pool-id <UserPoolId> --username testuser --password 'Password123!' --permanent
```

## Testing End-to-End (Introspect Flow)

```bash
# 1. Start the webapp
AGENT_RUNTIME_ARN=<arn> AWS_PROFILE=<profile> pnpm --filter @agent-core/webapp dev

# 2. Get a Cognito access token
pnpm --filter @agent-core/scripts get-token --user-pool-id <UserPoolId> --client-id <ClientId> --username testuser --password 'Password123!' --profile <profile>

# 3. Open http://localhost:9090 in a browser
# 4. Paste the access token into the token field
# 5. Send "introspect" as the prompt
# 6. Click the auth URL that appears → authenticate in the Cognito hosted UI
# 7. After redirect, the webapp calls CompleteResourceTokenAuthCommand
# 8. The agent receives the token and streams back decoded JWT claims
```

Alternatively, use the CLI scripts directly (note: the introspect flow requires the webapp running for the OAuth callback):

```bash
pnpm --filter @agent-core/scripts invoke-agent --agent-runtime-arn <arn> --prompt "introspect" --token <access-token> --session-id my-session
```

## Observability

The CDK stack configures X-Ray Transaction Search with CloudWatch Logs as the trace segment destination. All traces are indexed at 100% sampling.
