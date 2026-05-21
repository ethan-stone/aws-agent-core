---
name: pulseforge-local-agent
description: Invoke the local PulseForge AgentCore runtime from this repo using the packaged local invocation script. Use when testing, smoke-testing, or invoking the local PulseForge agent/runtime, especially with a Cognito user id.
compatibility: Designed for Codex in the aws-agent-core workspace; requires pnpm and a running local PulseForge AgentCore runtime.
---

# PulseForge Local Agent

Use this skill when invoking the local PulseForge AgentCore runtime in this repo.

## Command

Run from the repo root:

```bash
pnpm agent:invoke:local -- --user-id <cognito-user-sub>
```

The script generates a random `agentRunId` and `runtimeSessionId`, sends the required SSE headers, and prints streamed events.

## Common Options

```bash
pnpm agent:invoke:local -- \
  --user-id <cognito-user-sub> \
  --incident-id inc-1001 \
  --prompt "Investigate incident inc-1001"
```

Optional flags:

- `--incident-id <id>`
- `--device-id <id>`
- `--prompt <text>`
- `--agent-kind <kind>` defaults to `ops-copilot`
- `--base-url <url>` defaults to `http://localhost:8080`

## Preconditions

- Start the runtime first with `pnpm agent:dev:local`.
- For tool-enabled local runs, `apps/pulseforge-agent-runtime/.env.local` should include `PULSEFORGE_BACKEND_URL`, `PULSEFORGE_TOOL_AUTH_MODE=local-user-id`, `PULSEFORGE_WORKLOAD_NAME`, AWS region/profile, and either `PULSEFORGE_LOCAL_USER_ID` or the `--user-id` flag.
- If the runtime cannot load AWS credentials, verify the runtime env file is being loaded and the named `AWS_PROFILE` works locally.
