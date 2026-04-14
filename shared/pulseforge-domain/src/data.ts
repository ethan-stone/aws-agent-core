import type {
  AgentRun,
  DashboardSummary,
  Device,
  DeviceMetricSnapshot,
  Incident,
  IncidentEvent,
  PulseForgeSnapshot,
  RemediationAction,
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

export const demoIncidentEvents: IncidentEvent[] = [
  {
    id: "evt-1",
    incidentId: "inc-1001",
    timestamp: "2026-04-12T13:42:00.000Z",
    kind: "detected",
    message: "Alert rule `freezer-temp-drift` triggered for 2 devices.",
  },
  {
    id: "evt-2",
    incidentId: "inc-1001",
    timestamp: "2026-04-12T13:55:00.000Z",
    kind: "agent_summary",
    message:
      "Anomaly Investigation Agent found strongest correlation with firmware version 1.14.7 rollout.",
  },
  {
    id: "evt-3",
    incidentId: "inc-1002",
    timestamp: "2026-04-12T14:18:00.000Z",
    kind: "detected",
    message: "Gateway connectivity degraded beyond high-severity threshold.",
  },
];

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

export const demoAgentRuns: AgentRun[] = [
  {
    id: "run-1",
    incidentId: "inc-1001",
    agentKind: "anomaly-investigation",
    status: "completed",
    requestedAt: "2026-04-12T13:50:00.000Z",
    completedAt: "2026-04-12T13:55:00.000Z",
    summary:
      "Warm-temperature drift aligns with the latest firmware rollout and not ambient site changes.",
  },
  {
    id: "run-2",
    incidentId: "inc-1002",
    agentKind: "autonomous-remediation",
    status: "queued",
    requestedAt: "2026-04-12T14:20:00.000Z",
    summary: "Background remediation queued for gateway packet loss incident.",
  },
];

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
  incidentEvents: demoIncidentEvents,
  remediationActions: demoRemediationActions,
  tickets: demoTickets,
  agentRuns: demoAgentRuns,
  dashboard: demoDashboard,
};
