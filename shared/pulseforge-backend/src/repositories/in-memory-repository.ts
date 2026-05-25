import {
  type AgentRun,
  type AuditLogEntry,
  type Conversation,
  demoAuditLogs,
  demoAgentRuns,
  demoConversations,
  demoDashboard,
  demoDeviceMetrics,
  demoDevices,
  demoIncidentEvents,
  demoIncidents,
  demoPendingInputs,
  demoRemediationActions,
  demoRuntimeSessions,
  demoRunItems,
  demoSites,
  demoSnapshot,
  demoTickets,
  type PendingInput,
  type RuntimeSession,
  type RunItem,
  type DashboardSummary,
  type Device,
  type DeviceMetricSnapshot,
  type Incident,
  type IncidentEvent,
  type PulseForgeSnapshot,
  type RemediationAction,
  type Ticket,
} from "@agent-core/pulseforge-domain";
import { randomUUID } from "node:crypto";
import type {
  AppendRunItemInput,
  IncidentAggregate,
  PulseForgeRepository,
} from "./types.js";

export class InMemoryPulseForgeRepository implements PulseForgeRepository {
  private readonly conversations = new Map<string, Conversation>(
    demoConversations.map((conversation) => [conversation.id, conversation])
  );
  private readonly runtimeSessions = new Map<string, RuntimeSession>(
    demoRuntimeSessions.map((session) => [session.id, session])
  );
  private readonly agentRuns = new Map<string, AgentRun>(
    demoAgentRuns.map((run) => [run.id, run])
  );
  private readonly runItems = new Map<string, RunItem>(
    demoRunItems.map((item) => [item.id, item])
  );
  private readonly pendingInputs = new Map<string, PendingInput>(
    demoPendingInputs.map((input) => [input.id, input])
  );
  private readonly incidentEvents = new Map<string, IncidentEvent>(
    demoIncidentEvents.map((event) => [event.id, event])
  );
  private readonly remediationActions = new Map<string, RemediationAction>(
    demoRemediationActions.map((action) => [action.id, action])
  );
  private readonly tickets = new Map<string, Ticket>(
    demoTickets.map((ticket) => [ticket.id, ticket])
  );
  private readonly auditLogs = new Map<string, AuditLogEntry>(
    demoAuditLogs.map((entry) => [entry.id, entry])
  );

  async getSnapshot(): Promise<PulseForgeSnapshot> {
    return {
      ...demoSnapshot,
      incidentEvents: [...this.incidentEvents.values()],
      remediationActions: [...this.remediationActions.values()],
      tickets: [...this.tickets.values()],
      conversations: [...this.conversations.values()],
      runtimeSessions: [...this.runtimeSessions.values()],
      agentRuns: [...this.agentRuns.values()],
      runItems: [...this.runItems.values()],
      pendingInputs: [...this.pendingInputs.values()],
      auditLogs: [...this.auditLogs.values()],
    };
  }

  async getDashboard(): Promise<DashboardSummary> {
    return demoDashboard;
  }

  async listDevices(): Promise<Device[]> {
    return demoDevices;
  }

  async getDevice(deviceId: string): Promise<Device | null> {
    return demoDevices.find((device) => device.id === deviceId) ?? null;
  }

  async getDeviceTelemetry(
    deviceId: string
  ): Promise<DeviceMetricSnapshot[] | null> {
    return demoDeviceMetrics[deviceId] ?? null;
  }

  async listIncidents(): Promise<Incident[]> {
    return demoIncidents;
  }

  async getIncident(incidentId: string): Promise<IncidentAggregate | null> {
    const incident = demoIncidents.find((item) => item.id === incidentId) ?? null;
    if (!incident) {
      return null;
    }

    return {
      incident,
      events: [...this.incidentEvents.values()].filter(
        (event) => event.incidentId === incidentId
      ),
    };
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    return this.conversations.get(conversationId) ?? null;
  }

  async createConversation(
    conversation: Parameters<PulseForgeRepository["createConversation"]>[0]
  ): Promise<Conversation> {
    const now = new Date().toISOString();
    const created: Conversation = {
      id: conversation.id,
      rootAgentKind: conversation.rootAgentKind,
      status: conversation.status ?? "open",
      activeRootRunId: conversation.activeRootRunId,
      createdAt: conversation.createdAt ?? now,
      updatedAt: conversation.updatedAt ?? now,
    };

    this.conversations.set(created.id, created);
    return created;
  }

  async updateConversationActiveRun(
    conversationId: string,
    activeRootRunId: string | null
  ): Promise<Conversation | null> {
    const existing = this.conversations.get(conversationId);
    if (!existing) {
      return null;
    }

    const updated: Conversation = {
      ...existing,
      activeRootRunId: activeRootRunId ?? undefined,
      updatedAt: new Date().toISOString(),
    };
    this.conversations.set(conversationId, updated);
    return updated;
  }

  async claimConversationActiveRun(
    conversationId: string,
    activeRootRunId: string
  ): Promise<Conversation | null> {
    const existing = this.conversations.get(conversationId);
    if (!existing || existing.activeRootRunId) {
      return null;
    }

    const updated: Conversation = {
      ...existing,
      activeRootRunId,
      updatedAt: new Date().toISOString(),
    };
    this.conversations.set(conversationId, updated);
    return updated;
  }

  async listRuntimeSessions(conversationId: string): Promise<RuntimeSession[]> {
    return [...this.runtimeSessions.values()].filter(
      (session) => session.conversationId === conversationId
    );
  }

  async getRuntimeSessionByProvider(
    conversationId: string,
    provider: string,
    runtimeIdentity: string
  ): Promise<RuntimeSession | null> {
    return (
      [...this.runtimeSessions.values()].find(
        (session) =>
          session.conversationId === conversationId &&
          session.provider === provider &&
          session.runtimeIdentity === runtimeIdentity
      ) ?? null
    );
  }

  async createRuntimeSession(
    session: Parameters<PulseForgeRepository["createRuntimeSession"]>[0]
  ): Promise<RuntimeSession> {
    const now = new Date().toISOString();
    const created: RuntimeSession = {
      id: session.id,
      provider: session.provider,
      runtimeIdentity: session.runtimeIdentity,
      providerSessionId: session.providerSessionId,
      conversationId: session.conversationId,
      status: session.status ?? "active",
      createdAt: session.createdAt ?? now,
      lastUsedAt: session.lastUsedAt ?? now,
    };

    this.runtimeSessions.set(created.id, created);
    return created;
  }

  async touchRuntimeSession(
    sessionId: string,
    status: RuntimeSession["status"] = "active"
  ): Promise<RuntimeSession | null> {
    const existing = this.runtimeSessions.get(sessionId);
    if (!existing) {
      return null;
    }

    const updated: RuntimeSession = {
      ...existing,
      status,
      lastUsedAt: new Date().toISOString(),
    };
    this.runtimeSessions.set(sessionId, updated);
    return updated;
  }

  async getAgentRun(runId: string): Promise<AgentRun | null> {
    return this.agentRuns.get(runId) ?? null;
  }

  async listAgentRuns(conversationId: string): Promise<AgentRun[]> {
    return [...this.agentRuns.values()]
      .filter((run) => run.conversationId === conversationId)
      .sort((left, right) =>
        (left.startedAt ?? "").localeCompare(right.startedAt ?? "")
      );
  }

  async createAgentRun(
    run: Parameters<PulseForgeRepository["createAgentRun"]>[0]
  ): Promise<AgentRun> {
    const created: AgentRun = {
      id: run.id,
      conversationId: run.conversationId,
      incidentId: run.incidentId,
      deviceId: run.deviceId,
      runtimeSessionId: run.runtimeSessionId,
      agentKind: run.agentKind,
      relationship: run.relationship,
      parentRunId: run.parentRunId,
      causedByRunItemId: run.causedByRunItemId,
      status: run.status ?? "running",
      startedAt: run.startedAt ?? new Date().toISOString(),
      requestedByUserId: run.requestedByUserId,
      completedAt: run.completedAt,
      summary: run.summary,
      investigation: run.investigation,
      authRequired: run.authRequired,
      errorMessage: run.errorMessage,
    };

    this.agentRuns.set(created.id, created);
    return created;
  }

  async updateAgentRunStatus(
    runId: string,
    update: Parameters<PulseForgeRepository["updateAgentRunStatus"]>[1]
  ): Promise<AgentRun | null> {
    const existing = this.agentRuns.get(runId);
    if (!existing) {
      return null;
    }

    const updated: AgentRun = {
      ...existing,
      status: update.status,
      completedAt:
        update.completedAt ??
        (isTerminalAgentRunStatus(update.status) ? new Date().toISOString() : existing.completedAt),
      summary: update.summary ?? existing.summary,
      investigation: update.investigation ?? existing.investigation,
      authRequired: update.authRequired ?? existing.authRequired,
      errorMessage: update.errorMessage ?? existing.errorMessage,
    };

    this.agentRuns.set(runId, updated);
    return updated;
  }

  async appendRunItems(
    runId: string,
    items: AppendRunItemInput[]
  ): Promise<RunItem[]> {
    const nextSequence = this.nextRunItemSequence(runId);
    const created = items.map((item, index) => ({
      ...item,
      id: item.id ?? randomUUID(),
      runId,
      sequence: nextSequence + index,
      createdAt: item.createdAt ?? new Date().toISOString(),
    }) as RunItem);

    for (const item of created) {
      this.runItems.set(item.id, item);
    }

    return created;
  }

  async listRunItems(runId: string): Promise<RunItem[]> {
    return [...this.runItems.values()]
      .filter((item) => item.runId === runId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async listPendingInputs(conversationId: string): Promise<PendingInput[]> {
    return [...this.pendingInputs.values()].filter(
      (input) => input.conversationId === conversationId
    );
  }

  private nextRunItemSequence(runId: string): number {
    const items = [...this.runItems.values()].filter(
      (item) => item.runId === runId
    );
    if (items.length === 0) {
      return 0;
    }

    return Math.max(...items.map((item) => item.sequence)) + 1;
  }

  async createIncidentEvent(
    event: Parameters<PulseForgeRepository["createIncidentEvent"]>[0]
  ): Promise<IncidentEvent> {
    const created: IncidentEvent = {
      id: event.id ?? randomUUID(),
      incidentId: event.incidentId,
      timestamp: event.timestamp ?? new Date().toISOString(),
      kind: event.kind,
      message: event.message,
      createdBy: event.createdBy,
    };

    this.incidentEvents.set(created.id, created);
    return created;
  }

  async createTicket(
    ticket: Parameters<PulseForgeRepository["createTicket"]>[0]
  ): Promise<Ticket> {
    const created: Ticket = {
      id: ticket.id ?? randomUUID(),
      incidentId: ticket.incidentId,
      externalRef: ticket.externalRef ?? `PF-${this.tickets.size + 1000}`,
      status: ticket.status ?? "open",
      assigneeTeam: ticket.assigneeTeam,
      createdAt: ticket.createdAt ?? new Date().toISOString(),
      createdBy: ticket.createdBy,
    };

    this.tickets.set(created.id, created);
    return created;
  }

  async createRemediationAction(
    action: Parameters<PulseForgeRepository["createRemediationAction"]>[0]
  ): Promise<RemediationAction> {
    const created: RemediationAction = {
      id: action.id ?? randomUUID(),
      incidentId: action.incidentId,
      type: action.type,
      status: action.status ?? "proposed",
      risk: action.risk,
      summary: action.summary,
      createdBy: action.createdBy,
    };

    this.remediationActions.set(created.id, created);
    return created;
  }

  async createAuditLog(
    entry: Parameters<PulseForgeRepository["createAuditLog"]>[0]
  ): Promise<AuditLogEntry> {
    const created: AuditLogEntry = {
      id: entry.id ?? randomUUID(),
      timestamp: entry.timestamp ?? new Date().toISOString(),
      actor: entry.actor,
      operation: entry.operation,
      method: entry.method,
      path: entry.path,
      scopes: entry.scopes,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      outcome: entry.outcome,
      statusCode: entry.statusCode,
      message: entry.message,
    };

    this.auditLogs.set(created.id, created);
    return created;
  }

  async seedDemoData(): Promise<void> {
    void demoSites;
    void demoDevices;
    void demoDeviceMetrics;
    void demoIncidents;

    this.incidentEvents.clear();
    this.remediationActions.clear();
    this.tickets.clear();
    this.agentRuns.clear();
    this.conversations.clear();
    this.runtimeSessions.clear();
    this.runItems.clear();
    this.pendingInputs.clear();
    this.auditLogs.clear();

    for (const conversation of demoConversations) {
      this.conversations.set(conversation.id, conversation);
    }
    for (const session of demoRuntimeSessions) {
      this.runtimeSessions.set(session.id, session);
    }
    for (const item of demoRunItems) {
      this.runItems.set(item.id, item);
    }
    for (const input of demoPendingInputs) {
      this.pendingInputs.set(input.id, input);
    }
    for (const event of demoIncidentEvents) {
      this.incidentEvents.set(event.id, event);
    }
    for (const action of demoRemediationActions) {
      this.remediationActions.set(action.id, action);
    }
    for (const ticket of demoTickets) {
      this.tickets.set(ticket.id, ticket);
    }
    for (const run of demoAgentRuns) {
      this.agentRuns.set(run.id, run);
    }
    for (const entry of demoAuditLogs) {
      this.auditLogs.set(entry.id, entry);
    }
  }
}

function isTerminalAgentRunStatus(status: AgentRun["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}
