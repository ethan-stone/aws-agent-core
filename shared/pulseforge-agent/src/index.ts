import type { AgentKind } from "@agent-core/pulseforge-domain";
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
  "anomaly-investigation",
  "remediation-planner",
  "autonomous-remediation",
] as const satisfies readonly AgentKind[];

export const pulseForgeAgentKindSchema = z.enum(pulseForgeAgentKinds);

export interface PulseForgeAgentConfig {
  kind: AgentKind;
  id: string;
  label: string;
  systemPrompt: string;
  toolNames: readonly PulseForgeToolName[];
}

const pulseForgeAgentConfigs = {
  "ops-copilot": {
    kind: "ops-copilot",
    id: "pulseforge-ops-copilot",
    label: "Ops Copilot",
    systemPrompt: [
      "You are PulseForge Ops Copilot, an IoT operations assistant for device monitoring and incident response.",
      "Investigate user requests using available operational tools as the source of truth, ground conclusions in retrieved data, and keep responses concise enough for an on-call operator.",
      "When the request includes an incident ID or device ID, gather operational evidence with tools before producing findings or recommendations.",
      "For device reset requests, explain the evidence, then call reset_device when the operator asks you to perform the reset or remediate the incident. reset_device is the approval request: the platform interrupts that tool call and requests explicit operator approval before it executes. Do not ask for approval in chat before calling reset_device, and do not use propose_remediation_action as a substitute when the operator asked you to perform the reset.",
      "When you create records, make the audit trail understandable: explain what you changed, why, and what remains uncertain.",
    ].join("\n"),
    toolNames: [
      "get_device",
      "get_device_telemetry",
      "create_incident_event",
      "create_ticket",
      "propose_remediation_action",
      "reset_device",
    ],
  },
  "anomaly-investigation": {
    kind: "anomaly-investigation",
    id: "pulseforge-anomaly-investigation",
    label: "Anomaly Investigation",
    systemPrompt: [
      "You are PulseForge Anomaly Investigation Agent.",
      "Analyze telemetry and incident patterns, identify likely contributing factors, and separate evidence from hypotheses.",
    ].join("\n"),
    toolNames: [],
  },
  "remediation-planner": {
    kind: "remediation-planner",
    id: "pulseforge-remediation-planner",
    label: "Remediation Planner",
    systemPrompt: [
      "You are PulseForge Remediation Planner.",
      "Propose safe, reviewable remediation plans with risk notes and clear prerequisites before any operational change.",
    ].join("\n"),
    toolNames: [],
  },
  "autonomous-remediation": {
    kind: "autonomous-remediation",
    id: "pulseforge-autonomous-remediation",
    label: "Autonomous Remediation",
    systemPrompt: [
      "You are PulseForge Autonomous Remediation Agent.",
      "Prefer safe, reversible actions, document all action attempts, and stop when confidence or authorization is insufficient.",
    ].join("\n"),
    toolNames: [],
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
