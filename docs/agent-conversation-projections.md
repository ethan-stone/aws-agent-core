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

- `AgentRun.id` as `agentRunId`
- `Conversation.rootAgentKind` as `agentKind`
- the current user input as `prompt`
- optional incident/device ids
- optional domain context such as `IncidentInvestigationContext`
- the authenticated user id as `actorId`

The backend also passes `RuntimeSession.providerSessionId` to AWS AgentCore as
the provider `runtimeSessionId`. That is how multiple root runs in one
conversation share the same provider-side short-term memory session.

## Agent Output Projection

The runtime emits `AgentRuntimeStreamEvent` SSE events.

The backend does not store those events directly. It maps them into:

- `message` -> `MessageRunItem`
- `tool_call` -> `ToolCallRunItem`
- `tool_result` -> `ToolResultRunItem`
- `auth_required` -> `RequiredActionRunItem` plus `AgentRun.authRequired`
- `action_resolution` -> `ActionResolutionRunItem`
- `run_agent` -> `RunAgentRunItem`
- `run_note` -> `RunNoteRunItem`
- `summary` -> denormalized `AgentRun.summary` / `AgentRun.investigation`

## AgentCore Memory

AgentCore short-term memory is the agent-facing projection/cache, not the
product timeline.

The runtime loads AgentCore memory events into Strands `Message[]` before an
agent invocation and saves final `agent.messages` back after the invocation.
Those messages are what the agent uses for conversational continuity. They are
keyed by:

- `actorId`
- `RuntimeSession.providerSessionId` as the AgentCore session id

AgentCore long-term memory is retrieved context. It is keyed by `actorId` and,
for session summaries, the same provider session id. It is not a transcript and
is not rendered as conversation history.

If AgentCore memory is deleted, expires, or moves providers, the product
timeline still exists in `RunItems`. Reconstructing a model-ready prompt from
`RunItems` is a separate future projection and is not implemented in this PR.
