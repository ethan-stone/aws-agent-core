# Grill-Me Session: Integrating PulseForge Tools into the Agent

This document captures the grill-me design session for integrating the existing PulseForge `/tools/*` API resources into the agent runtime. It is written as a cleaned decision transcript so the team can see how the skill progressively narrowed a broad idea into an implementation plan.

## Context

PulseForge already had:

- A React web app.
- A Hono webbackend.
- A Bedrock AgentCore runtime using Strands.
- AgentCore Memory for short-term and long-term memory.
- `/tools/*` API routes intended for agent use.
- Cognito-backed auth for user-facing API calls.
- Audit metadata for agent actions, including `actorType`, `actorId`, `onBehalfOfUserId`, and `agentRunId`.

The open design problem was how to turn those `/tools/*` routes into reusable Strands tools, integrate with AgentCore Identity, avoid client-to-runtime invocations, and preserve a clear future path to AgentCore Gateway.

## Decision Summary

- Do not use AgentCore Gateway yet.
- Build reusable in-code tools first, with a clean Gateway migration path.
- Create a dedicated shared package: `@agent-core/pulseforge-tools`.
- Keep tool definitions, HTTP execution, credential-provider abstractions, and Strands adapters separated.
- Use a `withAccessToken`-style credential abstraction because AgentCore Identity works as an execution wrapper, not a simple `getAccessToken()` function.
- Start with direct HTTP tools from the runtime to the webbackend `/tools/*` endpoints.
- Keep tool schemas and API schemas separate but related.
- Convert only `/tools/*` routes to `@hono/zod-openapi` first.
- Mount `/tools` as a Hono sub-app.
- Curate and trim tool responses in the `/tools/*` routes, because they are agent-facing.
- Wire tools only into `ops-copilot` first.
- Assign tools through explicit per-agent bundles keyed by the exact `agentKind` strings.
- Use per-tool scope requests, not broad global scopes.
- If authorization is required, stop the current run and return an `auth_required` state.
- Add `auth_required` as a first-class `AgentRunStatus`.
- Retry after auth as a new `AgentRun`, but reuse the same `sessionId`.
- Add `agentRunId` to the runtime invocation payload so tool calls can be audited.
- Remove `investigationContext` from the runtime payload and stop injecting prebuilt investigation context into the prompt.
- Let the agent retrieve context through tools instead.
- Give each `agentKind` its own system prompt.
- Allow non-destructive write tools to execute directly without confirmation.
- Use explicit auth mode config: `PULSEFORGE_TOOL_AUTH_MODE=agentcore-runtime | local-user-id`.
- For local dev, use `GetWorkloadAccessTokenForUserIdCommand` rather than JWT-based workload token exchange.
- Use a custom local header, `x-amzn-bedrock-agentcore-runtime-custom-user-id`, because the local SDK only forwards `authorization` and `x-amzn-bedrock-agentcore-runtime-custom-*` headers into `context.headers`.
- Rename the Cognito client concept from `PulseForgeToolsClient` to `PulseForgeAgentIdentityClient`.
- Use `COGNITO_AGENT_IDENTITY_CLIENT_IDS`; no fallback env vars are needed because this is not released yet.
- Configure the AgentCore Identity OAuth credential provider in CDK.
- Implement in two slices: tool framework first, identity infra after.

## Transcript

### Q1: Direct HTTP tools or AgentCore Gateway first?

**Question:** Should the first integration target be direct HTTP tools from the Strands agent runtime, or AgentCore Gateway in front of those tools from day one?

**Recommendation:** Start with direct HTTP tools in code, but design the registry so the same tool definitions can later emit or register Gateway metadata.

**User decision:** Do not use AgentCore Gateway right now, but tools must be reusable, clearly document dependencies, and have a clear migration path to Gateway.

### Q2: Where should reusable tool definitions live?

**Question:** Should reusable tool definitions live inside the runtime app or in a shared package?

**Recommendation:** Create `shared/pulseforge-tools` as a dedicated package.

**User decision:** Agreed.

### Q3: Should the shared package execute HTTP calls or only define contracts?

**Question:** Should the reusable tool package perform HTTP calls itself, or only define tool contracts and leave execution to the runtime?

**Recommendation:** Include both, but separate them:

- `definitions` for metadata, schemas, descriptions, scopes, routes, and Gateway hints.
- `client` for HTTP execution.
- `strands` for adapters that turn definitions into Strands-compatible tools.

**User decision:** The organization is solid for now.

### Q4: How should delegated credentials be represented?

**Initial Question:** Should the runtime use a simple `getAccessToken()` interface?

**Initial Recommendation:** Define `ToolAuthProvider.getAccessToken(...)`.

**User challenge:** The older experiment used `withAccessToken` from `bedrock-agentcore/identity`; that wraps an async operation and may not fit a simple token-returning interface.

**Code finding:** The old commit showed `withAccessToken({ providerName, scopes, authFlow, workloadIdentityToken, onAuthUrl })(async (token) => ...)`.

**Revised Recommendation:** Use a `withAccessToken`-style execution wrapper:

```ts
interface ToolCredentialProvider {
  withAccessToken<TArgs extends unknown[], TResult>(
    config: {
      providerName: string;
      scopes: string[];
      authFlow: "USER_FEDERATION" | "M2M";
      onAuthUrl?: (url: string) => void | Promise<void>;
      callbackUrl?: string;
      customState?: string;
      customParameters?: Record<string, string>;
    },
    fn: (...args: [...TArgs, string]) => Promise<TResult>
  ): (...args: TArgs) => Promise<TResult>;
}
```

**User decision:** Since that is how AgentCore works, use that shape for now.

### Q5: How should `auth_required` be surfaced?

**Question:** When AgentCore Identity returns an authorization URL, how should the agent surface that to the web app?

**Recommendation:** Return an explicit `auth_required` SSE event and avoid long-running OAuth stream/poll behavior in the first implementation.

**User decision:** Keep it simpler for now, but note that stream/poll through the full OAuth completion flow should be designed later.

**Follow-up action:** Added this deferred task to `PROJECT_NOTES.md`.

### Q6: Should tools be available to every agent by default?

**Question:** Should tool execution be available to every agent kind by default, or should each agent explicitly opt into a curated tool set?

**Recommendation:** Each agent kind should explicitly opt into a named tool bundle.

**User clarification:** The object key should be the agent.

**Restated recommendation:** Use exact `agentKind` strings as keys:

```ts
const toolsByAgentKind = {
  "ops-copilot": [],
  "anomaly-investigation": [],
  "remediation-planner": [],
  "autonomous-remediation": [],
};
```

**User decision:** Align keys exactly to what agents are called elsewhere.

### Q7: Per-tool scopes or bundle-level scopes?

**Initial Question:** Should OAuth scopes be requested per individual tool call, or should the runtime request the union of all scopes for the agent’s tool bundle?

**Initial Recommendation:** Request scopes per tool call.

**User challenge:** If an agent makes eight tool calls, will the user authenticate eight times? That is a terrible UX.

**Clarification:** Per-tool scope selection should not mean per-tool user prompts. AgentCore Identity/token vault should reuse existing grants where possible, but behavior may be provider-dependent.

**Revised recommendation:** Keep per-tool scope requests and defer bundle-level preflight until real UX pain appears.

**User decision:** Keep per-tool scope requests and observe behavior.

### Q8: Stop or continue when auth is required?

**Question:** When a tool call hits missing user consent and returns `auth_required`, should the run stop immediately or should the agent continue without that tool?

**Recommendation:** Stop immediately.

**User decision:** If auth is required, stop and prompt for it.

### Q9: What runtime payload is needed for audit?

**Question:** What should the runtime payload include so tools can authenticate and audit correctly?

**Recommendation:** Add `agentRunId` to `AgentRuntimeInvocation`. Tool calls then send:

```http
Authorization: Bearer <delegated-user-token>
x-pulseforge-agent-run-id: <agentRunId>
```

**User decision:** Yes.

### Q10: ID-scoped tools or discovery/search tools?

**Question:** Should tools receive only explicit IDs from prompt/context, or should they discover/search resources?

**Recommendation:** First implementation should expose only ID-scoped tools.

**User decision:** Use ID-scoped tools for now.

**Important correction from user:** The current runtime injects prebuilt `investigationContext` into the prompt. That should be eliminated. The backend should only provide IDs, and the agent should use tools to retrieve what it needs.

### Q11: Should the system prompt explicitly say which tool to call?

**Question:** Should the runtime system prompt explicitly instruct the agent to call tools before answering when an `incidentId` or `deviceId` is provided?

**Recommendation:** The prompt should enforce tool-grounded behavior at a high level.

**User decision:** The system prompt should describe the agent’s goals and how to approach them, but it should not hard-code “call this tool when this happens.”

### Q12: One generic prompt or per-agent prompts?

**Question:** Should each `agentKind` have its own system prompt, or should there be one generic PulseForge copilot prompt with metadata?

**Recommendation:** Each agent kind should have its own prompt.

**User decision:** Each agent kind should have its own system prompt.

### Q13: Which agent gets tools first?

**Question:** Which agent kind should get tools in the first slice?

**Recommendation:** Start only with `ops-copilot`.

**User decision:** Yes.

### Q14: Which tools should `ops-copilot` get?

**Question:** Which tools should `ops-copilot` get in the first slice?

**Recommendation:** All six current ID-scoped tools:

- `get_incident_context`
- `get_device`
- `get_device_telemetry`
- `create_incident_event`
- `create_ticket`
- `propose_remediation_action`

**User decision:** That set looks good.

### Q15: What happens to the synthetic summary helper?

**Question:** What should happen to the current `summary` event and deterministic `buildInvestigationSummary()` helper after tools are wired in?

**Recommendation:** Make the model’s final answer the source of the operator-facing summary. Keep a lightweight summary event derived from the final agent answer, not from injected context.

**User decision:** Yes.

### Q16: How should tool errors appear to the model?

**Question:** Should tools throw errors or return structured error payloads?

**Recommendation:** Throw only for infrastructure/control-flow failures such as auth, network, malformed backend response, or backend 5xx. Return structured JSON for domain failures such as not found or validation errors:

```json
{
  "ok": false,
  "errorCode": "not_found",
  "message": "Incident inc-123 was not found."
}
```

**User decision:** Sounds good.

### Q17: Package and tool names

**Question:** What should the tool package and tool names be called?

**Recommendation:** Package name:

```txt
@agent-core/pulseforge-tools
```

Tool names:

```txt
get_incident_context
get_device
get_device_telemetry
create_incident_event
create_ticket
propose_remediation_action
```

**User decision:** Yes.

### Q18: Custom Gateway metadata or Hono zod-openapi?

**Initial Question:** Should tool definitions include Gateway/OpenAPI metadata now?

**Recommendation:** Include minimal metadata in definitions.

**User challenge:** Since the webbackend uses Hono, use `@hono/zod-openapi` for `/tools/*`; it handles validation and prepares for OpenAPI/Gateway.

**Revised recommendation:** Convert only `/tools/*` to `OpenAPIHono`/`createRoute` first, not every web route.

**User decision:** Yes.

### Q19: Hono sub-app?

**Question:** Should `/tools/*` be a mounted Hono sub-app?

**Recommendation:** Yes. Use `toolsApp = new OpenAPIHono()` and mount it with `app.route("/tools", toolsApp)`.

**User decision:** Yes.

### Q20: Shared schemas or separate schemas?

**Question:** Should shared `@agent-core/pulseforge-tools` schemas be both API-facing and agent-facing, or should API and agent schemas be separate but related?

**Recommendation:** Separate but related.

**User decision:** Agent schemas and API schemas should be separate but related.

### Q21: Raw backend JSON or model-friendly JSON?

**Question:** Should tool output be raw backend JSON or normalized/summarized?

**Recommendation:** Return curated structured JSON, not prose. Trim noisy fields such as long telemetry arrays.

**User decision:** Curate and trim.

### Q22: Where should curation happen?

**Question:** Should trimming and curation happen in the webbackend `/tools/*` routes or in the shared tool package?

**Recommendation:** Curation should happen in the `/tools/*` routes because they are agent-facing and future Gateway-facing.

**User decision:** In the route itself.

### Q23: Local tool auth mode

**Initial Question:** Should local development use a static bearer token?

**Initial Recommendation:** Support `static-bearer`.

**User challenge:** There are AgentCore APIs to get workload access tokens locally:

- `GetWorkloadAccessTokenCommand`
- `GetWorkloadAccessTokenForJWTCommand`
- `GetWorkloadAccessTokenForUserIdCommand`

**Intermediate recommendation:** Use `GetWorkloadAccessTokenForJWTCommand`.

**User correction:** The architecture uses IAM inbound auth, not inbound JWT auth. The backend invokes runtime and supplies the user ID. Therefore local should use `GetWorkloadAccessTokenForUserIdCommand`.

**Code finding:** The installed `BedrockAgentCoreApp` does not forward all headers into `context.headers`. It only forwards:

- `authorization`
- headers beginning with `x-amzn-bedrock-agentcore-runtime-custom-`

It separately extracts `workloadaccesstoken` into `context.workloadAccessToken`.

**Final recommendation:** For local dev, use `GetWorkloadAccessTokenForUserIdCommand` with `PULSEFORGE_LOCAL_USER_ID` or `x-amzn-bedrock-agentcore-runtime-custom-user-id`. Document why this custom header exists.

**User decision:** Use a custom `x-amzn-bedrock-agentcore-runtime-custom-*` header locally and document why.

### Q24: Automatic auth mode detection or explicit env?

**Question:** Should the runtime choose credential mode automatically based on whether `context.workloadAccessToken` exists?

**Recommendation after user challenge:** Do not auto-detect. Use an explicit environment variable:

```txt
PULSEFORGE_TOOL_AUTH_MODE=agentcore-runtime | local-user-id
```

**User decision:** Yes.

### Q25: AgentCore Identity provider name

**Question:** What should the AgentCore Identity provider/resource credential provider be called?

**Recommendation:**

```txt
PULSEFORGE_TOOLS_PROVIDER_NAME=pulseforge-backend-user-federation
```

Default provider name:

```txt
pulseforge-backend-user-federation
```

**User decision:** Sure.

### Q26: Configure the credential provider in CDK?

**Question:** Should the AgentCore Identity credential provider be configured in CDK or documented as a manual setup step?

**Recommendation:** Configure it in CDK.

**User decision:** Configure the credential provider in CDK.

### Q27: Which Cognito app client should AgentCore Identity use?

**Question:** Should CDK create a separate Cognito app client specifically for AgentCore Identity delegated tool access?

**Initial Recommendation:** Create a separate client named `PulseForgeAgentIdentityClient`.

**User confusion:** The guide says create a Cognito app client, then configure it in AgentCore Identity. Why introduce another client?

**Correction:** There is no requirement for an additional client. The earlier `PulseForgeToolsClient` and proposed `PulseForgeAgentIdentityClient` are the same logical client. The recommendation is to rename/reframe the existing non-web client for clarity.

**User decision:** Rename it.

### Q28: Webbackend env var for accepted agent client IDs

**Question:** Should the webbackend env var be renamed from `COGNITO_TOOLS_CLIENT_IDS`?

**Recommendation:** Use:

```txt
COGNITO_AGENT_IDENTITY_CLIENT_IDS
```

No fallbacks are needed because this work has not shipped.

**User decision:** Yes, no fallbacks needed.

### Q29: OAuth callback wiring in CDK

**Question:** How should AgentCore Identity’s OAuth callback URL be handled in CDK?

**Recommendation:** Use lower-level CDK/L1/custom-resource code if needed. The Cognito app client callback URLs may need to include the AgentCore Identity provider callback URL, and the L2 client may not express that cleanly.

**User decision:** L1 is acceptable if necessary.

### Q30: Implementation slices

**Question:** Should the full AgentCore Identity provider be implemented immediately, or should work be staged?

**Recommendation:** Two slices on the same branch:

1. Tool framework and runtime wiring.
2. Identity infrastructure in CDK.

**User decision:** Tool framework first, identity infra after.

### Q31: Wire `ops-copilot` now or only scaffold?

**Question:** Should the first slice wire tools into the live `ops-copilot` runtime, or only create shared package and route scaffolding?

**Recommendation:** Wire `ops-copilot` end-to-end at the code level.

**User decision:** Wire it.

### Q32: Should write tools require confirmation?

**Question:** Should write tools require confirmation before execution?

**Recommendation:** Allow direct execution for:

- `create_incident_event`
- `create_ticket`
- `propose_remediation_action`

These create auditable records/proposals, not destructive device mutations.

**User decision:** They can write directly.

### Q33: First-class `auth_required` status?

**Question:** How should `auth_required` from inside a Strands tool call be represented?

**Recommendation:** Add `ToolAuthorizationRequiredError` in `@agent-core/pulseforge-tools`, catch it in runtime, yield an `auth_required` event, and add `auth_required` to `AgentRunStatus`.

**User decision:** Sounds good.

### Q34: Retry or resume after auth?

**Question:** Should `auth_required` runs be retried as a new `AgentRun`, or should the same `AgentRun` resume?

**Recommendation:** Retry as a new run, but reuse the same `sessionId`.

**User decision:** New run is fine; definitely reuse the same session ID.

### Q35: Retry endpoint or frontend-provided `sessionId`?

**Question:** Should webbackend automatically preserve the same `sessionId` when retrying, or should the frontend provide it explicitly?

**Recommendation:** Frontend can send the prior `sessionId` to `POST /api/agent-runs` for the first slice. A dedicated retry endpoint can come later.

**User decision:** Sounds good.

### Q36: Fail fast on missing tool env?

**Question:** What should runtime do if `ops-copilot` has tools configured but required env is missing?

**Recommendation:** Fail fast at runtime startup.

**User decision:** Yes, fail fast.

### Q37: Remove `IncidentInvestigationContext` entirely?

**Question:** Should `investigationContext` be removed from shared domain types completely, or only from runtime invocation?

**Recommendation:** Keep `IncidentInvestigationContext` for backend/tool route internals, but remove it from `AgentRuntimeInvocation`.

**User decision:** Sure.

### Q38: Split `/tools/*` files?

**Question:** Should the `/tools/*` zod-openapi sub-app live in one file or be split by concern?

**Recommendation:** Split now:

```txt
apps/webbackend/src/tools/
  app.ts
  auth.ts
  schemas.ts
  serializers.ts
```

**User decision:** Split it.

### Q39: Generic executor or per-tool executors?

**Question:** Should `@agent-core/pulseforge-tools` use one generic HTTP executor or individual hand-written executors?

**Recommendation:** Generic executor driven by per-tool definitions.

**User decision:** Generic.

### Q40: Behavior evals now?

**Question:** Should the first implementation include eval/test coverage asserting `ops-copilot` calls expected tools?

**Recommendation:** Defer behavior evals. Add mechanical tests now for schemas, HTTP mapping, auth/validation, curated responses, and typechecks.

**User decision:** Definitely defer evals. Get the basics working first.

### Q41: Implement now?

**Question:** Should the plan be implemented now on the current branch?

**Recommendation:** Yes. The plan is coherent enough to implement slice 1:

1. Add `@agent-core/pulseforge-tools`.
2. Split webbackend `/tools/*` into a zod-openapi sub-app.
3. Add `agentRunId` and `auth_required`.
4. Remove runtime `investigationContext` prompt injection.
5. Wire `ops-copilot` tools with explicit auth mode config.
6. Add tests, typechecks, and docs.

**User decision:** Proceed to implementation after this planning session.

## Why the Grill-Me Skill Helped

The session did not just produce a plan. It exposed and resolved hidden design forks:

- We corrected an overly simple `getAccessToken()` abstraction after inspecting the actual `withAccessToken` API.
- We avoided accidentally using the wrong local workload-token API by distinguishing IAM inbound runtime auth from JWT inbound auth.
- We caught the prompt-stuffing issue and changed the runtime so tools become the source of context.
- We clarified that Gateway is a migration path, not a dependency for the first implementation.
- We turned broad “reusable tools” intent into concrete package boundaries, file layout, naming, auth mode, error handling, and test strategy.
- We found SDK-specific local header behavior by reading installed runtime code.
- We separated code framework work from identity infrastructure work so implementation can proceed in safer slices.

## Resulting Implementation Plan

### Slice 1: Tool Framework and Runtime Wiring

- Add `shared/pulseforge-tools`.
- Define six `ops-copilot` tools.
- Use a generic HTTP executor.
- Add a `withAccessToken`-style credential provider interface.
- Add Strands adapters.
- Convert `/tools/*` to a mounted `OpenAPIHono` sub-app.
- Keep API schemas separate from agent schemas.
- Return curated structured JSON from tool routes.
- Add `agentRunId` to runtime invocation.
- Add `auth_required` status and event handling.
- Remove `investigationContext` from runtime invocation.
- Remove prompt-injected investigation context.
- Add per-agent system prompts.
- Wire tools only into `ops-copilot`.
- Fail fast on missing tool configuration.
- Add mechanical tests and typechecks.

### Slice 2: AgentCore Identity Infrastructure

- Rename `PulseForgeToolsClient` to `PulseForgeAgentIdentityClient`.
- Configure `AWS::BedrockAgentCore::OAuth2CredentialProvider` in CDK.
- Use Cognito as the OAuth provider.
- Add required callback URLs.
- Output `PulseForgeAgentIdentityClientId`.
- Use `COGNITO_AGENT_IDENTITY_CLIENT_IDS` in webbackend.
- Configure runtime env:

```txt
PULSEFORGE_TOOL_AUTH_MODE=agentcore-runtime
PULSEFORGE_TOOLS_PROVIDER_NAME=pulseforge-backend-user-federation
```

- Configure local env:

```txt
PULSEFORGE_TOOL_AUTH_MODE=local-user-id
PULSEFORGE_WORKLOAD_NAME=<agentcore-workload-name>
PULSEFORGE_LOCAL_USER_ID=<cognito-sub>
```

- Document local custom header:

```txt
x-amzn-bedrock-agentcore-runtime-custom-user-id: <cognito-sub>
```

## Deferred Follow-Ups

- Full stream/poll OAuth completion flow instead of `auth_required` plus retry.
- Agent behavior evals that assert expected tool-call trajectories.
- Dedicated retry endpoint that reuses prior `sessionId`, prompt, IDs, and agent kind.
- AgentCore Gateway integration or OpenAPI export from `/tools/*`.
- More careful search/list tools after tenant/resource permission modeling exists.
- Approval workflow for destructive tools that mutate real devices.
