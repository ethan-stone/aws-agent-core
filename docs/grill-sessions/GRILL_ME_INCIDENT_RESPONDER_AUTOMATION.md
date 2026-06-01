# Grill-Me Session: Automatic Incident Responder

This document captures decisions and future notes from the design grilling
session for automatic **incident-responder** runs, especially the boundary
between action approval and tool credentials.

## Decisions So Far

- Keep human action approval and tool credentials as separate gates.
- Use **IncidentActionApproval** for one-time approval of non-read-only actions
  proposed by observe-only **incident-responder** automation.
- Do not use **IncidentActionApproval** to create reusable approval grants.
- Never allow `allow_always` for observe-only **incident-responder** runs.
- Observe-only **incident-responder** approval UI should offer only approve once
  and decline. Webbackend should reject `allow_always` for these runs, and the
  runtime/lifecycle layer should also treat `allow_always` in this context as
  invalid.
- Allow approval policy to vary by agent and interaction context.
- Treat risk as metadata, separate from **ToolApprovalPolicy**.
- Use AgentCore Identity `withAccessToken` with the M2M auth flow as the
  **IncidentAutomationCredential** for approved background tool execution
  instead of waiting for an operator OAuth flow.
- Select the tool credential flow from **ConversationInteractionMode** rather
  than **AgentKind**: interactive user-triggered conversations use
  `USER_FEDERATION`, while observe-only background conversations use M2M.
- Project approval-required tool calls to **IncidentActionApproval** for
  observe-only incident-linked conversations, not by hard-coding a specific
  **AgentKind**. Interactive conversations keep the normal conversation
  **RequiredAction** flow.
- Initial observe-only tool policy:
  - `get_incident_context`, `get_device`, and `get_device_telemetry` are
    read-only and do not require approval.
  - `create_incident_activity` is allowed without approval because it records
    agent findings rather than causing an operational side effect.
  - `propose_remediation_action` is allowed without approval because it records
    a proposal rather than executing remediation.
  - `create_ticket` requires one-time **IncidentActionApproval** because it can
    create external or organizational work.
  - `reset_device` requires one-time **IncidentActionApproval** because it is an
    operational device command.
- Trigger automatic incident response from a simple scheduled worker that scans
  for incidents needing automation, rather than coupling agent orchestration
  directly into incident creation or device simulation.
- An incident needs automation when it is unresolved and has no observe-only
  incident-linked **Conversation** yet. This makes the scheduled worker
  idempotent without adding a separate processed flag.
- The first implementation should catch up all unresolved incidents that do not
  already have observe-only automation, including incidents created before the
  worker started.
- The scheduled worker should process a small batch synchronously on each tick,
  consuming each runtime stream until the run completes, fails, or blocks on a
  durable approval.
- Runtime approval flow is the enforcement point for approved tool execution in
  the first implementation; tools API does not re-check matching
  **IncidentActionApproval** before executing the write.
- Tools API still verifies credentials, scopes, and agent run identity, and
  writes audit records for tool calls.
- Pending **IncidentActionApproval** waits are durable and do not keep an OAuth
  polling flow open. When an operator approves later, webbackend resumes the
  same stored **AgentRunSnapshot**.
- **IncidentAutomationCredential** failures are execution/configuration
  failures, not operator authorization waits.

## Future Notes

- Consider adding tools API defense-in-depth that verifies a service-credential
  write call matches a resolved one-time **IncidentActionApproval**.
- Add request correlation for tool execution: tools API routes should return a
  request id header, log that request id, and the runtime should record it in
  the corresponding tool result.
