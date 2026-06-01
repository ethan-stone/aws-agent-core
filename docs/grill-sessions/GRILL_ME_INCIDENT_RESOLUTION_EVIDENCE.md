# Grill-Me Session: Incident Resolution Evidence

This document captures the design grilling session for improving how PulseForge agents answer questions such as "Was this incident resolved? How so?" The goal is to keep **IncidentResolution** explicit while giving agents enough chronological product history to explain what happened without inventing causality.

## Decisions So Far

- Keep **IncidentResolution** as the explicit operator action that marks an **Incident** resolved.
- Add **ResolutionEvidence** as the chronological factual chain used to explain what happened before or after **IncidentResolution**.
- Treat **ResolutionEvidence** as a read-model projection assembled from canonical domain records, not as its own persisted domain record.
- Enrich `get_incident_context` first instead of adding a separate resolution-evidence tool.
- Include recovery evidence categories such as reset execution, simulation recovery, current normal device state, and explicit incident resolution.
- Include only resolution-relevant facts, not a complete incident event log.
- Use `Conversation.incidentId` as the source of truth for incident-linked agent runs.
- Record `resolvedAt` and `resolvedByUserId` on **Incident**, and create an `incident_resolved` **IncidentActivity** for explicit resolution.
- Do not create **IncidentActivity** for device resets. Resets appear in **ResolutionEvidence** through linked agent run tool calls/results and tool audit logs.
- Organize evidence into a clear timeline, not grouped buckets.
- Omit per-entry causality/confidence fields for now.
- Keep the **ResolutionEvidence** timeline in strict chronological order with a stable `kind` field.

## Future Notes

- Consider adding a `causalStatus` or similar field to **ResolutionEvidence** timeline entries later if models overstate causality. Candidate values discussed: `recorded_fact`, `temporal_correlation`, `explicit_link`, and `unknown`.
- Consider adding a `phase` field later if UI or model prompting needs higher-level grouping such as detection, investigation, approval, action, recovery, and resolution.
