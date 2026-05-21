# PulseForge Agent Tools Cleanup Plan

## Summary

Clean up the current working spike into a coherent architecture: separate the webbackend and agent-facing tools API, extract shared backend infrastructure, normalize delegated tool authorization so `ops-copilot` prompts once per provider scope group, and simplify local/dev/deployed configuration. Keep the working AgentCore auth flow intact while reducing duplication, stale routes, and script/config confusion.

## Key Changes

- Create `apps/tools-api` as its own deployable app with its own package, env examples, dev script, Lambda entrypoint, Hono/OpenAPI routes, and tests.
- Extract shared backend infrastructure into `shared/pulseforge-backend`: Mongo/in-memory repositories, storage setup, seed logic, auth verification helpers, and PulseForge domain service functions.
- Keep `apps/webbackend` focused on UI-facing routes and AgentCore runtime invocation/streaming.
- Remove webbackend `/tools` compatibility routes and remove `/api/ping`.
- Keep public `/api/auth/config` for SPA auth bootstrap.
- Tools API exposes no `/ping`; expose unauthenticated `/openapi.json`.

## Tool Auth And Agent Runtime

- Add immutable typed credential provider descriptors in `shared/pulseforge-tools`; tool definitions reference provider descriptors plus per-tool `requiredScopes`.
- Move agent-to-tool bundle composition into `shared/pulseforge-agent`; keep primitive tool definitions in `shared/pulseforge-tools`.
- Compute tool authorization groups per agent bundle by provider descriptor, using the union of scopes required by tools in that provider group.
- For `ops-copilot`, request one lazy bundle-level delegated grant for all PulseForge read/write scopes.
- Do not add custom token caching; rely on AgentCore Identity reuse once scope sets are normalized.
- Keep per-route tools API scope enforcement narrower than the bundle grant.
- Every tool route must require `x-pulseforge-agent-run-id`, validate the run belongs to the delegated user, and audit verified tool actions as `actorType: "agent"` with `actorId`, `onBehalfOfUserId`, and `agentRunId`.
- Keep `auth_required` and `error` as the only special structured runtime stream events for now.
- Raw errors go to structured logs; UI/model-facing errors stay friendly and safe.
- UI must not auto-open authorization URLs.
- Show an explicit authorization CTA and keep the run in a resumable `auth_required`/waiting state while AgentCore polls.
- Surface the full provider-group scopes being requested.

## Configuration, Scripts, And CDK

- Introduce `PULSEFORGE_RUNTIME_ENV=local|aws`, defaulting to `local`; CDK sets `aws`.
- Local Node entrypoints load their own `.env.local`/`.env` with explicit `dotenv.config({ path })`.
- Shared packages do not call dotenv.
- Deployed Lambda config comes from CDK env vars.
- Deployed Mongo URI comes from pre-created Secrets Manager secret `pulseforge-secrets` with documented required key `mongodbUri`.
- Standardize root scripts: recursive `build` and `test`, separate dev commands for Mongo, agent, webbackend, tools-api, and webapp.
- Remove deprecated script aliases.
- Rename seed to `pulseforge:seed`, local-only by default.
- Remove Jest/CDK tests and Jest dependencies/config.
- Use package tests recursively.
- CDK cleanup is structural but conservative: organize the stack by domains, reduce duplicated scope/client/API/Lambda boilerplate, keep auth-related logical IDs stable, keep the Cognito callback custom resource, scope its IAM policy down, and extract observability setup without changing behavior.
- CDK keeps explicit Cognito scope/provider configuration; do not import shared tool descriptors into CDK.
- CDK injects the generated tools API URL into the agent runtime and continues outputting the webbackend API URL for local webapp config.

## Tests

- Add unit tests for provider descriptor grouping: `ops-copilot` produces one PulseForge provider auth group with the union of all bundle scopes, while tools retain their individual required scopes.
- Add tools API tests for JWT client separation, required scopes, required `x-pulseforge-agent-run-id`, delegated user/run ownership, and audit behavior for verified actions.
- Preserve/adjust webbackend integration tests for agent stream events, auth callback completion, and removal of stale routes.
- Verify local/deployed config parsing paths, including local dotenv loading and AWS-mode no-dotenv behavior.
- Run `pnpm run build`, `pnpm run test`, and `pnpm run cdk synth`.

## Assumptions And TODOs

- Tools API remains public behind Cognito JWT auth for this POC; add TODO for WAF/rate limits/custom domain/private networking review.
- Domain/tenant/resource-level authorization is a future business-logic layer inside tools, beyond current scope + run ownership checks.
- High-risk/write action explicit approval is a future TODO, possibly using AgentCore `forceAuthentication` or a separate approval flow.
- Deployed database seeding is a future explicit command with guardrails; current `pulseforge:seed` is local-only.
