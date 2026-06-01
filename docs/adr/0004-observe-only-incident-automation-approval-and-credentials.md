# ADR 0004: Observe-Only Incident Automation Approval And Credentials

Observe-only incident automation runs without an ordinary human interactor, so
it cannot rely on a user being present to complete OAuth while the agent is
working. At the same time, background agents must not execute non-read-only
operational actions without explicit human approval.

PulseForge separates these concerns. **IncidentActionApproval** is the
one-time incident-surface approval for a non-read-only tool call proposed by an
observe-only incident-linked **Conversation**. Tool credentials are separate.
Interactive user-triggered conversations use delegated user credentials through
AgentCore Identity `USER_FEDERATION`. Observe-only background conversations use
AgentCore Identity M2M credentials as the **IncidentAutomationCredential** after
approval is granted.

`allow_always` is never valid for observe-only incident automation. Approval UI
for these runs offers only approve once or decline, and both webbackend and the
runtime should reject reusable approval decisions in this context. Interactive
conversations may keep their existing conversation-scoped approval behavior.

The runtime approval flow is the enforcement point for the first
implementation. Tools API still verifies credentials, scopes, and agent run
identity, and writes audit logs. Tools API does not initially re-check that a
service-credential write call matches a resolved **IncidentActionApproval**.
That can be added later as defense-in-depth.

Automatic incident response is triggered by a scheduled worker that scans for
unresolved incidents without an observe-only incident-linked **Conversation**.
The worker catches up existing unresolved incidents, processes a small batch per
tick, and consumes each run until it completes, fails, or blocks on durable
approval. This keeps device simulation and other incident creation paths loosely
coupled from agent orchestration.

The trade-off is that M2M execution depends on platform credential
configuration rather than a live user delegation flow. If M2M credentials fail,
that is an execution or configuration failure, not an operator authorization
wait.
