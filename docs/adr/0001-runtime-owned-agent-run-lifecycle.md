# ADR 0001: Runtime-Owned Agent Run Lifecycle

Date: 2026-05-27

## Status

Implemented

## Context

PulseForge stores product history in the domain database:

- `Conversation`
- `RuntimeSession`
- `AgentRun`
- `RunItem`
- `PendingInput`

The current browser flow creates an `AgentRun` in webbackend, invokes the
AgentCore runtime, collects runtime SSE events, and maps those events into
canonical `RunItem`s in `runtime-output-projection.ts`.

That makes webbackend the effective lifecycle owner even though the activity
being persisted happens inside the runtime. It works for webbackend-initiated
runs, but any future direct runtime caller would need to duplicate the same
projection and persistence behavior for tool calls, tool results, required
actions, action resolutions, run notes, summaries, and approval-grant usage.

The model itself must not own persistence. The ownership boundary is the
runtime scaffolding around the model and tools.

## Decision

Runtime lifecycle scaffolding owns canonical lifecycle writes for the
`AgentRun` it is executing.

Webbackend remains responsible for:

- app authentication and authorization
- creating or claiming the `Conversation`
- creating or claiming the root `AgentRun`
- creating or resolving the `RuntimeSession`
- invoking the runtime with the canonical ids
- serving UI read models from domain storage

The runtime invocation contract includes the ids needed to persist lifecycle
activity:

- `conversationId`
- `agentRunId`
- `runtimeSessionId`
- `providerSessionId`
- actor/user identity as `actorId`

The runtime lifecycle owner records:

- agent messages
- tool calls
- tool results
- required actions
- action resolutions
- run-agent coordination records
- run notes
- final run status, summaries, and investigation summaries
- conversation-scoped tool approval grant reads and writes when that domain
  model is implemented

SSE events remain useful as a streaming projection for UI updates, but they are
not the canonical persistence API.

## Consequences

The deployed runtime needs access to the product database or a narrow
persistence service that writes the same domain model. If it imports
`@agent-core/pulseforge-backend` directly, the runtime image must package that
workspace package and receive the same MongoDB/secrets configuration as
webbackend and tools-api.

Only one component may append lifecycle-owned `RunItem`s for a run. Webbackend
does not reconstruct non-user `RunItem`s from runtime SSE events.

The UI read model does not change. It continues to read `ConversationDetail`
from domain storage.

The runtime is now the natural place to enforce reusable
`ToolApprovalGrant`s, because approval decisions are checked around tool
execution and approval reuse should be recorded as `RunNote`s in the same
active `AgentRun`.

## Implementation Notes

- `AgentRuntimeInvocation` passes `conversationId`, `agentRunId`,
  `runtimeSessionId`, and `providerSessionId`.
- `AgentRunLifecycle` in the runtime persists messages, tool activity,
  required actions, action resolutions, run notes, failures, and completion.
- Webbackend still creates the root `AgentRun` and the user-message
  `RunItem`, then invokes the runtime.
- Webbackend streams fresh `ConversationDetail` snapshots when runtime progress
  SSE events arrive, but does not map those SSE events into `RunItem`s.
- The deployed runtime receives PulseForge MongoDB/secrets configuration and
  can use `@agent-core/pulseforge-backend`.

## Open Questions

- Should runtime import `@agent-core/pulseforge-backend` directly, or should a
  smaller persistence contract package sit between runtime and storage?
- Should root `AgentRun` creation remain in webbackend permanently, or should
  runtime be able to create a run for non-web callers?
- How should interruption and resume snapshots be represented once runtime
  owns lifecycle persistence?
- Should runtime lifecycle writes be idempotent by event id, append id, or
  caller-provided sequence if an invocation is retried?
