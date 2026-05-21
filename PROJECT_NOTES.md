# Project Notes

## Implementation TODOs

- Harden the OAuth UX around delegated agent tool authorization. The runtime now emits `auth_required` and keeps the invocation open while AgentCore Identity polls; the UI should eventually handle popup blockers, callback success messaging, and timeout/retry states more explicitly.
