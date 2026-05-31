# Agent Conversation Projections

The PulseForge domain database is the product source of truth for agent
conversation activity. The UI and the agent runtime both consume projections of
that domain model.

## Canonical Records

The canonical records are:

- `Conversation`: stable root-agent thread.
- `RuntimeSession`: provider state linked to a conversation, such as an AWS
  AgentCore `runtimeSessionId`.
- `AgentRun`: one call to run an agent.
- `RunItem`: ordered, append-only activity owned by an `AgentRun`.
- `PendingInput`: accepted root-conversation input that has not been consumed.
- `ToolApprovalGrant`: conversation-scoped saved approval for future matching
  approval-required tool calls by the same operator.

Do not treat client messages, Strands messages, runtime SSE events, or
AgentCore memory events as canonical product history. Those are projections or
provider implementation state.

## UI Projection

The web app consumes `ConversationDetail`.

`ConversationDetail` is assembled by the backend from:

- the `Conversation`
- all `AgentRuns` for the conversation
- all `RunItems` grouped by run id
- all `RuntimeSessions` for the conversation

The UI renders messages, tool activity, required actions, summaries, errors,
and run metadata from this read model. The read model is not stored as a
separate durable transcript; it can be rebuilt from the canonical collections.

Current endpoints:

- `POST /api/conversations`
- `POST /api/conversations/:conversationId/runs`
- `GET /api/conversations/:conversationId`

## Agent Input Projection

The backend invokes the runtime with `AgentRuntimeInvocation`.

That invocation is built from:

- `Conversation.id` as `conversationId`
- `AgentRun.id` as `agentRunId`
- `RuntimeSession.id` as `runtimeSessionId`
- `RuntimeSession.providerSessionId` as `providerSessionId`
- `Conversation.rootAgentKind` as `agentKind`
- the current user input as `prompt`
- optional incident/device ids
- the authenticated user id as `actorId`

The backend does not prehydrate investigation context into the runtime payload
or rewrite the user's prompt. When the invocation includes incident or device
ids, the agent should retrieve the needed operational context through its tools.

The backend also passes `RuntimeSession.providerSessionId` to AWS AgentCore as
the provider `runtimeSessionId`. That is how multiple root runs in one
conversation share the same provider-side short-term memory session.

## Agent Lifecycle Projection

The runtime owns canonical lifecycle writes for the `AgentRun` it is executing.
The model does not own persistence; the runtime scaffolding around the model
and tools does.

Runtime lifecycle scaffolding records:

- `message` -> `MessageRunItem`
- `tool_call` -> `ToolCallRunItem`
- `tool_result` -> `ToolResultRunItem`
- `auth_required` -> `RequiredActionRunItem` plus `AgentRun.authRequired`
- `required_action` -> `RequiredActionRunItem`
- `action_resolution` -> `ActionResolutionRunItem`
- `run_agent` -> `RunAgentRunItem`
- `run_note` -> `RunNoteRunItem`
- `summary` -> denormalized `AgentRun.summary` / `AgentRun.investigation`

Human approval interrupts are represented as `required_action` items with
`actionType: "tool_approval"`. Runtime lifecycle scaffolding externalizes the
Strands interrupt snapshot into an `AgentRunSnapshot` record and stores only the
snapshot reference plus interrupt id on the required action. The client-facing
`ConversationDetail` redacts that internal resume reference. When an operator
approves or declines, the web backend loads the snapshot by reference and
invokes the runtime with an interrupt response for the same `AgentRun`.

Tool approval resolutions carry `decision: "allow_once" | "allow_always" |
"decline"` in action-specific resolution data. `allow_once` resolves only the
interrupted tool call. `allow_always` creates or reuses a `ToolApprovalGrant`
embedded on the open `Conversation`, keyed by the granting operator,
`toolName`, and the tool-owned `approvalKey`. Future matching tool calls skip
the required action and record `run_note` activity with
`noteType: "tool_approval_grant_used"`.

The runtime also emits `AgentRuntimeStreamEvent` SSE events as a streaming UI
projection. Webbackend does not reconstruct canonical product history from SSE;
it refreshes and streams `ConversationDetail` snapshots from domain storage as
runtime progress events arrive.

## AgentCore Memory

AgentCore short-term memory is the agent-facing projection/cache, not the
product timeline.

The runtime installs Strands `SessionManager` for conversational continuity. In
deployed runtimes, the session manager uses PulseForge's AgentCore-backed
`SnapshotStorage`; locally, it falls back to an in-process snapshot store. The
storage saves the latest Strands session snapshot after each invocation as a
replacement current-state projection, then restores that snapshot when the same
runtime session is invoked again. The runtime does not seed model-visible
message history from canonical product `RunItems`; short-term continuity should
come from the restored Strands session snapshot.
Snapshot events are keyed by:

- `actorId`
- `RuntimeSession.providerSessionId` as the AgentCore session id
- Strands snapshot `scope` and `scopeId` metadata

The event payload is the Strands snapshot, not a PulseForge-specific message
blob, and stale "latest" snapshot events are removed after replacement. Durable
human-approval resume snapshots are separate `AgentRunSnapshot` product records;
they are not the rolling short-term session snapshot.

AgentCore long-term memory is retrieved context. It is keyed by `actorId` and,
for session summaries, the same provider session id. It is not a transcript and
is not rendered as conversation history.

If AgentCore memory is deleted, expires, or moves providers, the product
timeline still exists in `RunItems`, but the runtime does not automatically
reconstruct model context from that product history.
