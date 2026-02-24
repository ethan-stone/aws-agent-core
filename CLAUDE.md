# Agent Core

Monorepo using pnpm workspaces.

## Structure

- `apps/` - Individual application projects
- `apps/scripts/` - Utility scripts for interacting with deployed resources
- `shared/` - Shared packages consumed by apps

## Scripts (`pnpm --filter @agent-core/scripts <command>`)

- `invoke-agent` - Invoke a deployed Bedrock AgentCore runtime
  - `--agent-runtime-arn <arn>` (required) - ARN of the deployed agent runtime
  - `--prompt <prompt>` (required) - Prompt to send to the agent
  - `--profile <name>` (optional) - AWS profile to use; defaults to the standard credential chain
  - `--session-id <id>` (optional) - Session ID for the invocation; defaults to a random UUID

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
