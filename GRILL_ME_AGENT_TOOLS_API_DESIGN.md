# Grill-Me Session: Designing the Agent-Facing Tools API

This document captures the earlier grill-me design session for creating the PulseForge agent-facing `/tools/*` API surface. This was the session before the runtime tool-integration discussion. The goal was to decide what API resources agents should eventually call as tools, how those routes should authenticate, and how to preserve auditability when an agent acts on behalf of a user.

## Context

PulseForge was evolving from a demo agent into a production-shaped IoT operations application. The application already had:

- A web app for human users.
- A backend API.
- Cognito authentication for users.
- AgentCore Runtime invoked by the backend, not directly by the browser.
- A desire for user-initiated copilot agents and future background agents.

The open design problem was how to expose backend capabilities to agents without weakening auth boundaries, losing audit trails, or mixing agent-only routes into normal web UI routes.

## Decision Summary

- Rename the existing `api` app to `webbackend` for clarity.
- Create dedicated `/tools/*` routes for agent-facing operations.
- Keep these routes on the webbackend for now, not a separate internal API yet.
- Treat background agents as a future design area and document the concerns.
- User-initiated copilot tools should use delegated user credentials, not broad machine-to-machine credentials.
- `/tools/*` should reject tokens issued to the normal web app client.
- Use a separate Cognito OAuth client for agent/delegated tool tokens.
- Require `x-pulseforge-agent-run-id` for all tool routes, including reads.
- Track that an agent called the route on behalf of a user.
- Add a simple permission/scope model early, even for the proof of concept.
- Use resource/action-oriented scopes, not product/tool-branded scopes.
- Use `pulseforge-backend` as the Cognito resource server identifier.
- Include a separate `read:telemetry` scope.
- Use HTTP endpoints as the tool boundary.
- Defer behavioral evals until tool mechanics are working, but design APIs so evals can later assert expected tool calls.
- Keep future background-agent authorization separate from user-initiated delegated auth.

## Transcript

### Q1: Should agent actions call HTTP endpoints or internal functions?

**Question:** Should tools be implemented as HTTP endpoints or direct in-process functions?

**Recommendation:** Use HTTP endpoints.

**Reasoning:** HTTP endpoints create a clean boundary for auth, audit logging, Gateway/OpenAPI migration, and future multi-agent reuse. They also keep agent execution from reaching directly into repository/service internals.

**User decision:** Definitely use HTTP endpoints.

### Q2: What auth mechanism should tool endpoints use?

**Question:** Should tool endpoints use machine-to-machine tokens, delegated user credentials, or something else?

**Recommendation:** For the user-initiated copilot, use delegated user credentials. Background agents can use machine-to-machine auth later, but that is a separate design.

**Reasoning:** The user-initiated copilot is acting on behalf of a real user. If the user has limited tenant/resource access, the agent should inherit that constraint rather than receive broad internal API access.

**User decision:** Use delegated user credentials for the copilot agent.

### Q3: What about background agents?

**Question:** How should the future background agent be handled?

**Recommendation:** Put a pin in it. Background agents will probably need M2M auth plus persisted work-item constraints so they do not get broad all-tenant access by default.

**User decision:** Do not implement background agents yet, but save the fact that the design was considered.

**Documented note:** Future background agents should not get broad all-tenant access simply because they use M2M auth. Their capability should come from OAuth scopes, while tenant/resource boundaries should come from a persisted work item or agent run.

### Q4: Should these routes be part of the normal web API?

**Question:** Should these tool endpoints live alongside normal web UI routes, or should they be internal-only?

**Recommendation:** Use a separate route namespace, `/tools/*`, even if it is hosted by the same backend service for now.

**Reasoning:** `/tools/*` makes the boundary explicit. These routes are not for browser UI calls. They can enforce different token clients, required agent-run headers, scopes, audit behavior, and eventually OpenAPI/Gateway generation.

**User decision:** Use `/tools/*`.

### Q5: Why use the word `tools`?

**Question:** Why press for a `/tools` qualifier instead of generic internal routes?

**Recommendation:** Use `/tools` because these routes are specifically agent-facing capabilities, not normal web backend endpoints. It provides a clean place for stricter auth and auditing.

**User concern:** The routes should not be tied too tightly to "tools" as a concept if they are just backend capabilities.

**Resolution:** Use `/tools/*` for now because these routes are dedicated for agent use. Avoid putting `tools` in OAuth scope names.

### Q6: Should scopes mention `pulseforge.tools`?

**Question:** Should OAuth scopes be namespaced around tools, such as `pulseforge.tools/write:incident_events`?

**Recommendation:** No. Use resource/action scopes.

**Reasoning:** A scope should represent the operation being authorized, not the current caller implementation. Agents are one client type; future clients may use the same capability.

**User decision:** Do not mention `pulseforge.tools` in scopes.

### Q7: What should scopes be?

**Question:** What OAuth scopes should exist for the first agent-facing API?

**Recommendation:** Use:

```txt
read:devices
read:incidents
read:telemetry
write:incident_events
write:tickets
write:remediation_actions
```

**User decision:** Include a separate scope for reading telemetry.

### Q8: What Cognito resource server identifier should be used?

**Question:** What should the Cognito resource server identifier be?

**Recommendation:** Use:

```txt
pulseforge-backend
```

Actual token scopes become:

```txt
pulseforge-backend/read:devices
pulseforge-backend/read:incidents
pulseforge-backend/read:telemetry
pulseforge-backend/write:incident_events
pulseforge-backend/write:tickets
pulseforge-backend/write:remediation_actions
```

App code can normalize those to the short names.

**User decision:** Use `pulseforge-backend`.

### Q9: Should tool routes require agent-run context?

**Question:** Should read-only tool routes require `x-pulseforge-agent-run-id`, or only writes?

**Recommendation:** Require it for every `/tools/*` operation, including reads.

**Reasoning:** Reads matter for audit and evals. If the agent is expected to use `read:telemetry` to answer a question, the system should be able to prove the tool call happened.

**User decision:** Require the header for read operations too.

### Q10: How should we know an agent made the call?

**Question:** If the token represents a user, how do we distinguish an agent call from a user copying a browser JWT and calling `/tools/*` manually?

**Recommendation:** Require `/tools/*` to reject tokens issued to the normal web app client. Accept only tokens issued to the dedicated agent/delegated client.

**Reasoning:** The token still represents the user, but its OAuth client indicates it was minted for the agent/tool flow. Combined with the required agent-run header, this gives a stronger audit signal.

**User decision:** Use a different client, and reject tokens from the web app client.

### Q11: What should audit records contain?

**Question:** What audit trail should tool calls write?

**Recommendation:** Capture:

- `actorType: "agent"`
- `actorId`: the OAuth client id or agent identity id.
- `onBehalfOfUserId`: the Cognito user subject.
- `agentRunId`: from `x-pulseforge-agent-run-id`.
- operation name.
- method and path.
- scopes.
- resource type and id.
- outcome and status code.

**User decision:** Track that the user invoked an agent, and that the agent performed actions on behalf of that user.

### Q12: What app permission model should exist?

**Question:** Should the app have a simple permission model now, or defer until later?

**Recommendation:** Add simple app permissions now.

**Reasoning:** Even in a proof of concept, putting permissions in early prevents every future endpoint from becoming implicitly public to all authenticated users.

**User decision:** Get permissions correct early.

### Q13: Should `/tools/*` be an internal API or the current backend?

**Question:** Should this be a separate internal API service now?

**Recommendation:** Not yet. Keep it on the current backend, but make the boundary explicit with `/tools/*`.

**Reasoning:** A separate internal API will likely be useful later for background agents or broader service-to-service workflows. For user-initiated tools, delegated-user semantics fit naturally on the existing webbackend.

**User decision:** Do not build the background/internal API now. Focus on user-initiated copilot tools.

### Q14: Should the backend app be renamed?

**Question:** Should the current `api` app be renamed now?

**Recommendation:** Yes. Rename `apps/api` to `apps/webbackend`.

**Reasoning:** The project will eventually have multiple APIs or service boundaries. `webbackend` makes it clear this service backs the web app and user-initiated agent flows.

**User decision:** Rename it first.

### Q15: Should old `api:*` scripts remain?

**Question:** Should old `api:*` package scripts remain after `webbackend:*` scripts are added?

**Recommendation:** Remove them once the replacement scripts exist.

**User decision:** Remove old `api:*` scripts.

## Resulting Implementation Plan

### Webbackend Rename

- Move `apps/api` to `apps/webbackend`.
- Rename package from `@agent-core/api` to `@agent-core/webbackend`.
- Replace root scripts with `webbackend:*` names.
- Remove old `api:*` aliases.
- Update README and project docs.

### Auth and Permissions

- Keep normal web routes authenticated by the web app Cognito client.
- Add a separate Cognito app client for agent/delegated tool tokens.
- Configure the webbackend to accept only the agent identity client for `/tools/*`.
- Normalize Cognito resource server scopes from `pulseforge-backend/*` to short scope names in application code.
- Add basic app permissions for normal `/api/*` routes.

### Tool Route Requirements

Every `/tools/*` route should:

- Require `Authorization: Bearer <delegated-user-token>`.
- Reject tokens from the web app client.
- Require `x-pulseforge-agent-run-id`.
- Verify the referenced agent run exists.
- Verify the agent run belongs to the delegated user when applicable.
- Check required scopes.
- Write an audit log.

### Initial Tool Routes

- `GET /tools/devices/:deviceId`
- `GET /tools/devices/:deviceId/telemetry`
- `GET /tools/incidents/:incidentId/context`
- `POST /tools/incidents/:incidentId/events`
- `POST /tools/incidents/:incidentId/tickets`
- `POST /tools/incidents/:incidentId/remediation-actions`

### Initial Scopes

```txt
read:devices
read:incidents
read:telemetry
write:incident_events
write:tickets
write:remediation_actions
```

### Initial Audit Shape

```ts
interface AuditActor {
  actorType: "agent" | "user";
  actorId: string;
  onBehalfOfUserId?: string;
  agentRunId?: string;
}

interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: AuditActor;
  operation: string;
  method: string;
  path: string;
  scopes: string[];
  resourceType?: string;
  resourceId?: string;
  outcome: "succeeded" | "failed";
  statusCode: number;
  message?: string;
}
```

## Why the Grill-Me Skill Helped

This session prevented a few subtle design traps:

- It separated user-initiated delegated auth from future background-agent M2M auth.
- It avoided broad internal API access for agents acting on behalf of users.
- It clarified that OAuth scopes should be resource/action-oriented, not tool-branded.
- It made audit requirements explicit before routes were implemented.
- It forced a clear distinction between web UI routes and agent-facing routes.
- It uncovered that read operations need audit and eval traceability too.
- It justified renaming `api` to `webbackend` before more API surfaces appear.
- It kept the first implementation focused while preserving future internal API and background-agent paths.

## Relationship to the Later Tools Integration Grill-Me Session

This session designed the agent-facing HTTP API boundary. The later session, documented separately in `GRILL_ME_TOOLS_API_INTEGRATION.md`, designed how the agent runtime should consume that API through reusable Strands tools and AgentCore Identity.

In short:

- This document: **What should the backend expose to agents, and how should it be authenticated/audited?**
- Later document: **How should the runtime package, authenticate, and invoke those APIs as reusable tools?**
