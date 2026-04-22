export type DeviceStatus = "healthy" | "warning" | "critical" | "offline";
export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus =
  | "open"
  | "investigating"
  | "mitigated"
  | "resolved";
export type TicketStatus = "open" | "in_progress" | "waiting" | "closed";
export type RemediationActionStatus =
  | "proposed"
  | "in_progress"
  | "succeeded"
  | "failed"
  | "blocked";
export type AgentKind =
  | "ops-copilot"
  | "anomaly-investigation"
  | "remediation-planner"
  | "autonomous-remediation";
export type AgentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface Site {
  id: string;
  name: string;
  region: string;
  timezone: string;
  fleetHealthScore: number;
}

export interface Device {
  id: string;
  siteId: string;
  name: string;
  type: "freezer-sensor" | "vibration-monitor" | "gateway" | "power-meter";
  firmwareVersion: string;
  batteryPercent: number;
  connectivityPercent: number;
  status: DeviceStatus;
  tags: string[];
  lastSeenAt: string;
}

export interface DeviceMetricSnapshot {
  timestamp: string;
  temperatureC?: number;
  vibrationMmS?: number;
  batteryPercent: number;
  signalStrength: number;
  packetLossPercent: number;
}

export interface Incident {
  id: string;
  siteId: string;
  title: string;
  summary: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  deviceIds: string[];
  createdAt: string;
  updatedAt: string;
  category:
    | "temperature-drift"
    | "connectivity-loss"
    | "battery-degradation"
    | "firmware-regression";
}

export interface IncidentEvent {
  id: string;
  incidentId: string;
  timestamp: string;
  kind:
    | "detected"
    | "agent_summary"
    | "action_attempted"
    | "action_result"
    | "ticket_created";
  message: string;
}

export interface RemediationAction {
  id: string;
  incidentId: string;
  type:
    | "reboot-device"
    | "rollback-firmware"
    | "increase-sampling"
    | "dispatch-technician";
  status: RemediationActionStatus;
  risk: "low" | "medium" | "high";
  summary: string;
}

export interface Ticket {
  id: string;
  incidentId: string;
  externalRef: string;
  status: TicketStatus;
  assigneeTeam: string;
  createdAt: string;
}

export interface RunbookDocument {
  id: string;
  title: string;
  category: Incident["category"];
  summary: string;
  steps: string[];
}

export interface AgentRun {
  id: string;
  incidentId?: string;
  deviceId?: string;
  sessionId?: string;
  agentKind: AgentKind;
  status: AgentRunStatus;
  requestedAt: string;
  completedAt?: string;
  summary: string;
  prompt?: string;
  messages?: AgentRunMessage[];
  investigation?: AgentRunInvestigationSummary;
  errorMessage?: string;
}

export interface AgentRunMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AgentRunInvestigationSummary {
  title: string;
  summary: string;
  findings: string[];
  recommendedActions: string[];
}

export interface CreateAgentRunRequest {
  agentKind: AgentKind;
  prompt: string;
  incidentId?: string;
  deviceId?: string;
  sessionId?: string;
}

export interface IncidentInvestigationContext {
  incident: Incident;
  events: IncidentEvent[];
  devices: Array<{
    device: Device;
    telemetry: DeviceMetricSnapshot[];
  }>;
  relatedIncidents: Incident[];
  runbook?: RunbookDocument;
}

export interface AgentRuntimeInvocation {
  agentKind: AgentKind;
  prompt: string;
  incidentId?: string;
  deviceId?: string;
  actorId?: string;
  investigationContext?: IncidentInvestigationContext;
}

export interface AgentRunResult {
  summary: string;
  messages: AgentRunMessage[];
  investigation?: AgentRunInvestigationSummary;
}

export interface ApiAuthConfig {
  enabled: boolean;
  provider: "none" | "cognito";
  region?: string;
  userPoolId?: string;
  userPoolClientId?: string;
}

export interface AuthenticatedAppUser {
  sub: string;
  username: string;
  email?: string;
  groups: string[];
}

export interface DashboardSummary {
  totalSites: number;
  totalDevices: number;
  healthyDevices: number;
  warningDevices: number;
  criticalDevices: number;
  offlineDevices: number;
  openIncidents: number;
  criticalIncidents: number;
}

export interface PulseForgeSnapshot {
  sites: Site[];
  devices: Device[];
  deviceMetrics: Record<string, DeviceMetricSnapshot[]>;
  incidents: Incident[];
  incidentEvents: IncidentEvent[];
  remediationActions: RemediationAction[];
  tickets: Ticket[];
  agentRuns: AgentRun[];
  dashboard: DashboardSummary;
}
