import type {
  AgentRun,
  AgentRunSnapshot,
  AuditActor,
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
  RequiredActionStatus,
  RemediationAction,
  RuntimeSession,
  RunItem,
  RunItemSource,
  Ticket,
  ToolApprovalGrant,
} from "@agent-core/pulseforge-domain";

export interface IncidentAggregate {
  incident: Incident;
  activities: IncidentActivity[];
  comments: IncidentComment[];
  agentMentions: IncidentAgentMention[];
  actionApprovals: IncidentActionApproval[];
}

export type AppendRunItemInput = RunItem extends infer Item
  ? Item extends RunItem
    ? Omit<Item, "id" | "sequence" | "createdAt"> & {
        id?: string;
        createdAt?: string;
      }
    : never
  : never;

export type UpsertToolApprovalGrantInput = Omit<
  ToolApprovalGrant,
  "id" | "grantedAt"
> & {
  id?: string;
  grantedAt?: string;
};

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
  upsertConversationToolApprovalGrant(
    conversationId: string,
    grant: UpsertToolApprovalGrantInput
  ): Promise<ToolApprovalGrant | null>;
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
  createAgentRunSnapshot(
    snapshot: Omit<AgentRunSnapshot, "createdAt"> & {
      createdAt?: string;
    }
  ): Promise<AgentRunSnapshot>;
  getAgentRunSnapshot(snapshotId: string): Promise<AgentRunSnapshot | null>;
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
  updateToolCallStatus(
    runId: string,
    toolCallId: string,
    status: Extract<RunItem, { kind: "tool_call" }>["status"]
  ): Promise<RunItem | null>;
  listRunItems(runId: string): Promise<RunItem[]>;
  listPendingInputs(conversationId: string): Promise<PendingInput[]>;
  createIncidentActivity(activity: Omit<IncidentActivity, "id" | "timestamp"> & {
    id?: string;
    timestamp?: string;
    createdBy: AuditActor;
  }): Promise<IncidentActivity>;
  updateIncidentActivity(
    activityId: string,
    update: Partial<
      Pick<
        IncidentActivity,
        "agentRunId" | "agentStatus" | "title" | "summary" | "message" | "incidentActionApprovalId"
      >
    >
  ): Promise<IncidentActivity | null>;
  updateIncidentActivityByAgentRun(
    agentRunId: string,
    update: Partial<
      Pick<
        IncidentActivity,
        "agentStatus" | "title" | "summary" | "message" | "incidentActionApprovalId"
      >
    >
  ): Promise<IncidentActivity | null>;
  createIncidentComment(comment: Omit<IncidentComment, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
  }): Promise<IncidentComment>;
  createIncidentAgentMention(
    mention: Omit<IncidentAgentMention, "id" | "createdAt"> & {
      id?: string;
      createdAt?: string;
    }
  ): Promise<IncidentAgentMention>;
  updateIncidentAgentMention(
    mentionId: string,
    update: Partial<
      Pick<
        IncidentAgentMention,
        "status" | "conversationId" | "agentRunId" | "activityId" | "acceptedAt" | "errorMessage"
      >
    >
  ): Promise<IncidentAgentMention | null>;
  createIncidentActionApproval(
    approval: Omit<IncidentActionApproval, "id" | "requestedAt" | "status"> & {
      id?: string;
      requestedAt?: string;
      status?: IncidentActionApproval["status"];
    }
  ): Promise<IncidentActionApproval>;
  updateIncidentActionApprovalStatus(
    approvalId: string,
    update: Pick<IncidentActionApproval, "status"> &
      Partial<Pick<IncidentActionApproval, "resolvedAt" | "resolvedByUserId" | "activityId">>
  ): Promise<IncidentActionApproval | null>;
  updateIncidentActionApprovalByRequiredAction(
    agentRunId: string,
    requiredActionId: string,
    update: Pick<IncidentActionApproval, "status"> &
      Partial<Pick<IncidentActionApproval, "resolvedAt" | "resolvedByUserId" | "activityId">>
  ): Promise<IncidentActionApproval | null>;
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
