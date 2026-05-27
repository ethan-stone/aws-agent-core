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
export type ConversationStatus = "open" | "archived";
export type RuntimeSessionStatus = "active" | "idle" | "expired" | "closed";
export type AgentRunRelationship =
  | "root"
  | "agent_as_tool"
  | "handoff"
  | "graph_node"
  | "workflow_step"
  | "a2a";
export type AgentRunStatus =
  | "queued"
  | "running"
  | "auth_required"
  | "waiting_for_action"
  | "completed"
  | "failed"
  | "cancelled";
export type PendingInputStatus = "pending" | "consumed" | "cancelled";
export type RequiredActionStatus =
  | "pending"
  | "resolved"
  | "declined"
  | "expired"
  | "cancelled";
export type ToolCallStatus = "pending" | "succeeded" | "failed";
export type AuditActorType = "agent" | "user";
export type AuditOutcome = "succeeded" | "failed";
export type AppPermission =
  | "read:dashboard"
  | "read:devices"
  | "read:incidents"
  | "read:telemetry"
  | "write:agent_runs"
  | "write:admin";

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
  createdBy?: AuditActor;
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
  createdBy?: AuditActor;
}

export interface Ticket {
  id: string;
  incidentId: string;
  externalRef: string;
  status: TicketStatus;
  assigneeTeam: string;
  createdAt: string;
  createdBy?: AuditActor;
}

export interface AuditActor {
  actorType: AuditActorType;
  actorId: string;
  onBehalfOfUserId?: string;
  agentRunId?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: AuditActor;
  operation: string;
  method: string;
  path: string;
  scopes: string[];
  resourceType?: string;
  resourceId?: string;
  outcome: AuditOutcome;
  statusCode: number;
  message?: string;
}

export interface RunbookDocument {
  id: string;
  title: string;
  category: Incident["category"];
  summary: string;
  steps: string[];
}

export interface Conversation {
  id: string;
  rootAgentKind: AgentKind;
  status: ConversationStatus;
  activeRootRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeSession {
  id: string;
  provider: string;
  runtimeIdentity: string;
  providerSessionId: string;
  conversationId: string;
  status: RuntimeSessionStatus;
  createdAt: string;
  lastUsedAt?: string;
}

export interface AgentRun {
  id: string;
  conversationId: string;
  incidentId?: string;
  deviceId?: string;
  runtimeSessionId?: string;
  agentKind: AgentKind;
  relationship: AgentRunRelationship;
  parentRunId?: string;
  causedByRunItemId?: string;
  status: AgentRunStatus;
  startedAt?: string;
  requestedByUserId?: string;
  completedAt?: string;
  summary?: string;
  investigation?: AgentRunInvestigationSummary;
  authRequired?: AgentRunAuthRequired;
  errorMessage?: string;
}

export interface AgentRunSnapshot {
  id: string;
  runId: string;
  requiredActionId: string;
  provider: "strands";
  kind: "interrupt_resume";
  snapshot: unknown;
  createdAt: string;
}

export interface AgentRunInvestigationSummary {
  title: string;
  summary: string;
  findings: string[];
  recommendedActions: string[];
}

export interface AgentRunAuthRequired {
  providerName: string;
  providerDisplayName?: string;
  authUrl: string;
  scopes: string[];
  agentRunId: string;
}

export type RunItemSource =
  | { type: "user"; userId: string }
  | { type: "agent"; agentRunId: string; agentKind: AgentKind }
  | { type: "system" }
  | { type: "tool"; toolName: string }
  | { type: "external_service"; service: string };

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "json"; value: unknown }
  | { type: "image"; fileId: string; alt?: string }
  | { type: "file"; fileId: string; name?: string; mediaType?: string }
  | { type: "resource_ref"; resourceType: string; resourceId: string };

export type RunItemKind =
  | "message"
  | "tool_call"
  | "tool_result"
  | "required_action"
  | "action_resolution"
  | "run_agent"
  | "run_note";

export interface RunItemBase {
  id: string;
  runId: string;
  sequence: number;
  kind: RunItemKind;
  source: RunItemSource;
  createdAt: string;
}

export interface MessageRunItem extends RunItemBase {
  kind: "message";
  role: "user" | "agent" | "system";
  content: ContentBlock[];
}

export interface ToolCallRunItem extends RunItemBase {
  kind: "tool_call";
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  status: ToolCallStatus;
}

export interface ToolResultRunItem extends RunItemBase {
  kind: "tool_result";
  toolCallId: string;
  content: ContentBlock[];
  isError?: boolean;
}

export interface RequiredActionRunItem extends RunItemBase {
  kind: "required_action";
  requiredActionId: string;
  actionType: string;
  status: RequiredActionStatus;
  content: ContentBlock[];
  data?: unknown;
  resolvedAt?: string;
  resolvedBy?: RunItemSource;
}

export interface ActionResolutionRunItem extends RunItemBase {
  kind: "action_resolution";
  requiredActionId: string;
  outcome: Exclude<RequiredActionStatus, "pending">;
  content?: ContentBlock[];
  data?: unknown;
}

export interface RunAgentRunItem extends RunItemBase {
  kind: "run_agent";
  relationship: Exclude<AgentRunRelationship, "root">;
  agentKind: AgentKind;
  childRunId: string;
  toolCallId?: string;
  status: AgentRunStatus;
}

export interface RunNoteRunItem extends RunItemBase {
  kind: "run_note";
  noteType: string;
  message: string;
  data?: unknown;
}

export type RunItem =
  | MessageRunItem
  | ToolCallRunItem
  | ToolResultRunItem
  | RequiredActionRunItem
  | ActionResolutionRunItem
  | RunAgentRunItem
  | RunNoteRunItem;

export interface PendingInput {
  id: string;
  conversationId: string;
  source: Extract<RunItemSource, { type: "user" }>;
  content: ContentBlock[];
  status: PendingInputStatus;
  acceptedAt: string;
  consumedByRunId?: string;
  consumedAt?: string;
}

/**
 * Client read model projected from the canonical Conversation, AgentRuns,
 * RuntimeSessions, and RunItems. UI code may render from this shape, but
 * should not treat it as a separate source of truth.
 */
export interface ConversationDetail {
  conversation: Conversation;
  runs: AgentRun[];
  itemsByRunId: Record<string, RunItem[]>;
  runtimeSessions: RuntimeSession[];
}

export interface CreateConversationRequest {
  agentKind: AgentKind;
  prompt: string;
  incidentId?: string;
  deviceId?: string;
}

export interface CreateConversationRunRequest {
  prompt: string;
  incidentId?: string;
  deviceId?: string;
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

/**
 * Agent-facing input projection. The backend builds this from Conversation,
 * AgentRun, RuntimeSession, user input, and minimal domain identifiers before
 * invoking the provider runtime. Agents retrieve operational context through
 * tools instead of receiving prehydrated investigation data.
 */
export interface AgentRuntimeInvocation {
  conversationId: string;
  agentRunId: string;
  runtimeSessionId?: string;
  providerSessionId?: string;
  agentKind: AgentKind;
  prompt: string;
  incidentId?: string;
  deviceId?: string;
  actorId?: string;
  resume?: AgentRuntimeInterruptResume;
}

export interface AgentRuntimeInterruptResume {
  requiredActionId: string;
  interruptId: string;
  snapshot: unknown;
  response: {
    approved: boolean;
    comment?: string;
    resolvedByUserId?: string;
  };
}

/**
 * Agent-facing streaming projection. Runtime lifecycle scaffolding owns
 * canonical RunItem and AgentRun writes; SSE events let callers refresh UI
 * read models as progress is persisted.
 */
export type AgentRuntimeStreamEvent =
  | {
      event: "message";
      data: { text: string };
    }
  | {
      event: "summary";
      data: {
        summary?: string;
        title?: string;
        findings?: string[];
        recommendedActions?: string[];
      };
    }
  | {
      event: "tool_call";
      data: {
        toolCallId: string;
        toolName: string;
        arguments: unknown;
        status?: ToolCallStatus;
      };
    }
  | {
      event: "tool_result";
      data: {
        toolCallId: string;
        toolName?: string;
        content: unknown;
        isError?: boolean;
      };
    }
  | {
      event: "required_action";
      data: {
        requiredActionId: string;
        actionType: string;
        content: ContentBlock[];
        data?: unknown;
      };
    }
  | {
      event: "action_resolution";
      data: {
        requiredActionId: string;
        outcome: Exclude<RequiredActionStatus, "pending">;
        content?: ContentBlock[];
        data?: unknown;
      };
    }
  | {
      event: "run_agent";
      data: {
        relationship: Exclude<AgentRunRelationship, "root">;
        agentKind: AgentKind;
        childRunId: string;
        toolCallId?: string;
        status: AgentRunStatus;
      };
    }
  | {
      event: "auth_required";
      data: AgentRunAuthRequired & {
        requiredActionId?: string;
      };
    }
  | {
      event: "run_note";
      data: {
        noteType: string;
        message: string;
        data?: unknown;
      };
    };

export interface AgentRunResult {
  summary: string;
  investigation?: AgentRunInvestigationSummary;
  authRequired?: AgentRunAuthRequired;
}

export type AgentRunStreamEvent =
  | {
      event: "run";
      data: AgentRun;
    }
  | {
      event: "message";
      data: { text: string };
    }
  | {
      event: "summary";
      data: {
        summary?: string;
        title?: string;
        findings?: string[];
        recommendedActions?: string[];
      };
    }
  | {
      event: "auth_required";
      data: AgentRunAuthRequired;
    }
  | {
      event: "error";
      data: { message: string };
    };

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
  clientId?: string;
  scopes: string[];
  permissions: AppPermission[];
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
  conversations: Conversation[];
  runtimeSessions: RuntimeSession[];
  agentRuns: AgentRun[];
  runItems: RunItem[];
  pendingInputs: PendingInput[];
  auditLogs: AuditLogEntry[];
  dashboard: DashboardSummary;
}
