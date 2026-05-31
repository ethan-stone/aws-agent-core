import {
  type AgentRun,
  type AgentRunSnapshot,
  type AuditLogEntry,
  type Conversation,
  demoAuditLogs,
  demoAgentRuns,
  demoConversations,
  demoDashboard,
  demoDeviceMetrics,
  demoDevices,
  demoIncidentActionApprovals,
  demoIncidentActivities,
  demoIncidentAgentMentions,
  demoIncidentComments,
  demoIncidents,
  demoPendingInputs,
  demoRemediationActions,
  demoRuntimeSessions,
  demoRunItems,
  demoSimulationScenarios,
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
  type IncidentActionApproval,
  type IncidentActivity,
  type IncidentAgentMention,
  type IncidentComment,
  type PulseForgeSnapshot,
  type RemediationAction,
  type SimulationScenario,
  type Site,
  type Ticket,
  type ToolApprovalGrant,
} from "@agent-core/pulseforge-domain";
import { randomUUID } from "node:crypto";
import type {
  AppendRunItemInput,
  IncidentAggregate,
  PulseForgeRepository,
} from "./types.js";

export class InMemoryPulseForgeRepository implements PulseForgeRepository {
  private readonly sites = new Map<string, Site>(
    demoSites.map((site) => [site.id, site])
  );
  private readonly devices = new Map<string, Device>(
    demoDevices.map((device) => [device.id, device])
  );
  private readonly deviceMetrics = new Map<string, DeviceMetricSnapshot[]>(
    Object.entries(demoDeviceMetrics).map(([deviceId, metrics]) => [
      deviceId,
      [...metrics],
    ])
  );
  private readonly incidents = new Map<string, Incident>(
    demoIncidents.map((incident) => [incident.id, incident])
  );
  private readonly simulationScenarios = new Map<string, SimulationScenario>(
    demoSimulationScenarios.map((scenario) => [scenario.id, scenario])
  );
  private readonly conversations = new Map<string, Conversation>(
    demoConversations.map((conversation) => [conversation.id, conversation])
  );
  private readonly runtimeSessions = new Map<string, RuntimeSession>(
    demoRuntimeSessions.map((session) => [session.id, session])
  );
  private readonly agentRuns = new Map<string, AgentRun>(
    demoAgentRuns.map((run) => [run.id, run])
  );
  private readonly agentRunSnapshots = new Map<string, AgentRunSnapshot>();
  private readonly runItems = new Map<string, RunItem>(
    demoRunItems.map((item) => [item.id, item])
  );
  private readonly pendingInputs = new Map<string, PendingInput>(
    demoPendingInputs.map((input) => [input.id, input])
  );
  private readonly incidentActivities = new Map<string, IncidentActivity>(
    demoIncidentActivities.map((activity) => [activity.id, activity])
  );
  private readonly incidentComments = new Map<string, IncidentComment>(
    demoIncidentComments.map((comment) => [comment.id, comment])
  );
  private readonly incidentAgentMentions = new Map<string, IncidentAgentMention>(
    demoIncidentAgentMentions.map((mention) => [mention.id, mention])
  );
  private readonly incidentActionApprovals = new Map<string, IncidentActionApproval>(
    demoIncidentActionApprovals.map((approval) => [approval.id, approval])
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
      sites: [...this.sites.values()],
      devices: [...this.devices.values()],
      deviceMetrics: Object.fromEntries(this.deviceMetrics.entries()),
      incidents: [...this.incidents.values()],
      incidentActivities: [...this.incidentActivities.values()],
      incidentComments: [...this.incidentComments.values()],
      incidentAgentMentions: [...this.incidentAgentMentions.values()],
      incidentActionApprovals: [...this.incidentActionApprovals.values()],
      remediationActions: [...this.remediationActions.values()],
      tickets: [...this.tickets.values()],
      conversations: [...this.conversations.values()],
      runtimeSessions: [...this.runtimeSessions.values()],
      agentRuns: [...this.agentRuns.values()],
      runItems: [...this.runItems.values()],
      pendingInputs: [...this.pendingInputs.values()],
      auditLogs: [...this.auditLogs.values()],
      simulationScenarios: [...this.simulationScenarios.values()],
    };
  }

  async getDashboard(): Promise<DashboardSummary> {
    return buildDashboard(
      [...this.devices.values()],
      [...this.incidents.values()],
      this.sites.size
    );
  }

  async listDevices(): Promise<Device[]> {
    return [...this.devices.values()].sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }

  async getDevice(deviceId: string): Promise<Device | null> {
    return this.devices.get(deviceId) ?? null;
  }

  async createDevice(
    device: Parameters<PulseForgeRepository["createDevice"]>[0]
  ): Promise<Device> {
    const created: Device = {
      ...device,
      source: device.source ?? "simulated",
      batteryPercent: device.batteryPercent ?? 100,
      connectivityPercent: device.connectivityPercent ?? 100,
      status: device.status ?? "healthy",
      lastSeenAt: device.lastSeenAt ?? new Date().toISOString(),
    };
    this.devices.set(created.id, created);
    this.deviceMetrics.set(created.id, []);
    return created;
  }

  async updateDeviceCurrentState(
    deviceId: string,
    update: Parameters<PulseForgeRepository["updateDeviceCurrentState"]>[1]
  ): Promise<Device | null> {
    const existing = this.devices.get(deviceId);
    if (!existing) {
      return null;
    }
    const updated = { ...existing, ...update };
    this.devices.set(deviceId, updated);
    return updated;
  }

  async getDeviceTelemetry(
    deviceId: string
  ): Promise<DeviceMetricSnapshot[] | null> {
    return this.deviceMetrics.get(deviceId) ?? null;
  }

  async appendDeviceTelemetry(
    deviceId: string,
    metric: DeviceMetricSnapshot
  ): Promise<DeviceMetricSnapshot> {
    const metrics = this.deviceMetrics.get(deviceId) ?? [];
    metrics.push(metric);
    this.deviceMetrics.set(deviceId, metrics);
    return metric;
  }

  async listIncidents(): Promise<Incident[]> {
    return [...this.incidents.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }

  async getIncident(incidentId: string): Promise<IncidentAggregate | null> {
    const incident = this.incidents.get(incidentId) ?? null;
    if (!incident) {
      return null;
    }

    return {
      incident,
      activities: [...this.incidentActivities.values()].filter(
        (activity) => activity.incidentId === incidentId
      ),
      comments: [...this.incidentComments.values()].filter(
        (comment) => comment.incidentId === incidentId
      ),
      agentMentions: [...this.incidentAgentMentions.values()].filter(
        (mention) => mention.incidentId === incidentId
      ),
      actionApprovals: [...this.incidentActionApprovals.values()].filter(
        (approval) => approval.incidentId === incidentId
      ),
    };
  }

  async createIncident(
    incident: Parameters<PulseForgeRepository["createIncident"]>[0]
  ): Promise<Incident> {
    const now = new Date().toISOString();
    const created: Incident = {
      ...incident,
      id: incident.id ?? `inc-${randomUUID().slice(0, 8)}`,
      createdAt: incident.createdAt ?? now,
      updatedAt: incident.updatedAt ?? now,
    };
    this.incidents.set(created.id, created);
    return created;
  }

  async updateIncident(
    incidentId: string,
    update: Parameters<PulseForgeRepository["updateIncident"]>[1]
  ): Promise<Incident | null> {
    const existing = this.incidents.get(incidentId);
    if (!existing) {
      return null;
    }
    const updated = {
      ...existing,
      ...update,
      updatedAt: update.updatedAt ?? new Date().toISOString(),
    };
    this.incidents.set(incidentId, updated);
    return updated;
  }

  async findOpenIncidentForDeviceCategory(
    deviceId: string,
    category: Incident["category"]
  ): Promise<Incident | null> {
    return (
      [...this.incidents.values()].find(
        (incident) =>
          incident.category === category &&
          incident.deviceIds.includes(deviceId) &&
          incident.status !== "resolved"
      ) ?? null
    );
  }

  async listSimulationScenarios(
    statuses?: SimulationScenario["status"][]
  ): Promise<SimulationScenario[]> {
    return [...this.simulationScenarios.values()]
      .filter((scenario) => !statuses || statuses.includes(scenario.status))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createSimulationScenario(
    scenario: Parameters<PulseForgeRepository["createSimulationScenario"]>[0]
  ): Promise<SimulationScenario> {
    const created: SimulationScenario = {
      id: scenario.id ?? randomUUID(),
      deviceId: scenario.deviceId,
      type: scenario.type,
      status: scenario.status ?? "queued",
      durationMinutes: scenario.durationMinutes ?? 5,
      triggerAfterConsecutivePoints: scenario.triggerAfterConsecutivePoints ?? 1,
      consecutiveAffectedPoints: scenario.consecutiveAffectedPoints ?? 0,
      createdAt: scenario.createdAt ?? new Date().toISOString(),
      startedAt: scenario.startedAt,
      triggeredAt: scenario.triggeredAt,
      completedAt: scenario.completedAt,
      expiresAt: scenario.expiresAt,
      incidentId: scenario.incidentId,
      completedReason: scenario.completedReason,
    };
    this.simulationScenarios.set(created.id, created);
    return created;
  }

  async updateSimulationScenario(
    scenarioId: string,
    update: Parameters<PulseForgeRepository["updateSimulationScenario"]>[1]
  ): Promise<SimulationScenario | null> {
    const existing = this.simulationScenarios.get(scenarioId);
    if (!existing) {
      return null;
    }
    const updated = { ...existing, ...update };
    this.simulationScenarios.set(scenarioId, updated);
    return updated;
  }

  async completeActiveSimulationScenariosForDevice(
    deviceId: string,
    reason: NonNullable<SimulationScenario["completedReason"]>
  ): Promise<SimulationScenario[]> {
    const completed: SimulationScenario[] = [];
    const now = new Date().toISOString();
    for (const scenario of this.simulationScenarios.values()) {
      if (
        scenario.deviceId !== deviceId ||
        (scenario.status !== "queued" && scenario.status !== "active")
      ) {
        continue;
      }
      const updated: SimulationScenario = {
        ...scenario,
        status: "completed",
        completedAt: now,
        completedReason: reason,
      };
      this.simulationScenarios.set(updated.id, updated);
      completed.push(updated);
    }
    return completed;
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
      incidentId: conversation.incidentId,
      interactionMode: conversation.interactionMode,
      interactionOwnerUserId: conversation.interactionOwnerUserId,
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

  async upsertConversationToolApprovalGrant(
    conversationId: string,
    grant: Parameters<PulseForgeRepository["upsertConversationToolApprovalGrant"]>[1]
  ): Promise<ToolApprovalGrant | null> {
    const existing = this.conversations.get(conversationId);
    if (!existing || existing.status !== "open") {
      return null;
    }

    const grants = existing.toolApprovalGrants ?? [];
    const matchingGrant = grants.find(
      (item) =>
        item.grantedByUserId === grant.grantedByUserId &&
        item.toolName === grant.toolName &&
        item.approvalKey === grant.approvalKey
    );
    if (matchingGrant) {
      return matchingGrant;
    }

    const created: ToolApprovalGrant = {
      id: grant.id ?? randomUUID(),
      toolName: grant.toolName,
      approvalKey: grant.approvalKey,
      approvalLabel: grant.approvalLabel,
      grantedByUserId: grant.grantedByUserId,
      grantedAt: grant.grantedAt ?? new Date().toISOString(),
    };
    this.conversations.set(conversationId, {
      ...existing,
      toolApprovalGrants: [...grants, created],
      updatedAt: new Date().toISOString(),
    });
    return created;
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

  async createAgentRunSnapshot(
    snapshot: Parameters<PulseForgeRepository["createAgentRunSnapshot"]>[0]
  ): Promise<AgentRunSnapshot> {
    const created: AgentRunSnapshot = {
      ...snapshot,
      createdAt: snapshot.createdAt ?? new Date().toISOString(),
    };
    this.agentRunSnapshots.set(created.id, created);
    return created;
  }

  async getAgentRunSnapshot(snapshotId: string): Promise<AgentRunSnapshot | null> {
    return this.agentRunSnapshots.get(snapshotId) ?? null;
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
      authRequired: shouldClearAuthRequired(update.status)
        ? update.authRequired
        : update.authRequired ?? existing.authRequired,
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

  async updateRequiredActionStatus(
    runId: string,
    requiredActionId: string,
    update: Parameters<PulseForgeRepository["updateRequiredActionStatus"]>[2]
  ): Promise<RunItem | null> {
    const existing = [...this.runItems.values()].find(
      (item) =>
        item.runId === runId &&
        item.kind === "required_action" &&
        item.requiredActionId === requiredActionId
    );

    if (!existing || existing.kind !== "required_action") {
      return null;
    }

    const updated: RunItem = {
      ...existing,
      status: update.status,
      resolvedAt: update.resolvedAt ?? new Date().toISOString(),
      resolvedBy: update.resolvedBy,
    };
    this.runItems.set(existing.id, updated);
    return updated;
  }

  async updateToolCallStatus(
    runId: string,
    toolCallId: string,
    status: Parameters<PulseForgeRepository["updateToolCallStatus"]>[2]
  ): Promise<RunItem | null> {
    const existing = [...this.runItems.values()].find(
      (item) =>
        item.runId === runId &&
        item.kind === "tool_call" &&
        item.toolCallId === toolCallId
    );

    if (!existing || existing.kind !== "tool_call") {
      return null;
    }

    const updated: RunItem = {
      ...existing,
      status,
    };
    this.runItems.set(existing.id, updated);
    return updated;
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

  async createIncidentActivity(
    activity: Parameters<PulseForgeRepository["createIncidentActivity"]>[0]
  ): Promise<IncidentActivity> {
    const created: IncidentActivity = {
      id: activity.id ?? randomUUID(),
      incidentId: activity.incidentId,
      timestamp: activity.timestamp ?? new Date().toISOString(),
      kind: activity.kind,
      message: activity.message,
      createdBy: activity.createdBy,
      conversationId: activity.conversationId,
      agentRunId: activity.agentRunId,
      agentKind: activity.agentKind,
      agentStatus: activity.agentStatus,
      title: activity.title,
      summary: activity.summary,
      causedByCommentId: activity.causedByCommentId,
      causedByMentionId: activity.causedByMentionId,
      incidentActionApprovalId: activity.incidentActionApprovalId,
    };

    this.incidentActivities.set(created.id, created);
    return created;
  }

  async updateIncidentActivity(
    activityId: string,
    update: Parameters<PulseForgeRepository["updateIncidentActivity"]>[1]
  ): Promise<IncidentActivity | null> {
    const existing = this.incidentActivities.get(activityId);
    if (!existing) {
      return null;
    }
    const updated = { ...existing, ...update };
    this.incidentActivities.set(activityId, updated);
    return updated;
  }

  async updateIncidentActivityByAgentRun(
    agentRunId: string,
    update: Parameters<PulseForgeRepository["updateIncidentActivityByAgentRun"]>[1]
  ): Promise<IncidentActivity | null> {
    const existing = [...this.incidentActivities.values()].find(
      (activity) =>
        activity.kind === "agent_conversation" &&
        activity.agentRunId === agentRunId
    );
    if (!existing) {
      return null;
    }
    return this.updateIncidentActivity(existing.id, update);
  }

  async createIncidentComment(
    comment: Parameters<PulseForgeRepository["createIncidentComment"]>[0]
  ): Promise<IncidentComment> {
    const now = new Date().toISOString();
    const created: IncidentComment = {
      id: comment.id ?? randomUUID(),
      incidentId: comment.incidentId,
      body: comment.body,
      authorUserId: comment.authorUserId,
      createdAt: comment.createdAt ?? now,
      updatedAt: comment.updatedAt ?? comment.createdAt ?? now,
    };
    this.incidentComments.set(created.id, created);
    return created;
  }

  async createIncidentAgentMention(
    mention: Parameters<PulseForgeRepository["createIncidentAgentMention"]>[0]
  ): Promise<IncidentAgentMention> {
    const created: IncidentAgentMention = {
      ...mention,
      id: mention.id ?? randomUUID(),
      createdAt: mention.createdAt ?? new Date().toISOString(),
    };
    this.incidentAgentMentions.set(created.id, created);
    return created;
  }

  async updateIncidentAgentMention(
    mentionId: string,
    update: Parameters<PulseForgeRepository["updateIncidentAgentMention"]>[1]
  ): Promise<IncidentAgentMention | null> {
    const existing = this.incidentAgentMentions.get(mentionId);
    if (!existing) {
      return null;
    }
    const updated = { ...existing, ...update };
    this.incidentAgentMentions.set(mentionId, updated);
    return updated;
  }

  async createIncidentActionApproval(
    approval: Parameters<PulseForgeRepository["createIncidentActionApproval"]>[0]
  ): Promise<IncidentActionApproval> {
    const created: IncidentActionApproval = {
      ...approval,
      id: approval.id ?? randomUUID(),
      status: approval.status ?? "pending",
      requestedAt: approval.requestedAt ?? new Date().toISOString(),
    };
    this.incidentActionApprovals.set(created.id, created);
    return created;
  }

  async updateIncidentActionApprovalStatus(
    approvalId: string,
    update: Parameters<PulseForgeRepository["updateIncidentActionApprovalStatus"]>[1]
  ): Promise<IncidentActionApproval | null> {
    const existing = this.incidentActionApprovals.get(approvalId);
    if (!existing) {
      return null;
    }
    const updated = { ...existing, ...update };
    this.incidentActionApprovals.set(approvalId, updated);
    return updated;
  }

  async updateIncidentActionApprovalByRequiredAction(
    agentRunId: string,
    requiredActionId: string,
    update: Parameters<
      PulseForgeRepository["updateIncidentActionApprovalByRequiredAction"]
    >[2]
  ): Promise<IncidentActionApproval | null> {
    const existing = [...this.incidentActionApprovals.values()].find(
      (approval) =>
        approval.agentRunId === agentRunId &&
        approval.requiredActionId === requiredActionId
    );
    if (!existing) {
      return null;
    }
    return this.updateIncidentActionApprovalStatus(existing.id, update);
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
    this.sites.clear();
    this.devices.clear();
    this.deviceMetrics.clear();
    this.incidents.clear();
    this.simulationScenarios.clear();
    this.incidentActivities.clear();
    this.incidentComments.clear();
    this.incidentAgentMentions.clear();
    this.incidentActionApprovals.clear();
    this.remediationActions.clear();
    this.tickets.clear();
    this.agentRuns.clear();
    this.agentRunSnapshots.clear();
    this.conversations.clear();
    this.runtimeSessions.clear();
    this.runItems.clear();
    this.pendingInputs.clear();
    this.auditLogs.clear();

    for (const site of demoSites) {
      this.sites.set(site.id, site);
    }
    for (const device of demoDevices) {
      this.devices.set(device.id, device);
    }
    for (const [deviceId, metrics] of Object.entries(demoDeviceMetrics)) {
      this.deviceMetrics.set(deviceId, [...metrics]);
    }
    for (const incident of demoIncidents) {
      this.incidents.set(incident.id, incident);
    }
    for (const scenario of demoSimulationScenarios) {
      this.simulationScenarios.set(scenario.id, scenario);
    }
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
    for (const activity of demoIncidentActivities) {
      this.incidentActivities.set(activity.id, activity);
    }
    for (const comment of demoIncidentComments) {
      this.incidentComments.set(comment.id, comment);
    }
    for (const mention of demoIncidentAgentMentions) {
      this.incidentAgentMentions.set(mention.id, mention);
    }
    for (const approval of demoIncidentActionApprovals) {
      this.incidentActionApprovals.set(approval.id, approval);
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

  async cleanupDemoData() {
    const deleted = {
      sites: this.sites.size,
      devices: this.devices.size,
      telemetry: [...this.deviceMetrics.values()].reduce(
        (count, metrics) => count + metrics.length,
        0
      ),
      incidents: this.incidents.size,
      simulationScenarios: this.simulationScenarios.size,
      incidentActivities: this.incidentActivities.size,
      incidentComments: this.incidentComments.size,
      incidentAgentMentions: this.incidentAgentMentions.size,
      incidentActionApprovals: this.incidentActionApprovals.size,
      remediationActions: this.remediationActions.size,
      tickets: this.tickets.size,
      conversations: this.conversations.size,
      runtimeSessions: this.runtimeSessions.size,
      agentRuns: this.agentRuns.size,
      agentRunSnapshots: this.agentRunSnapshots.size,
      runItems: this.runItems.size,
      pendingInputs: this.pendingInputs.size,
      auditLogs: this.auditLogs.size,
    };

    this.sites.clear();
    this.devices.clear();
    this.deviceMetrics.clear();
    this.incidents.clear();
    this.simulationScenarios.clear();
    this.incidentActivities.clear();
    this.incidentComments.clear();
    this.incidentAgentMentions.clear();
    this.incidentActionApprovals.clear();
    this.remediationActions.clear();
    this.tickets.clear();
    this.agentRuns.clear();
    this.agentRunSnapshots.clear();
    this.conversations.clear();
    this.runtimeSessions.clear();
    this.runItems.clear();
    this.pendingInputs.clear();
    this.auditLogs.clear();

    return { deleted };
  }
}

function buildDashboard(
  devices: Device[],
  incidents: Incident[],
  totalSites: number
): DashboardSummary {
  return {
    totalSites,
    totalDevices: devices.length,
    healthyDevices: devices.filter((device) => device.status === "healthy").length,
    warningDevices: devices.filter((device) => device.status === "warning").length,
    criticalDevices: devices.filter((device) => device.status === "critical").length,
    offlineDevices: devices.filter((device) => device.status === "offline").length,
    openIncidents: incidents.filter((incident) => incident.status !== "resolved")
      .length,
    criticalIncidents: incidents.filter(
      (incident) => incident.severity === "critical"
    ).length,
  };
}

function isTerminalAgentRunStatus(status: AgentRun["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function shouldClearAuthRequired(status: AgentRun["status"]) {
  return (
    status === "running" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  );
}
