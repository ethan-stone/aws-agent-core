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

## Conventions

- Use `tsx` (not `ts-node`) for running TypeScript in apps.
- Shared packages use the `@agent-core/` npm scope.
- Apps depend on shared packages via `workspace:*`.
- All packages extend `tsconfig.base.json` at the repo root.
