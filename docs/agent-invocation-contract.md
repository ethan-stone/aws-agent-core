# Agent Invocation Contract

PulseForge agent runtimes host one or more AgentKinds. AgentKind is the product
identity of the agent; runtime deployment is the infrastructure location that
executes it.

This contract is intentionally centered on the two primary invocation families:

- operator-initiated agent work, such as an operator asking `ops-copilot` for
  help from the app
- background incident automation, such as an `incident-responder` run started
  after an incident is created

Other invocation families should fit this shape before adding a new top-level
mode.

## Contract Goals

- Let one deployed runtime host multiple AgentKinds safely.
- Make invalid invocation combinations unrepresentable or rejected early.
- Keep continued and resumed runs bound to the persisted Conversation,
  AgentRun, and RuntimeSession records.
- Validate the trigger/input shape against the selected AgentKind.
- Keep runtime deployment routing outside the domain model.

## Invocation Envelope

Runtime requests should move toward a versioned discriminated envelope:

```ts
type AgentRuntimeInvocationV2 =
  | StartAgentRunInvocation
  | ResumeRequiredActionInvocation;

interface InvocationBase {
  version: "2026-05-28";
  conversationId: string;
  agentRunId: string;
  runtimeSessionId?: string;
  providerSessionId?: string;
  actor: InvocationActor;
}

type InvocationActor =
  | { type: "user"; userId: string }
  | { type: "system"; systemId: string };

interface StartAgentRunInvocation extends InvocationBase {
  operation: "start_agent_run";
  agentKind: AgentKind;
  trigger:
    | OperatorPromptTrigger
    | IncidentCreatedTrigger
    | IncidentAgentMentionTrigger;
}

interface ResumeRequiredActionInvocation extends InvocationBase {
  operation: "resume_required_action";
  requiredActionId: string;
  response: {
    approved: boolean;
    decision?: "allow_once" | "allow_always" | "decline";
    comment?: string;
    resolvedByUserId?: string;
  };
}

interface OperatorPromptTrigger {
  type: "operator_prompt";
  prompt: string;
  incidentId?: string;
  deviceId?: string;
}

interface IncidentCreatedTrigger {
  type: "incident_created";
  incidentId: string;
}

interface IncidentAgentMentionTrigger {
  type: "incident_agent_mention";
  incidentId: string;
  incidentActivityId: string;
  prompt: string;
}
```

The current `AgentRuntimeInvocation` is this discriminated envelope. Browser
API request shapes can stay stable while webbackend translates them into the
runtime contract.

## AgentKind Contracts

Each AgentKind should declare the invocation triggers it accepts, required
context, tool bundle, and projection behavior.

```ts
interface PulseForgeAgentContract {
  kind: AgentKind;
  label: string;
  allowedTriggers: readonly AgentInvocationTriggerType[];
  requiredContext: readonly AgentInvocationContextRequirement[];
  toolNames: readonly PulseForgeToolName[];
  projectsRequiredActionsToIncidentActivity: boolean;
}
```

Initial contracts:

| AgentKind | Allowed triggers | Required context | Notes |
| --- | --- | --- | --- |
| `ops-copilot` | `operator_prompt`, `incident_agent_mention` | prompt; incident/device optional for direct prompts; incident required for mentions | Interactive operator-facing agent. May create incident activity when invoked from an incident. |
| `incident-responder` | `incident_created` | incident id | Background incident automation. Projects incident-tied required actions as IncidentApprovalRequests. |

## Validation Rules

The runtime should validate both payload shape and persisted-record invariants.

- `agentRunId` must resolve to an AgentRun.
- `conversationId` must resolve to a Conversation.
- `AgentRun.conversationId` must equal the payload `conversationId`.
- For root runs, `Conversation.rootAgentKind` must equal `AgentRun.agentKind`.
- For start invocations, payload `agentKind` must equal `AgentRun.agentKind`.
- For resume invocations, `agentKind` is derived from `AgentRun.agentKind`, not
  accepted from the caller.
- `runtimeSessionId`, when provided, must belong to the same Conversation.
- `providerSessionId`, when provided, must match the persisted RuntimeSession.
- The trigger type must be allowed by the AgentKind contract.
- Required trigger context must be present before the agent is instantiated.

The webbackend already enforces part of this by deriving the AgentKind from the
Conversation when continuing a Conversation. The runtime should still enforce
these invariants defensively because background consumers or future callers may
invoke it directly.

## Runtime Routing

Runtime routing is infrastructure, not domain state. The first implementation
can route every AgentKind to the same AgentCore runtime ARN and qualifier.

Later, a deployment registry can map AgentKinds to separate runtimes:

```ts
interface AgentRuntimeRoute {
  agentKind: AgentKind;
  runtimeArn: string;
  qualifier: string;
}
```

Splitting an AgentKind into its own runtime should not require changing
Conversation, AgentRun, RunItem, or IncidentActivity records.

## Incident Projection

Agent lifecycle records remain canonical for agent work. IncidentActivity is a
shared operational projection.

For incident-tied runs, required actions can be projected as
IncidentApprovalRequests when the AgentKind contract enables it. Resolving that
incident approval resolves the underlying RequiredAction and resumes the
AgentRun. Personal ToolApprovalGrants remain user-scoped and should not be
created by default from shared incident approvals.
