import type { z } from "zod";
import {
  createIncidentEventInputSchema,
  createTicketInputSchema,
  genericToolOutputSchema,
  getDeviceInputSchema,
  getDeviceTelemetryInputSchema,
  getIncidentContextInputSchema,
  proposeRemediationActionInputSchema,
} from "./schemas.js";
import type {
  PulseForgeAgentToolBundleName,
  PulseForgeToolDefinition,
  PulseForgeToolName,
} from "./types.js";

export const pulseForgeToolScopes = {
  readDevices: "read:devices",
  readIncidents: "read:incidents",
  readTelemetry: "read:telemetry",
  writeIncidentEvents: "write:incident_events",
  writeTickets: "write:tickets",
  writeRemediationActions: "write:remediation_actions",
} as const;

function defineTool<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  definition: PulseForgeToolDefinition<TInputSchema, TOutputSchema>
) {
  return definition;
}

export const pulseForgeToolDefinitions = [
  defineTool({
    name: "get_incident_context",
    description:
      "Fetch curated incident context, including the incident, recent events, affected devices, recent telemetry, related incidents, and runbook hints.",
    inputSchema: getIncidentContextInputSchema,
    outputSchema: genericToolOutputSchema,
    requiredScopes: [
      pulseForgeToolScopes.readIncidents,
      pulseForgeToolScopes.readDevices,
      pulseForgeToolScopes.readTelemetry,
    ],
    http: {
      method: "GET",
      path: (input) => `/tools/incidents/${encodeURIComponent(input.incidentId)}/context`,
    },
  }),
  defineTool({
    name: "get_device",
    description:
      "Fetch curated metadata for a PulseForge IoT device, including health, firmware, connectivity, and tags.",
    inputSchema: getDeviceInputSchema,
    outputSchema: genericToolOutputSchema,
    requiredScopes: [pulseForgeToolScopes.readDevices],
    http: {
      method: "GET",
      path: (input) => `/tools/devices/${encodeURIComponent(input.deviceId)}`,
    },
  }),
  defineTool({
    name: "get_device_telemetry",
    description:
      "Fetch recent telemetry for a PulseForge IoT device, including latest readings and a trimmed recent time series.",
    inputSchema: getDeviceTelemetryInputSchema,
    outputSchema: genericToolOutputSchema,
    requiredScopes: [pulseForgeToolScopes.readTelemetry],
    http: {
      method: "GET",
      path: (input) =>
        `/tools/devices/${encodeURIComponent(input.deviceId)}/telemetry`,
    },
  }),
  defineTool({
    name: "create_incident_event",
    description:
      "Record an audit-visible incident event when the agent summarizes, attempts an action, observes an action result, or creates a ticket.",
    inputSchema: createIncidentEventInputSchema,
    outputSchema: genericToolOutputSchema,
    requiredScopes: [pulseForgeToolScopes.writeIncidentEvents],
    http: {
      method: "POST",
      path: (input) => `/tools/incidents/${encodeURIComponent(input.incidentId)}/events`,
      body: (input) => ({
        kind: input.kind,
        message: input.message,
      }),
    },
  }),
  defineTool({
    name: "create_ticket",
    description:
      "Create an incident ticket for human follow-up when the issue needs external ownership or cannot be resolved by the agent.",
    inputSchema: createTicketInputSchema,
    outputSchema: genericToolOutputSchema,
    requiredScopes: [pulseForgeToolScopes.writeTickets],
    http: {
      method: "POST",
      path: (input) => `/tools/incidents/${encodeURIComponent(input.incidentId)}/tickets`,
      body: (input) => ({
        assigneeTeam: input.assigneeTeam,
        ...(input.externalRef ? { externalRef: input.externalRef } : {}),
        ...(input.status ? { status: input.status } : {}),
      }),
    },
  }),
  defineTool({
    name: "propose_remediation_action",
    description:
      "Propose a remediation action for an incident. This records a proposal only; it does not execute device mutations.",
    inputSchema: proposeRemediationActionInputSchema,
    outputSchema: genericToolOutputSchema,
    requiredScopes: [pulseForgeToolScopes.writeRemediationActions],
    http: {
      method: "POST",
      path: (input) =>
        `/tools/incidents/${encodeURIComponent(input.incidentId)}/remediation-actions`,
      body: (input) => ({
        type: input.type,
        risk: input.risk,
        summary: input.summary,
      }),
    },
  }),
] as const;

export const pulseForgeToolDefinitionByName = Object.fromEntries(
  pulseForgeToolDefinitions.map((definition) => [definition.name, definition])
) as Record<PulseForgeToolName, (typeof pulseForgeToolDefinitions)[number]>;

export const pulseForgeToolBundles = {
  "ops-copilot": pulseForgeToolDefinitions,
  "anomaly-investigation": [],
  "remediation-planner": [],
  "autonomous-remediation": [],
} as const satisfies Record<
  PulseForgeAgentToolBundleName,
  readonly PulseForgeToolDefinition[]
>;
