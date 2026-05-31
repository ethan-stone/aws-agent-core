import type { AgentKind } from "@agent-core/pulseforge-domain";
import type {
  AgentInvocationContextRequirement,
  AgentInvocationTriggerType,
} from "@agent-core/pulseforge-domain";
import {
  pulseForgeToolDefinitionByName,
  type PulseForgeCredentialProviderDescriptor,
  type PulseForgeToolDefinition,
  type PulseForgeToolName,
  type PulseForgeToolScope,
} from "@agent-core/pulseforge-tools";
import { z } from "zod";

export const pulseForgeAgentKinds = [
  "ops-copilot",
  "incident-responder",
] as const satisfies readonly AgentKind[];

export const pulseForgeAgentKindSchema = z.enum(pulseForgeAgentKinds);

export interface PulseForgeAgentConfig {
  kind: AgentKind;
  id: string;
  label: string;
  systemPrompt: string;
  allowedTriggers: readonly AgentInvocationTriggerType[];
  requiredContext: readonly AgentInvocationContextRequirement[];
  projectsRequiredActionsToIncidentActivity: boolean;
  toolNames: readonly PulseForgeToolName[];
}

const pulseForgeAgentConfigs = {
  "ops-copilot": {
    kind: "ops-copilot",
    id: "pulseforge-ops-copilot",
    label: "Ops Copilot",
    allowedTriggers: ["operator_prompt", "incident_agent_mention"],
    requiredContext: ["prompt"],
    projectsRequiredActionsToIncidentActivity: true,
    systemPrompt: [
      "You are PulseForge Ops Copilot, an IoT operations assistant for device monitoring and incident response.",
      "Investigate user requests using available operational tools as the source of truth, ground conclusions in retrieved data, and keep responses concise enough for an on-call operator.",
      "When the request includes an incident ID or device ID, gather operational evidence with tools before producing findings or recommendations.",
      "For follow-up references like 'that incident' or 'those devices', resolve the reference from conversation history before using tools. Never invent incident IDs or device IDs; ask a clarifying question if the reference cannot be resolved.",
      "For device reset requests, explain the evidence, then call reset_device when the operator asks you to perform the reset or remediate the incident. reset_device is the approval request: the platform interrupts that tool call and requests explicit operator approval before it executes. Do not ask for approval in chat before calling reset_device, and do not use propose_remediation_action as a substitute when the operator asked you to perform the reset.",
      "When you create records, make the audit trail understandable: explain what you changed, why, and what remains uncertain.",
    ].join("\n"),
    toolNames: [
      "get_incident_context",
      "get_device",
      "get_device_telemetry",
      "create_incident_activity",
      "create_ticket",
      "propose_remediation_action",
      "reset_device",
    ],
  },
  "incident-responder": {
    kind: "incident-responder",
    id: "pulseforge-incident-responder",
    label: "Incident Responder",
    allowedTriggers: ["incident_created"],
    requiredContext: ["incident_id"],
    projectsRequiredActionsToIncidentActivity: true,
    systemPrompt: [
      "You are PulseForge Incident Responder, a background IoT incident response workflow agent.",
      "When invoked for an incident, gather operational evidence with tools, assess likely causes and risk, record high-signal incident activity, and take safe, auditable steps toward mitigation.",
      "Keep incident-facing updates concise, factual, and audit-friendly. Distinguish evidence from hypotheses, and stop when confidence or authorization is insufficient.",
      "Resolve follow-up references from conversation history and never invent incident IDs or device IDs.",
      "Use tools as the source of truth. For high-risk operational actions such as device reset, call the approval-required tool and wait for operator approval rather than asking in prose.",
    ].join("\n"),
    toolNames: [
      "get_incident_context",
      "get_device",
      "get_device_telemetry",
      "create_incident_activity",
      "create_ticket",
      "propose_remediation_action",
      "reset_device",
    ],
  },
} as const satisfies Record<AgentKind, PulseForgeAgentConfig>;

export interface PulseForgeToolAuthorizationGroup {
  provider: PulseForgeCredentialProviderDescriptor;
  scopes: readonly PulseForgeToolScope[];
  tools: readonly PulseForgeToolName[];
}

export function getPulseForgeAgentConfig(kind: AgentKind): PulseForgeAgentConfig {
  return pulseForgeAgentConfigs[kind];
}

export function isPulseForgeAgentTriggerAllowed(
  kind: AgentKind,
  triggerType: AgentInvocationTriggerType
): boolean {
  return getPulseForgeAgentConfig(kind).allowedTriggers.includes(triggerType);
}

export function getPulseForgeAgentToolDefinitions(
  kind: AgentKind
): readonly PulseForgeToolDefinition[] {
  return getPulseForgeAgentConfig(kind).toolNames.map(
    (name) => pulseForgeToolDefinitionByName[name]
  );
}

export function getPulseForgeAgentToolAuthorizationGroups(
  kind: AgentKind
): readonly PulseForgeToolAuthorizationGroup[] {
  const groups = new Map<string, {
    provider: PulseForgeCredentialProviderDescriptor;
    scopes: Set<PulseForgeToolScope>;
    tools: PulseForgeToolName[];
  }>();

  for (const definition of getPulseForgeAgentToolDefinitions(kind)) {
    const key = definition.credentialProvider.key;
    const group = groups.get(key) ?? {
      provider: definition.credentialProvider,
      scopes: new Set<PulseForgeToolScope>(),
      tools: [],
    };

    for (const scope of definition.requiredScopes) {
      group.scopes.add(scope);
    }
    group.tools.push(definition.name);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    provider: group.provider,
    scopes: [...group.scopes],
    tools: group.tools,
  }));
}
