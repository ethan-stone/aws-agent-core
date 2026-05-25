import type {
  AgentRun,
  AuditActor,
  AuditLogEntry,
  Conversation,
  DashboardSummary,
  Device,
  DeviceMetricSnapshot,
  Incident,
  IncidentEvent,
  PendingInput,
  PulseForgeSnapshot,
  RequiredActionStatus,
  RemediationAction,
  RuntimeSession,
  RunItem,
  RunItemSource,
  Ticket,
} from "@agent-core/pulseforge-domain";

export interface IncidentAggregate {
  incident: Incident;
  events: IncidentEvent[];
}

export type AppendRunItemInput = RunItem extends infer Item
  ? Item extends RunItem
    ? Omit<Item, "id" | "sequence" | "createdAt"> & {
        id?: string;
        createdAt?: string;
      }
    : never
  : never;

export interface PulseForgeRepository {
  getSnapshot(): Promise<PulseForgeSnapshot>;
  getDashboard(): Promise<DashboardSummary>;
  listDevices(): Promise<Device[]>;
  getDevice(deviceId: string): Promise<Device | null>;
  getDeviceTelemetry(deviceId: string): Promise<DeviceMetricSnapshot[] | null>;
  listIncidents(): Promise<Incident[]>;
  getIncident(incidentId: string): Promise<IncidentAggregate | null>;
  getConversation(conversationId: string): Promise<Conversation | null>;
  createConversation(
    conversation: Omit<Conversation, "createdAt" | "updatedAt" | "status"> & {
      status?: Conversation["status"];
      createdAt?: string;
      updatedAt?: string;
    }
  ): Promise<Conversation>;
  updateConversationActiveRun(
    conversationId: string,
    activeRootRunId: string | null
  ): Promise<Conversation | null>;
  claimConversationActiveRun(
    conversationId: string,
    activeRootRunId: string
  ): Promise<Conversation | null>;
  listRuntimeSessions(conversationId: string): Promise<RuntimeSession[]>;
  getRuntimeSessionByProvider(
    conversationId: string,
    provider: string,
    runtimeIdentity: string
  ): Promise<RuntimeSession | null>;
  createRuntimeSession(
    session: Omit<RuntimeSession, "createdAt" | "status"> & {
      status?: RuntimeSession["status"];
      createdAt?: string;
    }
  ): Promise<RuntimeSession>;
  touchRuntimeSession(
    sessionId: string,
    status?: RuntimeSession["status"]
  ): Promise<RuntimeSession | null>;
  getAgentRun(runId: string): Promise<AgentRun | null>;
  listAgentRuns(conversationId: string): Promise<AgentRun[]>;
  createAgentRun(
    run: Omit<AgentRun, "startedAt" | "status"> & {
      status?: AgentRun["status"];
      startedAt?: string;
    }
  ): Promise<AgentRun>;
  updateAgentRunStatus(
    runId: string,
    update: {
      status: AgentRun["status"];
      summary?: string;
      investigation?: AgentRun["investigation"];
      authRequired?: AgentRun["authRequired"];
      errorMessage?: string;
      completedAt?: string;
    }
  ): Promise<AgentRun | null>;
  appendRunItems(runId: string, items: AppendRunItemInput[]): Promise<RunItem[]>;
  updateRequiredActionStatus(
    runId: string,
    requiredActionId: string,
    update: {
      status: Exclude<RequiredActionStatus, "pending">;
      resolvedAt?: string;
      resolvedBy?: RunItemSource;
    }
  ): Promise<RunItem | null>;
  listRunItems(runId: string): Promise<RunItem[]>;
  listPendingInputs(conversationId: string): Promise<PendingInput[]>;
  createIncidentEvent(event: Omit<IncidentEvent, "id" | "timestamp"> & {
    id?: string;
    timestamp?: string;
    createdBy: AuditActor;
  }): Promise<IncidentEvent>;
  createTicket(ticket: Omit<Ticket, "id" | "createdAt" | "externalRef" | "status"> & {
    id?: string;
    externalRef?: string;
    status?: Ticket["status"];
    createdAt?: string;
    createdBy: AuditActor;
  }): Promise<Ticket>;
  createRemediationAction(
    action: Omit<RemediationAction, "id" | "status"> & {
      id?: string;
      status?: RemediationAction["status"];
      createdBy: AuditActor;
    }
  ): Promise<RemediationAction>;
  createAuditLog(
    entry: Omit<AuditLogEntry, "id" | "timestamp"> & {
      id?: string;
      timestamp?: string;
    }
  ): Promise<AuditLogEntry>;
  seedDemoData(): Promise<void>;
}
