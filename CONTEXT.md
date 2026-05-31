# PulseForge

PulseForge supports AI-assisted IoT fleet operations by coordinating operator conversations, agent execution, incident investigation, and remediation workflows.

## Language

**Conversation**:
A long-lived interaction thread between one ordinary human interactor, a stable root agent, and the system. A **Conversation** provides continuity across related **AgentRuns**, has at most one active root **AgentRun** at a time, and does not own a separate item list; its timeline is projected from root **AgentRuns**.
_Avoid_: Session, chat, transcript, shared room

**ConversationInteractionMode**:
The rule that determines whether ordinary human follow-up messages can be added to a **Conversation**. Interactive conversations accept ordinary follow-up from their interaction owner; observe-only conversations can be inspected and may allow eligible **RequiredAction** resolution without accepting ordinary follow-up messages.
_Avoid_: Permission, status, AgentRunStatus

**ConversationInteractionOwner**:
The operator who owns ordinary follow-up interaction with an interactive **Conversation**. For a mention-created incident-linked **Conversation**, the **ConversationInteractionOwner** is the author of the **IncidentAgentMention**.
_Avoid_: Viewer, approver, participant

**AgentKind**:
The configured identity of an agent that can run work, including its purpose and configuration. PulseForge uses **ops-copilot** for general operator assistance and **incident-responder** for incident response workflow; a **Conversation** is bound to one root **AgentKind** for its lifetime, while delegated child **AgentRuns** may use other agent kinds.
_Avoid_: AgentProfile, broad category, model, anomaly-investigation, remediation-planner, autonomous-remediation

**AgentRun**:
A single execution attempt by an agent within a **Conversation**, corresponding to one call to run that agent. An **AgentRun** owns ordered **RunItems** and may have one parent **AgentRun** when it is caused by multi-agent orchestration.
_Avoid_: Conversation, session, invocation

**RuntimeSession**:
A provider-level execution context that preserves runtime state across related **AgentRuns**. A **RuntimeSession** is identified by provider, runtime identity, and provider session id, and an **AgentRun** only links to one when it owns or targets provider runtime state directly.
_Avoid_: Conversation, AgentRun, chat session

**AgentConversationStorage**:
The backend Module used by agent lifecycle code to persist and read **Conversation**, **AgentRun**, **RunItem**, and **RuntimeSession** records. Call sites use this Module explicitly so storage operations are distinguishable from local lifecycle behavior.
_Avoid_: Unqualified repository verb imports, local helper names that hide storage access

**RunItem**:
An ordered domain record emitted, consumed, or observed during an **AgentRun**. **RunItems** are append-only by default; rare exceptions update current status on long-running items such as required actions or coordinated agent runs.
_Avoid_: ConversationItem, Message when referring to non-text interaction artifacts

**RunItemSource**:
The provenance of a **RunItem**, identifying whether it came from a user, agent, system, tool, or external service. **RunItemSource** answers who or what produced the item without deciding how the item should be rendered.
_Avoid_: Visibility, role

**Message**:
A **RunItem** whose primary purpose is conveying semantic content from a user, agent, or system. A **Message** may contain multimodal content blocks, and tool output is represented by **ToolResult** rather than a message role.
_Avoid_: Event, item, action

**PendingInput**:
User input accepted by the system while a **Conversation** already has an active root **AgentRun**, but not yet consumed into that run's ordered **RunItems**. **PendingInput** belongs to the root conversation only and becomes a **Message** only when the active root agent loop accepts it at an appropriate point.
_Avoid_: Message, queued AgentRun, draft

**RequiredAction**:
A **RunItem** that records external input needed before an **AgentRun** can continue or finish. A **RequiredAction** can be resolved inside the same active **AgentRun**, is pending until it is resolved, declined, expired, or cancelled, and distinguishes specific needs, such as authorization or human approval, by action type.
_Avoid_: Message, prompt, interruption

**ToolApprovalGrant**:
A durable operator decision created from an "allow always" **ActionResolution**, allowing future matching approval-required **ToolCalls** by that operator in the same open **Conversation** to proceed without creating a new **RequiredAction**. A **ToolApprovalGrant** belongs to the operator who granted it, matches a tool-defined **ApprovalKey**, stores only the approval label needed to explain the future-action approval, does not expire independently of its **Conversation**, and does not grant general app, runtime, or delegated-user authorization.
_Avoid_: Permission, OAuth grant, blanket approval, policy

**ApprovalKey**:
A deterministic scope key produced by an approval-required tool to identify exactly which future **ToolCalls** can reuse a **ToolApprovalGrant**. An **ApprovalKey** is opaque to the **Conversation** model; the tool owns its shape and must keep it narrow enough for the operator's approval to remain meaningful.
_Avoid_: Resource id, permission string, model-provided key

**ActionResolution**:
A **RunItem** that records the outcome of a **RequiredAction** at the point it becomes known to an **AgentRun**. Resolving an action updates the **RequiredAction** state and appends an **ActionResolution** so the timeline remains auditable.
_Avoid_: RequiredAction, status update

**RunAgent**:
A **RunItem** that records an **AgentRun** causing or coordinating another agent to run. The resulting **AgentRun** has its own **RunItems**, one parent run, and a relationship that records whether the agent ran as a tool, handoff, graph node, workflow step, or another orchestration pattern.
_Avoid_: Tool call when the delegated worker is an agent, SubAgent when the relationship is not strictly hierarchical

**ToolCall**:
A **RunItem** that records an agent asking to use a tool. When the tool is another agent, the **ToolCall** is linked to a **RunAgent** item so the model-facing tool transcript and the agent run trace remain connected.
_Avoid_: RunAgent

**ToolResult**:
A **RunItem** that records the result returned from a **ToolCall**. For agent-as-tool orchestration, the **ToolResult** may contain only the child agent's final result while the child **AgentRun** preserves the detailed trace.
_Avoid_: Message, RunAgent

**RunNote**:
A **RunItem** that records operational activity in an **AgentRun** without treating it as semantic message content. **RunNote** is for traceability and diagnostics, including saved **ToolApprovalGrant** use, while system messages are for semantic content the run should remember or expose.
_Avoid_: Message, system prompt

**IncidentComment**:
A human-authored discussion item on an **Incident**. **IncidentComments** form the shared operator collaboration thread and are distinct from private **Conversation** messages.
_Avoid_: IncidentEvent, Message, activity

**IncidentActivity**:
A system-authored or agent-authored timeline item on an **Incident**. **IncidentActivity** records notable operational facts, agent progress, outcomes, and linked agent-conversation cards without treating them as human discussion.
_Avoid_: IncidentEvent, comment, Conversation item

**IncidentActivity Projection**:
The high-signal incident-facing record of an incident-linked **Conversation**, including start, blocking approvals, authorization waits, completion, failure, and cancellation. **IncidentActivity Projection** does not mirror every **RunItem**; detailed agent trace remains in the linked **Conversation**.
_Avoid_: Full transcript mirror, tool trace mirror

**IncidentAgentActivityStatus**:
The incident-facing lifecycle state of a linked agent-conversation card, such as queued, running, waiting for approval, waiting for authorization, completed, failed, or cancelled. **IncidentAgentActivityStatus** is operator-facing incident language, not necessarily the same vocabulary as **AgentRunStatus**.
_Avoid_: Raw AgentRunStatus when describing incident activity

**IncidentAgentMention**:
An actionable request embedded in an **IncidentComment** that asks an **AgentKind** to respond in incident context. An **IncidentComment** has at most one actionable **IncidentAgentMention**; when accepted, it starts a new incident-linked **Conversation** owned for ordinary follow-up by the mention author.
_Avoid_: Parsed text only, command, slash command, multiple actionable mentions in one comment

**AgentMentionHandle**:
A user-facing mention token in an **IncidentComment** that resolves to a user-invokable **AgentKind**. **@copilot** resolves to **ops-copilot**, while specialist **AgentKinds** such as **incident-responder** are invoked by automation or agent orchestration rather than by direct user mention.
_Avoid_: AgentKind, display name

**IncidentCreated Trigger**:
An automatic incident lifecycle trigger that may start an observe-only **incident-responder** **Conversation** linked to the **Incident** when incident automation is enabled. The trigger records what the agent did on the incident surface without creating an ordinary human chat.
_Avoid_: User prompt, mention

**IncidentAgentMention Trigger**:
A human-authored trigger created from an **IncidentAgentMention**. The trigger starts a new interactive incident-linked **Conversation** for **ops-copilot**, owned for ordinary follow-up by the mention author.
_Avoid_: IncidentCreated Trigger, shared chat message

**Incident-linked Conversation**:
A **Conversation** caused by an incident trigger or **IncidentAgentMention** and reachable from the **Incident** collaboration surface. An **Incident-linked Conversation** is still a separate agent interaction thread, not the incident thread itself; the **Incident** remains the multi-user collaboration surface.
_Avoid_: Incident thread, shared incident chat

**Observe-only Conversation**:
An incident-linked **Conversation** created by automation rather than by an ordinary human interactor. Operators may inspect an **Observe-only Conversation** and resolve eligible **RequiredActions**, but they do not send ordinary follow-up messages into it.
_Avoid_: Shared chat, bot thread

**IncidentActionApproval**:
An incident-scoped request for an authorized operator to approve or decline an operational action proposed by an observe-only incident automation **Conversation**. An **IncidentActionApproval** links the shared **Incident** collaboration surface to the underlying **RequiredAction** in the agent lifecycle.
_Avoid_: IncidentApprovalRequest, RequiredAction, ToolApprovalGrant

## Example Dialogue

Dev: "The operator asked the copilot to investigate the freezer incident, then approved a follow-up remediation."

Domain Expert: "That is one Conversation. The investigation pass and the remediation pass are separate AgentRuns inside it."

Dev: "The agent asked for approval before rebooting a gateway. Is that a message?"

Domain Expert: "It belongs in the AgentRun as a RunItem, but it is a RequiredAction rather than a Message."

Dev: "Codex ran a CI-inspection agent. Does that agent write into the same timeline?"

Domain Expert: "The coordinating AgentRun gets a RunAgent item. The resulting AgentRun has its own RunItems, and the relationship says whether it was a tool-style call, handoff, graph node, or workflow step."

Dev: "The operator typed another instruction while the agent was waiting on a tool. Is that already a message?"

Domain Expert: "Only after the backend accepts and the agent loop consumes it. Until consumption, accepted input is PendingInput."
