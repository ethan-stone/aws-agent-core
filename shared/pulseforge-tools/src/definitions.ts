import type { z } from "zod";
import {
  createIncidentEventInputSchema,
  createTicketInputSchema,
  genericToolOutputSchema,
  getDeviceInputSchema,
  getDeviceTelemetryInputSchema,
  getIncidentContextInputSchema,
  proposeRemediationActionInputSchema,
  resetDeviceInputSchema,
} from "./schemas.js";
import type {
  PulseForgeCredentialProviderDescriptor,
  PulseForgeToolDefinition,
  PulseForgeToolName,
  PulseForgeToolScope,
} from "./types.js";

export const pulseForgeToolScopes = {
  readDevices: "read:devices",
  readIncidents: "read:incidents",
  readTelemetry: "read:telemetry",
  writeIncidentEvents: "write:incident_events",
  writeTickets: "write:tickets",
  writeRemediationActions: "write:remediation_actions",
  writeDeviceCommands: "write:device_commands",
} as const;

export const pulseForgeBackendCredentialProvider = {
  key: "pulseforge-backend",
  displayName: "PulseForge Backend",
  supportedScopes: Object.values(pulseForgeToolScopes),
} as const satisfies PulseForgeCredentialProviderDescriptor<PulseForgeToolScope>;

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
    credentialProvider: pulseForgeBackendCredentialProvider,
    requiredScopes: [
      pulseForgeToolScopes.readIncidents,
      pulseForgeToolScopes.readDevices,
      pulseForgeToolScopes.readTelemetry,
    ],
    http: {
      method: "GET",
      path: (input) => `/incidents/${encodeURIComponent(input.incidentId)}/context`,
    },
  }),
  defineTool({
    name: "get_device",
    description:
      "Fetch curated metadata for a PulseForge IoT device, including health, firmware, connectivity, and tags.",
    inputSchema: getDeviceInputSchema,
    outputSchema: genericToolOutputSchema,
    credentialProvider: pulseForgeBackendCredentialProvider,
    requiredScopes: [pulseForgeToolScopes.readDevices],
    http: {
      method: "GET",
      path: (input) => `/devices/${encodeURIComponent(input.deviceId)}`,
    },
  }),
  defineTool({
    name: "get_device_telemetry",
    description:
      "Fetch recent telemetry for a PulseForge IoT device, including latest readings and a trimmed recent time series.",
    inputSchema: getDeviceTelemetryInputSchema,
    outputSchema: genericToolOutputSchema,
    credentialProvider: pulseForgeBackendCredentialProvider,
    requiredScopes: [pulseForgeToolScopes.readTelemetry],
    http: {
      method: "GET",
      path: (input) =>
        `/devices/${encodeURIComponent(input.deviceId)}/telemetry`,
    },
  }),
  defineTool({
    name: "create_incident_event",
    description:
      "Record an audit-visible incident event when the agent summarizes, attempts an action, observes an action result, or creates a ticket.",
    inputSchema: createIncidentEventInputSchema,
    outputSchema: genericToolOutputSchema,
    credentialProvider: pulseForgeBackendCredentialProvider,
    requiredScopes: [pulseForgeToolScopes.writeIncidentEvents],
    http: {
      method: "POST",
      path: (input) => `/incidents/${encodeURIComponent(input.incidentId)}/events`,
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
    credentialProvider: pulseForgeBackendCredentialProvider,
    requiredScopes: [pulseForgeToolScopes.writeTickets],
    http: {
      method: "POST",
      path: (input) => `/incidents/${encodeURIComponent(input.incidentId)}/tickets`,
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
      "Propose a remediation action for an incident only when the operator asks for a plan, recommendation, or record of a proposal. This records a proposal only; it does not execute device mutations. Do not use this as a substitute when the operator asks you to reset, reboot, remediate, resolve, or fix a device; call reset_device if the reset is warranted.",
    inputSchema: proposeRemediationActionInputSchema,
    outputSchema: genericToolOutputSchema,
    credentialProvider: pulseForgeBackendCredentialProvider,
    requiredScopes: [pulseForgeToolScopes.writeRemediationActions],
    http: {
      method: "POST",
      path: (input) =>
        `/incidents/${encodeURIComponent(input.incidentId)}/remediation-actions`,
      body: (input) => ({
        type: input.type,
        risk: input.risk,
        summary: input.summary,
      }),
    },
  }),
  defineTool({
    name: "reset_device",
    description:
      "Request approval to reset a PulseForge IoT device, then execute the reset only after the platform approval interrupt is approved. Use this instead of asking for reset approval in chat. This demo endpoint returns a successful reset record but does not mutate real device infrastructure.",
    inputSchema: resetDeviceInputSchema,
    outputSchema: genericToolOutputSchema,
    credentialProvider: pulseForgeBackendCredentialProvider,
    requiredScopes: [pulseForgeToolScopes.writeDeviceCommands],
    approval: {
      required: true,
      actionType: "tool_approval",
      title: "Reset device",
      description:
        "The agent wants to reset a PulseForge IoT device as a remediation action.",
      actionLabel: "Reset device",
      risk: "high",
    },
    http: {
      method: "POST",
      path: (input) => `/devices/${encodeURIComponent(input.deviceId)}/reset`,
      body: (input) => ({
        reason: input.reason,
      }),
    },
  }),
] as const;

export const pulseForgeToolDefinitionByName = Object.fromEntries(
  pulseForgeToolDefinitions.map((definition) => [definition.name, definition])
) as Record<PulseForgeToolName, (typeof pulseForgeToolDefinitions)[number]>;
