import type {
  AgentRun,
  AuditLogEntry,
  Conversation,
  DashboardSummary,
  Device,
  DeviceMetricSnapshot,
  Incident,
  IncidentActionApproval,
  IncidentActivity,
  IncidentAgentMention,
  IncidentComment,
  PendingInput,
  PulseForgeSnapshot,
  RemediationAction,
  RuntimeSession,
  RunbookDocument,
  RunItem,
  Site,
  Ticket,
} from "./types.js";

const now = "2026-04-12T15:00:00.000Z";

export const demoSites: Site[] = [
  {
    id: "site-atl-1",
    name: "Atlanta Cold Storage",
    region: "us-east-1",
    timezone: "America/New_York",
    fleetHealthScore: 91,
  },
  {
    id: "site-phx-1",
    name: "Phoenix Assembly Plant",
    region: "us-west-2",
    timezone: "America/Phoenix",
    fleetHealthScore: 76,
  },
];

export const demoDevices: Device[] = [
  {
    id: "dev-freezer-014",
    siteId: "site-atl-1",
    name: "Freezer Sensor 014",
    type: "freezer-sensor",
    firmwareVersion: "1.14.7",
    batteryPercent: 82,
    connectivityPercent: 98,
    status: "warning",
    tags: ["cold-chain", "warehouse-a"],
    lastSeenAt: now,
  },
  {
    id: "dev-freezer-022",
    siteId: "site-atl-1",
    name: "Freezer Sensor 022",
    type: "freezer-sensor",
    firmwareVersion: "1.14.7",
    batteryPercent: 77,
    connectivityPercent: 97,
    status: "critical",
    tags: ["cold-chain", "warehouse-b"],
    lastSeenAt: now,
  },
  {
    id: "dev-gateway-003",
    siteId: "site-phx-1",
    name: "Line Gateway 003",
    type: "gateway",
    firmwareVersion: "2.2.1",
    batteryPercent: 100,
    connectivityPercent: 72,
    status: "warning",
    tags: ["assembly-line", "edge"],
    lastSeenAt: now,
  },
  {
    id: "dev-vibration-118",
    siteId: "site-phx-1",
    name: "Vibration Monitor 118",
    type: "vibration-monitor",
    firmwareVersion: "3.0.2",
    batteryPercent: 64,
    connectivityPercent: 99,
    status: "healthy",
    tags: ["compressor", "predictive-maintenance"],
    lastSeenAt: now,
  },
];

export const demoDeviceMetrics: Record<string, DeviceMetricSnapshot[]> = {
  "dev-freezer-014": [
    {
      timestamp: "2026-04-12T14:30:00.000Z",
      temperatureC: -17.8,
      batteryPercent: 82,
      signalStrength: 83,
      packetLossPercent: 0.5,
    },
    {
      timestamp: "2026-04-12T14:45:00.000Z",
      temperatureC: -15.2,
      batteryPercent: 82,
      signalStrength: 80,
      packetLossPercent: 1.2,
    },
    {
      timestamp: "2026-04-12T15:00:00.000Z",
      temperatureC: -13.4,
      batteryPercent: 81,
      signalStrength: 78,
      packetLossPercent: 1.4,
    },
  ],
  "dev-freezer-022": [
    {
      timestamp: "2026-04-12T14:30:00.000Z",
      temperatureC: -16.9,
      batteryPercent: 78,
      signalStrength: 72,
      packetLossPercent: 1.7,
    },
    {
      timestamp: "2026-04-12T14:45:00.000Z",
      temperatureC: -11.1,
      batteryPercent: 77,
      signalStrength: 67,
      packetLossPercent: 3.1,
    },
    {
      timestamp: "2026-04-12T15:00:00.000Z",
      temperatureC: -8.7,
      batteryPercent: 77,
      signalStrength: 61,
      packetLossPercent: 4.8,
    },
  ],
  "dev-gateway-003": [
    {
      timestamp: "2026-04-12T14:30:00.000Z",
      batteryPercent: 100,
      signalStrength: 48,
      packetLossPercent: 6.9,
    },
    {
      timestamp: "2026-04-12T14:45:00.000Z",
      batteryPercent: 100,
      signalStrength: 41,
      packetLossPercent: 9.4,
    },
    {
      timestamp: "2026-04-12T15:00:00.000Z",
      batteryPercent: 100,
      signalStrength: 39,
      packetLossPercent: 12.2,
    },
  ],
  "dev-vibration-118": [
    {
      timestamp: "2026-04-12T14:30:00.000Z",
      vibrationMmS: 1.9,
      batteryPercent: 64,
      signalStrength: 91,
      packetLossPercent: 0.2,
    },
    {
      timestamp: "2026-04-12T14:45:00.000Z",
      vibrationMmS: 2.2,
      batteryPercent: 64,
      signalStrength: 92,
      packetLossPercent: 0.2,
    },
    {
      timestamp: "2026-04-12T15:00:00.000Z",
      vibrationMmS: 2.1,
      batteryPercent: 64,
      signalStrength: 90,
      packetLossPercent: 0.1,
    },
  ],
};

export const demoIncidents: Incident[] = [
  {
    id: "inc-1001",
    siteId: "site-atl-1",
    title: "Freezer temperature drift after firmware rollout",
    summary:
      "Two cold-chain sensors began drifting warmer within 90 minutes of firmware 1.14.7 deployment.",
    severity: "critical",
    status: "investigating",
    deviceIds: ["dev-freezer-014", "dev-freezer-022"],
    createdAt: "2026-04-12T13:42:00.000Z",
    updatedAt: now,
    category: "temperature-drift",
  },
  {
    id: "inc-1002",
    siteId: "site-phx-1",
    title: "Gateway packet loss spike on assembly line",
    summary:
      "Gateway 003 is showing sustained packet loss above 10%, affecting telemetry fan-in for one production cell.",
    severity: "high",
    status: "open",
    deviceIds: ["dev-gateway-003"],
    createdAt: "2026-04-12T14:18:00.000Z",
    updatedAt: now,
    category: "connectivity-loss",
  },
];

export const demoIncidentActivities: IncidentActivity[] = [
  {
    id: "actv-1",
    incidentId: "inc-1001",
    timestamp: "2026-04-12T13:42:00.000Z",
    kind: "detected",
    message: "Alert rule `freezer-temp-drift` triggered for 2 devices.",
  },
  {
    id: "actv-2",
    incidentId: "inc-1001",
    timestamp: "2026-04-12T13:55:00.000Z",
    kind: "agent_summary",
    message:
      "Incident Responder found strongest correlation with firmware version 1.14.7 rollout.",
    conversationId: "conv-1",
    agentRunId: "run-1",
    agentKind: "incident-responder",
    agentStatus: "completed",
    title: "Firmware correlation check",
    summary:
      "Warm-temperature drift aligns with the latest firmware rollout and not ambient site changes.",
  },
  {
    id: "actv-3",
    incidentId: "inc-1002",
    timestamp: "2026-04-12T14:18:00.000Z",
    kind: "detected",
    message: "Gateway connectivity degraded beyond high-severity threshold.",
  },
  {
    id: "actv-4",
    incidentId: "inc-1001",
    timestamp: "2026-04-12T14:05:01.000Z",
    kind: "agent_conversation",
    message: "Copilot connected by demo-user.",
    conversationId: "conv-3",
    agentRunId: "run-3",
    agentKind: "ops-copilot",
    agentStatus: "completed",
    title: "Compare firmware rollout timing",
    summary:
      "The timing still points at the 1.14.7 rollout, with both affected sensors in the same cohort.",
    causedByCommentId: "comment-1",
    causedByMentionId: "mention-1",
  },
];

export const demoIncidentComments: IncidentComment[] = [
  {
    id: "comment-1",
    incidentId: "inc-1001",
    authorUserId: "demo-user",
    body: "@copilot compare this drift against the firmware rollout window.",
    createdAt: "2026-04-12T14:05:00.000Z",
    updatedAt: "2026-04-12T14:05:00.000Z",
  },
];

export const demoIncidentAgentMentions: IncidentAgentMention[] = [
  {
    id: "mention-1",
    incidentId: "inc-1001",
    commentId: "comment-1",
    handle: "@copilot",
    agentKind: "ops-copilot",
    status: "accepted",
    conversationId: "conv-3",
    agentRunId: "run-3",
    activityId: "actv-4",
    createdAt: "2026-04-12T14:05:00.000Z",
    acceptedAt: "2026-04-12T14:05:01.000Z",
  },
];

export const demoIncidentActionApprovals: IncidentActionApproval[] = [];

export const demoRemediationActions: RemediationAction[] = [
  {
    id: "act-1",
    incidentId: "inc-1001",
    type: "rollback-firmware",
    status: "proposed",
    risk: "medium",
    summary: "Rollback two affected freezer sensors to firmware 1.14.6.",
  },
  {
    id: "act-2",
    incidentId: "inc-1002",
    type: "reboot-device",
    status: "proposed",
    risk: "low",
    summary: "Reboot the gateway during the next 5-minute production lull.",
  },
];

export const demoTickets: Ticket[] = [
  {
    id: "tic-1",
    incidentId: "inc-1001",
    externalRef: "OPS-4821",
    status: "open",
    assigneeTeam: "Field Reliability",
    createdAt: "2026-04-12T14:02:00.000Z",
  },
];

export const demoRunbooks: RunbookDocument[] = [
  {
    id: "rb-temp-drift-1",
    title: "Cold-chain temperature drift response",
    category: "temperature-drift",
    summary:
      "Validate firmware cohort impact, compare adjacent sensors, and stabilize storage temperature before dispatch.",
    steps: [
      "Compare affected devices against same-site devices on the prior firmware cohort.",
      "Check signal degradation and packet loss to rule out delayed telemetry artifacts.",
      "Rollback firmware if the drift began within one deployment window and no site-level ambient change is present.",
    ],
  },
  {
    id: "rb-connectivity-1",
    title: "Gateway connectivity degradation response",
    category: "connectivity-loss",
    summary:
      "Confirm gateway isolation, packet loss trend, and whether downstream devices are affected before reboot.",
    steps: [
      "Inspect packet-loss trend over the last hour and compare to adjacent gateways.",
      "Check whether downstream devices are last-seen stale or still reporting through alternate routes.",
      "Schedule a low-risk reboot if packet loss remains elevated and no upstream network event is open.",
    ],
  },
];

export const demoConversations: Conversation[] = [
  {
    id: "conv-1",
    rootAgentKind: "incident-responder",
    status: "open",
    incidentId: "inc-1001",
    interactionMode: "observe_only",
    createdAt: "2026-04-12T13:50:00.000Z",
    updatedAt: "2026-04-12T13:55:00.000Z",
  },
  {
    id: "conv-2",
    rootAgentKind: "incident-responder",
    status: "open",
    incidentId: "inc-1002",
    interactionMode: "observe_only",
    activeRootRunId: "run-2",
    createdAt: "2026-04-12T14:20:00.000Z",
    updatedAt: "2026-04-12T14:20:00.000Z",
  },
  {
    id: "conv-3",
    rootAgentKind: "ops-copilot",
    status: "open",
    incidentId: "inc-1001",
    interactionMode: "interactive",
    interactionOwnerUserId: "demo-user",
    createdAt: "2026-04-12T14:05:01.000Z",
    updatedAt: "2026-04-12T14:06:00.000Z",
  },
];

export const demoRuntimeSessions: RuntimeSession[] = [
  {
    id: "runtime-session-1",
    provider: "aws-agentcore",
    runtimeIdentity: "demo-agent-runtime",
    providerSessionId: "conv-1-agentcore",
    conversationId: "conv-1",
    status: "idle",
    createdAt: "2026-04-12T13:50:00.000Z",
    lastUsedAt: "2026-04-12T13:55:00.000Z",
  },
  {
    id: "runtime-session-2",
    provider: "aws-agentcore",
    runtimeIdentity: "demo-agent-runtime",
    providerSessionId: "conv-2-agentcore",
    conversationId: "conv-2",
    status: "active",
    createdAt: "2026-04-12T14:20:00.000Z",
    lastUsedAt: "2026-04-12T14:20:00.000Z",
  },
  {
    id: "runtime-session-3",
    provider: "aws-agentcore",
    runtimeIdentity: "demo-agent-runtime",
    providerSessionId: "conv-3-agentcore",
    conversationId: "conv-3",
    status: "idle",
    createdAt: "2026-04-12T14:05:01.000Z",
    lastUsedAt: "2026-04-12T14:06:00.000Z",
  },
];

export const demoAgentRuns: AgentRun[] = [
  {
    id: "run-1",
    conversationId: "conv-1",
    incidentId: "inc-1001",
    runtimeSessionId: "runtime-session-1",
    agentKind: "incident-responder",
    relationship: "root",
    status: "completed",
    startedAt: "2026-04-12T13:50:00.000Z",
    completedAt: "2026-04-12T13:55:00.000Z",
    summary:
      "Warm-temperature drift aligns with the latest firmware rollout and not ambient site changes.",
  },
  {
    id: "run-2",
    conversationId: "conv-2",
    incidentId: "inc-1002",
    runtimeSessionId: "runtime-session-2",
    agentKind: "incident-responder",
    relationship: "root",
    status: "queued",
    startedAt: "2026-04-12T14:20:00.000Z",
    summary: "Background remediation queued for gateway packet loss incident.",
  },
  {
    id: "run-3",
    conversationId: "conv-3",
    incidentId: "inc-1001",
    runtimeSessionId: "runtime-session-3",
    agentKind: "ops-copilot",
    relationship: "root",
    status: "completed",
    startedAt: "2026-04-12T14:05:01.000Z",
    requestedByUserId: "demo-user",
    completedAt: "2026-04-12T14:06:00.000Z",
    summary:
      "The timing still points at the 1.14.7 rollout, with both affected sensors in the same cohort.",
  },
];

export const demoRunItems: RunItem[] = [
  {
    id: "item-1",
    runId: "run-1",
    sequence: 0,
    kind: "message",
    role: "user",
    source: { type: "user", userId: "demo-user" },
    createdAt: "2026-04-12T13:50:00.000Z",
    content: [
      {
        type: "text",
        text: "Investigate incident inc-1001 and summarize the likely cause.",
      },
    ],
  },
  {
    id: "item-2",
    runId: "run-1",
    sequence: 1,
    kind: "message",
    role: "agent",
    source: {
      type: "agent",
      agentRunId: "run-1",
      agentKind: "incident-responder",
    },
    createdAt: "2026-04-12T13:55:00.000Z",
    content: [
      {
        type: "text",
        text: "Warm-temperature drift aligns with the latest firmware rollout and not ambient site changes.",
      },
    ],
  },
  {
    id: "item-3",
    runId: "run-3",
    sequence: 0,
    kind: "message",
    role: "user",
    source: { type: "user", userId: "demo-user" },
    createdAt: "2026-04-12T14:05:01.000Z",
    content: [
      {
        type: "text",
        text: "Compare this drift against the firmware rollout window.",
      },
    ],
  },
  {
    id: "item-4",
    runId: "run-3",
    sequence: 1,
    kind: "message",
    role: "agent",
    source: {
      type: "agent",
      agentRunId: "run-3",
      agentKind: "ops-copilot",
    },
    createdAt: "2026-04-12T14:06:00.000Z",
    content: [
      {
        type: "text",
        text: "The timing still points at the 1.14.7 rollout, with both affected sensors in the same cohort.",
      },
    ],
  },
];

export const demoPendingInputs: PendingInput[] = [];

export const demoAuditLogs: AuditLogEntry[] = [];

export const demoDashboard: DashboardSummary = {
  totalSites: demoSites.length,
  totalDevices: demoDevices.length,
  healthyDevices: demoDevices.filter((device) => device.status === "healthy")
    .length,
  warningDevices: demoDevices.filter((device) => device.status === "warning")
    .length,
  criticalDevices: demoDevices.filter((device) => device.status === "critical")
    .length,
  offlineDevices: demoDevices.filter((device) => device.status === "offline")
    .length,
  openIncidents: demoIncidents.filter((incident) => incident.status !== "resolved")
    .length,
  criticalIncidents: demoIncidents.filter(
    (incident) => incident.severity === "critical"
  ).length,
};

export const demoSnapshot: PulseForgeSnapshot = {
  sites: demoSites,
  devices: demoDevices,
  deviceMetrics: demoDeviceMetrics,
  incidents: demoIncidents,
  incidentActivities: demoIncidentActivities,
  incidentComments: demoIncidentComments,
  incidentAgentMentions: demoIncidentAgentMentions,
  incidentActionApprovals: demoIncidentActionApprovals,
  remediationActions: demoRemediationActions,
  tickets: demoTickets,
  conversations: demoConversations,
  runtimeSessions: demoRuntimeSessions,
  agentRuns: demoAgentRuns,
  runItems: demoRunItems,
  pendingInputs: demoPendingInputs,
  auditLogs: demoAuditLogs,
  dashboard: demoDashboard,
};
