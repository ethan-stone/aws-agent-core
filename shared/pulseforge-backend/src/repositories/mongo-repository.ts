import {
  MongoClient,
  type Collection,
  type Db,
  type Filter,
  type UpdateFilter,
  type WithId,
} from "mongodb";
import {
  demoAgentRuns,
  demoAuditLogs,
  demoConversations,
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
  demoSites,
  demoTickets,
  type AgentRun,
  type AgentRunSnapshot,
  type AuditLogEntry,
  type Conversation,
  type DashboardSummary,
  type Device,
  type DeviceMetricSnapshot,
  type Incident,
  type IncidentActionApproval,
  type IncidentActivity,
  type IncidentAgentMention,
  type IncidentComment,
  type PendingInput,
  type PulseForgeSnapshot,
  type RemediationAction,
  type RuntimeSession,
  type RunItem,
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

type PersistedDevice = Omit<Device, "lastSeenAt"> & { lastSeenAt: Date };
type PersistedTelemetry = Omit<DeviceMetricSnapshot, "timestamp"> & {
  deviceId: string;
  timestamp: Date;
};
type PersistedIncident = Omit<Incident, "createdAt" | "updatedAt"> & {
  createdAt: Date;
  updatedAt: Date;
};
type PersistedIncidentActivity = Omit<IncidentActivity, "timestamp"> & {
  timestamp: Date;
};
type PersistedIncidentComment = Omit<
  IncidentComment,
  "createdAt" | "updatedAt"
> & {
  createdAt: Date;
  updatedAt: Date;
};
type PersistedIncidentAgentMention = Omit<
  IncidentAgentMention,
  "createdAt" | "acceptedAt"
> & {
  createdAt: Date;
  acceptedAt?: Date;
};
type PersistedIncidentActionApproval = Omit<
  IncidentActionApproval,
  "requestedAt" | "resolvedAt"
> & {
  requestedAt: Date;
  resolvedAt?: Date;
};
type PersistedTicket = Omit<Ticket, "createdAt"> & { createdAt: Date };
type PersistedToolApprovalGrant = Omit<ToolApprovalGrant, "grantedAt"> & {
  grantedAt: Date;
};
type PersistedConversation = Omit<
  Conversation,
  "createdAt" | "updatedAt" | "toolApprovalGrants"
> & {
  createdAt: Date;
  updatedAt: Date;
  toolApprovalGrants?: PersistedToolApprovalGrant[];
};
type PersistedRuntimeSession = Omit<RuntimeSession, "createdAt" | "lastUsedAt"> & {
  createdAt: Date;
  lastUsedAt?: Date;
};
type PersistedAgentRun = Omit<AgentRun, "startedAt" | "completedAt"> & {
  startedAt?: Date;
  completedAt?: Date;
};
type PersistedAgentRunSnapshot = Omit<AgentRunSnapshot, "createdAt"> & {
  createdAt: Date;
};
type PersistedRunItem = Omit<RunItem, "createdAt"> & { createdAt: Date };
type PersistedPendingInput = Omit<
  PendingInput,
  "acceptedAt" | "consumedAt"
> & {
  acceptedAt: Date;
  consumedAt?: Date;
};
type PersistedAuditLogEntry = Omit<AuditLogEntry, "timestamp"> & {
  timestamp: Date;
};

interface Collections {
  sites: Collection<Site>;
  devices: Collection<PersistedDevice>;
  telemetry: Collection<PersistedTelemetry>;
  incidents: Collection<PersistedIncident>;
  incidentActivities: Collection<PersistedIncidentActivity>;
  incidentComments: Collection<PersistedIncidentComment>;
  incidentAgentMentions: Collection<PersistedIncidentAgentMention>;
  incidentActionApprovals: Collection<PersistedIncidentActionApproval>;
  remediationActions: Collection<RemediationAction>;
  tickets: Collection<PersistedTicket>;
  conversations: Collection<PersistedConversation>;
  runtimeSessions: Collection<PersistedRuntimeSession>;
  agentRuns: Collection<PersistedAgentRun>;
  agentRunSnapshots: Collection<PersistedAgentRunSnapshot>;
  runItems: Collection<PersistedRunItem>;
  pendingInputs: Collection<PersistedPendingInput>;
  auditLogs: Collection<PersistedAuditLogEntry>;
}

export class MongoPulseForgeRepository implements PulseForgeRepository {
  constructor(
    private readonly client: MongoClient,
    private readonly dbName: string
  ) {}

  private get db(): Db {
    return this.client.db(this.dbName);
  }

  private collections(): Collections {
    return {
      sites: this.db.collection<Site>("sites"),
      devices: this.db.collection<PersistedDevice>("devices"),
      telemetry: this.db.collection<PersistedTelemetry>("telemetry"),
      incidents: this.db.collection<PersistedIncident>("incidents"),
      incidentActivities:
        this.db.collection<PersistedIncidentActivity>("incident_events"),
      incidentComments:
        this.db.collection<PersistedIncidentComment>("incident_comments"),
      incidentAgentMentions:
        this.db.collection<PersistedIncidentAgentMention>("incident_agent_mentions"),
      incidentActionApprovals:
        this.db.collection<PersistedIncidentActionApproval>("incident_action_approvals"),
      remediationActions:
        this.db.collection<RemediationAction>("remediation_actions"),
      tickets: this.db.collection<PersistedTicket>("tickets"),
      conversations: this.db.collection<PersistedConversation>("conversations"),
      runtimeSessions:
        this.db.collection<PersistedRuntimeSession>("runtime_sessions"),
      agentRuns: this.db.collection<PersistedAgentRun>("agent_runs"),
      agentRunSnapshots:
        this.db.collection<PersistedAgentRunSnapshot>("agent_run_snapshots"),
      runItems: this.db.collection<PersistedRunItem>("agent_run_items"),
      pendingInputs: this.db.collection<PersistedPendingInput>("pending_inputs"),
      auditLogs: this.db.collection<PersistedAuditLogEntry>("audit_logs"),
    };
  }

  async getSnapshot(): Promise<PulseForgeSnapshot> {
    const collections = this.collections();
    const [
      sites,
      devices,
      telemetryDocs,
      incidents,
      incidentActivities,
      incidentComments,
      incidentAgentMentions,
      incidentActionApprovals,
      remediationActions,
      tickets,
      conversations,
      runtimeSessions,
      agentRuns,
      runItems,
      pendingInputs,
      auditLogs,
    ] = await Promise.all([
      collections.sites.find().toArray(),
      collections.devices.find().toArray(),
      collections.telemetry.find().toArray(),
      collections.incidents.find().toArray(),
      collections.incidentActivities.find().toArray(),
      collections.incidentComments.find().toArray(),
      collections.incidentAgentMentions.find().toArray(),
      collections.incidentActionApprovals.find().toArray(),
      collections.remediationActions.find().toArray(),
      collections.tickets.find().toArray(),
      collections.conversations.find().toArray(),
      collections.runtimeSessions.find().toArray(),
      collections.agentRuns.find().toArray(),
      collections.runItems.find().toArray(),
      collections.pendingInputs.find().toArray(),
      collections.auditLogs.find().toArray(),
    ]);

    const normalizedSites = sites.map((site) => stripMongoId<Site>(site));
    const normalizedDevices = devices.map((device) =>
      mapPersistedDevice(stripMongoId<PersistedDevice>(device))
    );
    const normalizedIncidents = incidents.map((incident) =>
      mapPersistedIncident(stripMongoId<PersistedIncident>(incident))
    );
    const normalizedIncidentActivities = incidentActivities.map((activity) =>
      mapPersistedIncidentActivity(
        stripMongoId<PersistedIncidentActivity>(activity)
      )
    );
    const normalizedIncidentComments = incidentComments.map((comment) =>
      mapPersistedIncidentComment(
        stripMongoId<PersistedIncidentComment>(comment)
      )
    );
    const normalizedIncidentAgentMentions = incidentAgentMentions.map((mention) =>
      mapPersistedIncidentAgentMention(
        stripMongoId<PersistedIncidentAgentMention>(mention)
      )
    );
    const normalizedIncidentActionApprovals = incidentActionApprovals.map(
      (approval) =>
        mapPersistedIncidentActionApproval(
          stripMongoId<PersistedIncidentActionApproval>(approval)
        )
    );
    const normalizedRemediationActions = remediationActions.map((action) =>
      stripMongoId<RemediationAction>(action)
    );
    const normalizedTickets = tickets.map((ticket) =>
      mapPersistedTicket(stripMongoId<PersistedTicket>(ticket))
    );
    const normalizedConversations = conversations.map((conversation) =>
      mapPersistedConversation(stripMongoId<PersistedConversation>(conversation))
    );
    const normalizedRuntimeSessions = runtimeSessions.map((session) =>
      mapPersistedRuntimeSession(stripMongoId<PersistedRuntimeSession>(session))
    );
    const normalizedAgentRuns = agentRuns.map((run) =>
      mapPersistedAgentRun(stripMongoId<PersistedAgentRun>(run))
    );
    const normalizedRunItems = runItems.map((item) =>
      mapPersistedRunItem(stripMongoId<PersistedRunItem>(item))
    );
    const normalizedPendingInputs = pendingInputs.map((input) =>
      mapPersistedPendingInput(stripMongoId<PersistedPendingInput>(input))
    );
    const normalizedAuditLogs = auditLogs.map((entry) =>
      mapPersistedAuditLogEntry(stripMongoId<PersistedAuditLogEntry>(entry))
    );

    const deviceMetrics = telemetryDocs.reduce<
      Record<string, DeviceMetricSnapshot[]>
    >((acc, item) => {
      const { _id, deviceId, ...metric } = item;
      acc[deviceId] ??= [];
      acc[deviceId].push(mapPersistedTelemetry(metric));
      return acc;
    }, {});

    for (const metrics of Object.values(deviceMetrics)) {
      metrics.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }

    return {
      sites: normalizedSites,
      devices: normalizedDevices,
      deviceMetrics,
      incidents: normalizedIncidents,
      incidentActivities: normalizedIncidentActivities,
      incidentComments: normalizedIncidentComments,
      incidentAgentMentions: normalizedIncidentAgentMentions,
      incidentActionApprovals: normalizedIncidentActionApprovals,
      remediationActions: normalizedRemediationActions,
      tickets: normalizedTickets,
      conversations: normalizedConversations,
      runtimeSessions: normalizedRuntimeSessions,
      agentRuns: normalizedAgentRuns,
      runItems: normalizedRunItems,
      pendingInputs: normalizedPendingInputs,
      auditLogs: normalizedAuditLogs,
      dashboard: buildDashboard(
        normalizedDevices,
        normalizedIncidents,
        normalizedSites.length
      ),
    };
  }

  async getDashboard(): Promise<DashboardSummary> {
    const collections = this.collections();
    const [devices, incidents, totalSites] = await Promise.all([
      collections.devices.find().toArray(),
      collections.incidents.find().toArray(),
      collections.sites.countDocuments(),
    ]);

    return buildDashboard(
      devices.map((device) =>
        mapPersistedDevice(stripMongoId<PersistedDevice>(device))
      ),
      incidents.map((incident) =>
        mapPersistedIncident(stripMongoId<PersistedIncident>(incident))
      ),
      totalSites
    );
  }

  async listDevices(): Promise<Device[]> {
    const items = await this.collections().devices.find().sort({ name: 1 }).toArray();
    return items.map((device) =>
      mapPersistedDevice(stripMongoId<PersistedDevice>(device))
    );
  }

  async getDevice(deviceId: string): Promise<Device | null> {
    const item = await this.collections().devices.findOne({ id: deviceId });
    return item
      ? mapPersistedDevice(stripMongoId<PersistedDevice>(item))
      : null;
  }

  async getDeviceTelemetry(
    deviceId: string
  ): Promise<DeviceMetricSnapshot[] | null> {
    const items = await this.collections()
      .telemetry.find({ deviceId })
      .sort({ timestamp: 1 })
      .toArray();

    if (items.length === 0) {
      return null;
    }

    return items.map(({ _id, deviceId: _deviceId, ...metric }) =>
      mapPersistedTelemetry(metric)
    );
  }

  async listIncidents(): Promise<Incident[]> {
    const items = await this.collections()
      .incidents.find()
      .sort({ updatedAt: -1 })
      .toArray();
    return items.map((incident) =>
      mapPersistedIncident(stripMongoId<PersistedIncident>(incident))
    );
  }

  async getIncident(incidentId: string): Promise<IncidentAggregate | null> {
    const collections = this.collections();
    const [incident, activities, comments, agentMentions, actionApprovals] =
      await Promise.all([
      collections.incidents.findOne({ id: incidentId }),
      collections.incidentActivities
        .find({ incidentId })
        .sort({ timestamp: 1 })
        .toArray(),
      collections.incidentComments
        .find({ incidentId })
        .sort({ createdAt: 1 })
        .toArray(),
      collections.incidentAgentMentions
        .find({ incidentId })
        .sort({ createdAt: 1 })
        .toArray(),
      collections.incidentActionApprovals
        .find({ incidentId })
        .sort({ requestedAt: 1 })
        .toArray(),
    ]);

    if (!incident) {
      return null;
    }

    return {
      incident: mapPersistedIncident(stripMongoId<PersistedIncident>(incident)),
      activities: activities.map((activity) =>
        mapPersistedIncidentActivity(
          stripMongoId<PersistedIncidentActivity>(activity)
        )
      ),
      comments: comments.map((comment) =>
        mapPersistedIncidentComment(
          stripMongoId<PersistedIncidentComment>(comment)
        )
      ),
      agentMentions: agentMentions.map((mention) =>
        mapPersistedIncidentAgentMention(
          stripMongoId<PersistedIncidentAgentMention>(mention)
        )
      ),
      actionApprovals: actionApprovals.map((approval) =>
        mapPersistedIncidentActionApproval(
          stripMongoId<PersistedIncidentActionApproval>(approval)
        )
      ),
    };
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    const item = await this.collections().conversations.findOne({
      id: conversationId,
    });
    return item
      ? mapPersistedConversation(stripMongoId<PersistedConversation>(item))
      : null;
  }

  async createConversation(
    conversation: Parameters<PulseForgeRepository["createConversation"]>[0]
  ): Promise<Conversation> {
    const now = new Date();
    const created: PersistedConversation = {
      id: conversation.id,
      rootAgentKind: conversation.rootAgentKind,
      status: conversation.status ?? "open",
      incidentId: conversation.incidentId,
      interactionMode: conversation.interactionMode,
      interactionOwnerUserId: conversation.interactionOwnerUserId,
      activeRootRunId: conversation.activeRootRunId,
      createdAt: conversation.createdAt
        ? new Date(conversation.createdAt)
        : now,
      updatedAt: conversation.updatedAt
        ? new Date(conversation.updatedAt)
        : now,
    };

    await this.collections().conversations.insertOne(created);
    return mapPersistedConversation(created);
  }

  async updateConversationActiveRun(
    conversationId: string,
    activeRootRunId: string | null
  ): Promise<Conversation | null> {
    const updatedAt = new Date();
    await this.collections().conversations.updateOne(
      { id: conversationId },
      activeRootRunId
        ? { $set: { activeRootRunId, updatedAt } }
        : { $set: { updatedAt }, $unset: { activeRootRunId: "" } }
    );

    return this.getConversation(conversationId);
  }

  async claimConversationActiveRun(
    conversationId: string,
    activeRootRunId: string
  ): Promise<Conversation | null> {
    const claimableConversationFilter = {
      id: conversationId,
      $or: [
        { activeRootRunId: { $exists: false } },
        { activeRootRunId: null },
        { activeRootRunId: undefined },
      ],
    } as Filter<PersistedConversation>;
    const item = await this.collections().conversations.findOneAndUpdate(
      claimableConversationFilter,
      { $set: { activeRootRunId, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    return item
      ? mapPersistedConversation(stripMongoId<PersistedConversation>(item))
      : null;
  }

  async upsertConversationToolApprovalGrant(
    conversationId: string,
    grant: Parameters<PulseForgeRepository["upsertConversationToolApprovalGrant"]>[1]
  ): Promise<ToolApprovalGrant | null> {
    const existing = await this.getConversation(conversationId);
    if (!existing || existing.status !== "open") {
      return null;
    }

    const matchingGrant = existing.toolApprovalGrants?.find(
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
    const result = await this.collections().conversations.updateOne(
      {
        id: conversationId,
        status: "open",
        toolApprovalGrants: {
          $not: {
            $elemMatch: {
              grantedByUserId: created.grantedByUserId,
              toolName: created.toolName,
              approvalKey: created.approvalKey,
            },
          },
        },
      },
      {
        $push: {
          toolApprovalGrants: toPersistedToolApprovalGrant(created),
        },
        $set: { updatedAt: new Date() },
      }
    );

    if (result.modifiedCount > 0) {
      return created;
    }

    const updated = await this.getConversation(conversationId);
    return (
      updated?.toolApprovalGrants?.find(
        (item) =>
          item.grantedByUserId === grant.grantedByUserId &&
          item.toolName === grant.toolName &&
          item.approvalKey === grant.approvalKey
      ) ?? null
    );
  }

  async listRuntimeSessions(conversationId: string): Promise<RuntimeSession[]> {
    const items = await this.collections().runtimeSessions
      .find({ conversationId })
      .toArray();
    return items.map((item) =>
      mapPersistedRuntimeSession(stripMongoId<PersistedRuntimeSession>(item))
    );
  }

  async getRuntimeSessionByProvider(
    conversationId: string,
    provider: string,
    runtimeIdentity: string
  ): Promise<RuntimeSession | null> {
    const item = await this.collections().runtimeSessions.findOne({
      conversationId,
      provider,
      runtimeIdentity,
    });
    return item
      ? mapPersistedRuntimeSession(stripMongoId<PersistedRuntimeSession>(item))
      : null;
  }

  async createRuntimeSession(
    session: Parameters<PulseForgeRepository["createRuntimeSession"]>[0]
  ): Promise<RuntimeSession> {
    const now = new Date();
    const created: PersistedRuntimeSession = {
      id: session.id,
      provider: session.provider,
      runtimeIdentity: session.runtimeIdentity,
      providerSessionId: session.providerSessionId,
      conversationId: session.conversationId,
      status: session.status ?? "active",
      createdAt: session.createdAt ? new Date(session.createdAt) : now,
      lastUsedAt: session.lastUsedAt ? new Date(session.lastUsedAt) : now,
    };

    await this.collections().runtimeSessions.insertOne(created);
    return mapPersistedRuntimeSession(created);
  }

  async touchRuntimeSession(
    sessionId: string,
    status: RuntimeSession["status"] = "active"
  ): Promise<RuntimeSession | null> {
    await this.collections().runtimeSessions.updateOne(
      { id: sessionId },
      { $set: { status, lastUsedAt: new Date() } }
    );
    const item = await this.collections().runtimeSessions.findOne({ id: sessionId });
    return item
      ? mapPersistedRuntimeSession(stripMongoId<PersistedRuntimeSession>(item))
      : null;
  }

  async getAgentRun(runId: string): Promise<AgentRun | null> {
    const item = await this.collections().agentRuns.findOne({ id: runId });
    return item
      ? mapPersistedAgentRun(stripMongoId<PersistedAgentRun>(item))
      : null;
  }

  async listAgentRuns(conversationId: string): Promise<AgentRun[]> {
    const items = await this.collections().agentRuns
      .find({ conversationId })
      .sort({ startedAt: 1, id: 1 })
      .toArray();
    return items.map((item) =>
      mapPersistedAgentRun(stripMongoId<PersistedAgentRun>(item))
    );
  }

  async createAgentRun(
    run: Parameters<PulseForgeRepository["createAgentRun"]>[0]
  ): Promise<AgentRun> {
    const created: PersistedAgentRun = {
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
      startedAt: new Date(run.startedAt ?? Date.now()),
      requestedByUserId: run.requestedByUserId,
      completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
      summary: run.summary,
      investigation: run.investigation,
      authRequired: run.authRequired,
      errorMessage: run.errorMessage,
    };

    await this.collections().agentRuns.insertOne(created);
    return mapPersistedAgentRun(created);
  }

  async createAgentRunSnapshot(
    snapshot: Parameters<PulseForgeRepository["createAgentRunSnapshot"]>[0]
  ): Promise<AgentRunSnapshot> {
    const created: PersistedAgentRunSnapshot = {
      ...snapshot,
      createdAt: new Date(snapshot.createdAt ?? Date.now()),
    };

    await this.collections().agentRunSnapshots.insertOne(created);
    return mapPersistedAgentRunSnapshot(created);
  }

  async getAgentRunSnapshot(snapshotId: string): Promise<AgentRunSnapshot | null> {
    const item = await this.collections().agentRunSnapshots.findOne({
      id: snapshotId,
    });
    return item
      ? mapPersistedAgentRunSnapshot(
          stripMongoId<PersistedAgentRunSnapshot>(item)
        )
      : null;
  }

  async updateAgentRunStatus(
    runId: string,
    update: Parameters<PulseForgeRepository["updateAgentRunStatus"]>[1]
  ): Promise<AgentRun | null> {
    const set: Partial<PersistedAgentRun> = {
      status: update.status,
      summary: update.summary,
      investigation: update.investigation,
      authRequired: update.authRequired,
      errorMessage: update.errorMessage,
    };

    if (update.completedAt || isTerminalAgentRunStatus(update.status)) {
      set.completedAt = new Date(update.completedAt ?? Date.now());
    }

    const mongoUpdate: UpdateFilter<PersistedAgentRun> = {
      $set: removeUndefined(set),
    };
    if (shouldClearAuthRequired(update.status)) {
      mongoUpdate.$unset = { authRequired: "" };
    }

    await this.collections().agentRuns.updateOne(
      { id: runId },
      mongoUpdate
    );

    return this.getAgentRun(runId);
  }

  async appendRunItems(
    runId: string,
    items: AppendRunItemInput[]
  ): Promise<RunItem[]> {
    const latest = await this.collections().runItems.findOne(
      { runId },
      { sort: { sequence: -1 } }
    );
    const nextSequence = latest ? latest.sequence + 1 : 0;
    const created = items.map(
      (item, index) =>
        ({
          ...item,
          id: item.id ?? randomUUID(),
          runId,
          sequence: nextSequence + index,
          createdAt: new Date(item.createdAt ?? Date.now()),
        }) as PersistedRunItem
    );

    if (created.length > 0) {
      await this.collections().runItems.insertMany(created);
    }

    return created.map(mapPersistedRunItem);
  }

  async updateRequiredActionStatus(
    runId: string,
    requiredActionId: string,
    update: Parameters<PulseForgeRepository["updateRequiredActionStatus"]>[2]
  ): Promise<RunItem | null> {
    const resolvedAt = update.resolvedAt ?? new Date().toISOString();
    await this.collections().runItems.updateOne(
      {
        runId,
        kind: "required_action",
        requiredActionId,
      },
      {
        $set: removeUndefined({
          status: update.status,
          resolvedAt,
          resolvedBy: update.resolvedBy,
        }),
      }
    );

    const item = await this.collections().runItems.findOne({
      runId,
      kind: "required_action",
      requiredActionId,
    });
    return item ? mapPersistedRunItem(stripMongoId<PersistedRunItem>(item)) : null;
  }

  async updateToolCallStatus(
    runId: string,
    toolCallId: string,
    status: Parameters<PulseForgeRepository["updateToolCallStatus"]>[2]
  ): Promise<RunItem | null> {
    await this.collections().runItems.updateOne(
      {
        runId,
        kind: "tool_call",
        toolCallId,
      },
      {
        $set: { status },
      }
    );

    const item = await this.collections().runItems.findOne({
      runId,
      kind: "tool_call",
      toolCallId,
    });
    return item ? mapPersistedRunItem(stripMongoId<PersistedRunItem>(item)) : null;
  }

  async listRunItems(runId: string): Promise<RunItem[]> {
    const items = await this.collections().runItems
      .find({ runId })
      .sort({ sequence: 1 })
      .toArray();
    return items.map((item) =>
      mapPersistedRunItem(stripMongoId<PersistedRunItem>(item))
    );
  }

  async listPendingInputs(conversationId: string): Promise<PendingInput[]> {
    const items = await this.collections().pendingInputs
      .find({ conversationId })
      .sort({ acceptedAt: 1 })
      .toArray();
    return items.map((item) =>
      mapPersistedPendingInput(stripMongoId<PersistedPendingInput>(item))
    );
  }

  async createIncidentActivity(
    activity: Parameters<PulseForgeRepository["createIncidentActivity"]>[0]
  ): Promise<IncidentActivity> {
    const created: PersistedIncidentActivity = {
      id: activity.id ?? randomUUID(),
      incidentId: activity.incidentId,
      timestamp: new Date(activity.timestamp ?? Date.now()),
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

    await this.collections().incidentActivities.insertOne(created);
    return mapPersistedIncidentActivity(created);
  }

  async updateIncidentActivity(
    activityId: string,
    update: Parameters<PulseForgeRepository["updateIncidentActivity"]>[1]
  ): Promise<IncidentActivity | null> {
    await this.collections().incidentActivities.updateOne(
      { id: activityId },
      { $set: removeUndefined(update) }
    );
    const item = await this.collections().incidentActivities.findOne({
      id: activityId,
    });
    return item
      ? mapPersistedIncidentActivity(stripMongoId<PersistedIncidentActivity>(item))
      : null;
  }

  async updateIncidentActivityByAgentRun(
    agentRunId: string,
    update: Parameters<PulseForgeRepository["updateIncidentActivityByAgentRun"]>[1]
  ): Promise<IncidentActivity | null> {
    await this.collections().incidentActivities.updateOne(
      { kind: "agent_conversation", agentRunId },
      { $set: removeUndefined(update) }
    );
    const item = await this.collections().incidentActivities.findOne({
      kind: "agent_conversation",
      agentRunId,
    });
    return item
      ? mapPersistedIncidentActivity(stripMongoId<PersistedIncidentActivity>(item))
      : null;
  }

  async createIncidentComment(
    comment: Parameters<PulseForgeRepository["createIncidentComment"]>[0]
  ): Promise<IncidentComment> {
    const now = new Date();
    const created: PersistedIncidentComment = {
      id: comment.id ?? randomUUID(),
      incidentId: comment.incidentId,
      body: comment.body,
      authorUserId: comment.authorUserId,
      createdAt: new Date(comment.createdAt ?? now),
      updatedAt: new Date(comment.updatedAt ?? comment.createdAt ?? now),
    };

    await this.collections().incidentComments.insertOne(created);
    return mapPersistedIncidentComment(created);
  }

  async createIncidentAgentMention(
    mention: Parameters<PulseForgeRepository["createIncidentAgentMention"]>[0]
  ): Promise<IncidentAgentMention> {
    const created: PersistedIncidentAgentMention = {
      ...mention,
      id: mention.id ?? randomUUID(),
      createdAt: new Date(mention.createdAt ?? Date.now()),
      acceptedAt: mention.acceptedAt ? new Date(mention.acceptedAt) : undefined,
    };

    await this.collections().incidentAgentMentions.insertOne(created);
    return mapPersistedIncidentAgentMention(created);
  }

  async updateIncidentAgentMention(
    mentionId: string,
    update: Parameters<PulseForgeRepository["updateIncidentAgentMention"]>[1]
  ): Promise<IncidentAgentMention | null> {
    await this.collections().incidentAgentMentions.updateOne(
      { id: mentionId },
      {
        $set: removeUndefined({
          ...update,
          acceptedAt: update.acceptedAt ? new Date(update.acceptedAt) : undefined,
        }),
      }
    );
    const item = await this.collections().incidentAgentMentions.findOne({
      id: mentionId,
    });
    return item
      ? mapPersistedIncidentAgentMention(
          stripMongoId<PersistedIncidentAgentMention>(item)
        )
      : null;
  }

  async createIncidentActionApproval(
    approval: Parameters<PulseForgeRepository["createIncidentActionApproval"]>[0]
  ): Promise<IncidentActionApproval> {
    const created: PersistedIncidentActionApproval = {
      ...approval,
      id: approval.id ?? randomUUID(),
      status: approval.status ?? "pending",
      requestedAt: new Date(approval.requestedAt ?? Date.now()),
      resolvedAt: approval.resolvedAt ? new Date(approval.resolvedAt) : undefined,
    };

    await this.collections().incidentActionApprovals.insertOne(created);
    return mapPersistedIncidentActionApproval(created);
  }

  async updateIncidentActionApprovalStatus(
    approvalId: string,
    update: Parameters<PulseForgeRepository["updateIncidentActionApprovalStatus"]>[1]
  ): Promise<IncidentActionApproval | null> {
    await this.collections().incidentActionApprovals.updateOne(
      { id: approvalId },
      {
        $set: removeUndefined({
          ...update,
          resolvedAt: update.resolvedAt ? new Date(update.resolvedAt) : undefined,
        }),
      }
    );
    const item = await this.collections().incidentActionApprovals.findOne({
      id: approvalId,
    });
    return item
      ? mapPersistedIncidentActionApproval(
          stripMongoId<PersistedIncidentActionApproval>(item)
        )
      : null;
  }

  async updateIncidentActionApprovalByRequiredAction(
    agentRunId: string,
    requiredActionId: string,
    update: Parameters<
      PulseForgeRepository["updateIncidentActionApprovalByRequiredAction"]
    >[2]
  ): Promise<IncidentActionApproval | null> {
    await this.collections().incidentActionApprovals.updateOne(
      { agentRunId, requiredActionId },
      {
        $set: removeUndefined({
          ...update,
          resolvedAt: update.resolvedAt ? new Date(update.resolvedAt) : undefined,
        }),
      }
    );
    const item = await this.collections().incidentActionApprovals.findOne({
      agentRunId,
      requiredActionId,
    });
    return item
      ? mapPersistedIncidentActionApproval(
          stripMongoId<PersistedIncidentActionApproval>(item)
        )
      : null;
  }

  async createTicket(
    ticket: Parameters<PulseForgeRepository["createTicket"]>[0]
  ): Promise<Ticket> {
    const created: PersistedTicket = {
      id: ticket.id ?? randomUUID(),
      incidentId: ticket.incidentId,
      externalRef: ticket.externalRef ?? `PF-${Date.now()}`,
      status: ticket.status ?? "open",
      assigneeTeam: ticket.assigneeTeam,
      createdAt: new Date(ticket.createdAt ?? Date.now()),
      createdBy: ticket.createdBy,
    };

    await this.collections().tickets.insertOne(created);
    return mapPersistedTicket(created);
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

    await this.collections().remediationActions.insertOne(created);
    return created;
  }

  async createAuditLog(
    entry: Parameters<PulseForgeRepository["createAuditLog"]>[0]
  ): Promise<AuditLogEntry> {
    const created: PersistedAuditLogEntry = {
      id: entry.id ?? randomUUID(),
      timestamp: new Date(entry.timestamp ?? Date.now()),
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

    await this.collections().auditLogs.insertOne(created);
    return mapPersistedAuditLogEntry(created);
  }

  async seedDemoData(): Promise<void> {
    const collections = this.collections();

    await Promise.all([
      collections.sites.deleteMany({}),
      collections.devices.deleteMany({}),
      collections.telemetry.deleteMany({}),
      collections.incidents.deleteMany({}),
      collections.incidentActivities.deleteMany({}),
      collections.incidentComments.deleteMany({}),
      collections.incidentAgentMentions.deleteMany({}),
      collections.incidentActionApprovals.deleteMany({}),
      collections.remediationActions.deleteMany({}),
      collections.tickets.deleteMany({}),
      collections.conversations.deleteMany({}),
      collections.runtimeSessions.deleteMany({}),
      collections.agentRuns.deleteMany({}),
      collections.agentRunSnapshots.deleteMany({}),
      collections.runItems.deleteMany({}),
      collections.pendingInputs.deleteMany({}),
      collections.auditLogs.deleteMany({}),
    ]);

    await Promise.all([
      collections.sites.insertMany(demoSites),
      collections.devices.insertMany(demoDevices.map(toPersistedDevice)),
      collections.telemetry.insertMany(
        Object.entries(demoDeviceMetrics).flatMap(([deviceId, metrics]) =>
          metrics.map((metric) => toPersistedTelemetry(deviceId, metric))
        )
      ),
      collections.incidents.insertMany(demoIncidents.map(toPersistedIncident)),
      collections.incidentActivities.insertMany(
        demoIncidentActivities.map(toPersistedIncidentActivity)
      ),
      demoIncidentComments.length > 0
        ? collections.incidentComments.insertMany(
            demoIncidentComments.map(toPersistedIncidentComment)
          )
        : Promise.resolve(),
      demoIncidentAgentMentions.length > 0
        ? collections.incidentAgentMentions.insertMany(
            demoIncidentAgentMentions.map(toPersistedIncidentAgentMention)
          )
        : Promise.resolve(),
      demoIncidentActionApprovals.length > 0
        ? collections.incidentActionApprovals.insertMany(
            demoIncidentActionApprovals.map(toPersistedIncidentActionApproval)
          )
        : Promise.resolve(),
      collections.remediationActions.insertMany(demoRemediationActions),
      collections.tickets.insertMany(demoTickets.map(toPersistedTicket)),
      collections.conversations.insertMany(
        demoConversations.map(toPersistedConversation)
      ),
      collections.runtimeSessions.insertMany(
        demoRuntimeSessions.map(toPersistedRuntimeSession)
      ),
      collections.agentRuns.insertMany(demoAgentRuns.map(toPersistedAgentRun)),
      demoRunItems.length > 0
        ? collections.runItems.insertMany(demoRunItems.map(toPersistedRunItem))
        : Promise.resolve(),
      demoPendingInputs.length > 0
        ? collections.pendingInputs.insertMany(
            demoPendingInputs.map(toPersistedPendingInput)
          )
        : Promise.resolve(),
      demoAuditLogs.length > 0
        ? collections.auditLogs.insertMany(
            demoAuditLogs.map(toPersistedAuditLogEntry)
          )
        : Promise.resolve(),
    ]);

    await Promise.all([
      collections.devices.createIndex({ id: 1 }, { unique: true }),
      collections.incidents.createIndex({ id: 1 }, { unique: true }),
      collections.incidentActivities.createIndex({ incidentId: 1, timestamp: 1 }),
      collections.incidentComments.createIndex({ incidentId: 1, createdAt: 1 }),
      collections.incidentAgentMentions.createIndex({ incidentId: 1, createdAt: 1 }),
      collections.incidentActionApprovals.createIndex({ incidentId: 1, requestedAt: 1 }),
      collections.telemetry.createIndex({ deviceId: 1, timestamp: 1 }),
      collections.tickets.createIndex({ incidentId: 1 }),
      collections.conversations.createIndex({ id: 1 }, { unique: true }),
      collections.runtimeSessions.createIndex(
        { conversationId: 1, provider: 1, runtimeIdentity: 1 },
        { unique: true }
      ),
      collections.agentRuns.createIndex({ id: 1 }, { unique: true }),
      collections.agentRuns.createIndex({ incidentId: 1 }),
      collections.agentRuns.createIndex({ conversationId: 1, startedAt: 1 }),
      collections.agentRunSnapshots.createIndex({ id: 1 }, { unique: true }),
      collections.agentRunSnapshots.createIndex({
        runId: 1,
        requiredActionId: 1,
      }),
      collections.runItems.createIndex({ id: 1 }, { unique: true }),
      collections.runItems.createIndex({ runId: 1, sequence: 1 }),
      collections.pendingInputs.createIndex({ conversationId: 1, acceptedAt: 1 }),
      collections.auditLogs.createIndex({ timestamp: -1 }),
      collections.auditLogs.createIndex({ "actor.agentRunId": 1 }),
      collections.auditLogs.createIndex({ operation: 1 }),
    ]);
  }
}

function stripMongoId<T>(document: WithId<T>): T {
  const { _id, ...rest } = document as WithId<T>;
  void _id;
  return rest as T;
}

function toPersistedDevice(device: Device): PersistedDevice {
  return {
    ...device,
    lastSeenAt: new Date(device.lastSeenAt),
  };
}

function mapPersistedDevice(device: PersistedDevice): Device {
  return {
    ...device,
    lastSeenAt: device.lastSeenAt.toISOString(),
  };
}

function toPersistedTelemetry(
  deviceId: string,
  metric: DeviceMetricSnapshot
): PersistedTelemetry {
  return {
    deviceId,
    ...metric,
    timestamp: new Date(metric.timestamp),
  };
}

function mapPersistedTelemetry(
  metric: Omit<PersistedTelemetry, "deviceId">
): DeviceMetricSnapshot {
  return {
    ...metric,
    timestamp: metric.timestamp.toISOString(),
  };
}

function toPersistedIncident(incident: Incident): PersistedIncident {
  return {
    ...incident,
    createdAt: new Date(incident.createdAt),
    updatedAt: new Date(incident.updatedAt),
  };
}

function mapPersistedIncident(incident: PersistedIncident): Incident {
  return {
    ...incident,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
  };
}

function toPersistedIncidentActivity(
  activity: IncidentActivity
): PersistedIncidentActivity {
  return {
    ...activity,
    timestamp: new Date(activity.timestamp),
  };
}

function mapPersistedIncidentActivity(
  activity: PersistedIncidentActivity
): IncidentActivity {
  return {
    ...activity,
    timestamp: activity.timestamp.toISOString(),
  };
}

function toPersistedIncidentComment(
  comment: IncidentComment
): PersistedIncidentComment {
  return {
    ...comment,
    createdAt: new Date(comment.createdAt),
    updatedAt: new Date(comment.updatedAt),
  };
}

function mapPersistedIncidentComment(
  comment: PersistedIncidentComment
): IncidentComment {
  return {
    ...comment,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}

function toPersistedIncidentAgentMention(
  mention: IncidentAgentMention
): PersistedIncidentAgentMention {
  return {
    ...mention,
    createdAt: new Date(mention.createdAt),
    acceptedAt: mention.acceptedAt ? new Date(mention.acceptedAt) : undefined,
  };
}

function mapPersistedIncidentAgentMention(
  mention: PersistedIncidentAgentMention
): IncidentAgentMention {
  return {
    ...mention,
    createdAt: mention.createdAt.toISOString(),
    acceptedAt: mention.acceptedAt?.toISOString(),
  };
}

function toPersistedIncidentActionApproval(
  approval: IncidentActionApproval
): PersistedIncidentActionApproval {
  return {
    ...approval,
    requestedAt: new Date(approval.requestedAt),
    resolvedAt: approval.resolvedAt ? new Date(approval.resolvedAt) : undefined,
  };
}

function mapPersistedIncidentActionApproval(
  approval: PersistedIncidentActionApproval
): IncidentActionApproval {
  return {
    ...approval,
    requestedAt: approval.requestedAt.toISOString(),
    resolvedAt: approval.resolvedAt?.toISOString(),
  };
}

function toPersistedTicket(ticket: Ticket): PersistedTicket {
  return {
    ...ticket,
    createdAt: new Date(ticket.createdAt),
  };
}

function mapPersistedTicket(ticket: PersistedTicket): Ticket {
  return {
    ...ticket,
    createdAt: ticket.createdAt.toISOString(),
  };
}

function toPersistedConversation(conversation: Conversation): PersistedConversation {
  return {
    ...conversation,
    toolApprovalGrants: conversation.toolApprovalGrants?.map(
      toPersistedToolApprovalGrant
    ),
    createdAt: new Date(conversation.createdAt),
    updatedAt: new Date(conversation.updatedAt),
  };
}

function mapPersistedConversation(
  conversation: PersistedConversation
): Conversation {
  return {
    ...conversation,
    toolApprovalGrants: conversation.toolApprovalGrants?.map(
      mapPersistedToolApprovalGrant
    ),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

function toPersistedToolApprovalGrant(
  grant: ToolApprovalGrant
): PersistedToolApprovalGrant {
  return {
    ...grant,
    grantedAt: new Date(grant.grantedAt),
  };
}

function mapPersistedToolApprovalGrant(
  grant: PersistedToolApprovalGrant
): ToolApprovalGrant {
  return {
    ...grant,
    grantedAt: grant.grantedAt.toISOString(),
  };
}

function toPersistedRuntimeSession(
  session: RuntimeSession
): PersistedRuntimeSession {
  return {
    ...session,
    createdAt: new Date(session.createdAt),
    lastUsedAt: session.lastUsedAt ? new Date(session.lastUsedAt) : undefined,
  };
}

function mapPersistedRuntimeSession(
  session: PersistedRuntimeSession
): RuntimeSession {
  return {
    ...session,
    createdAt: session.createdAt.toISOString(),
    lastUsedAt: session.lastUsedAt?.toISOString(),
  };
}

function toPersistedAgentRun(run: AgentRun): PersistedAgentRun {
  return {
    ...run,
    startedAt: run.startedAt ? new Date(run.startedAt) : undefined,
    completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
  };
}

function mapPersistedAgentRun(run: PersistedAgentRun): AgentRun {
  return {
    ...run,
    startedAt: run.startedAt?.toISOString(),
    completedAt: run.completedAt?.toISOString(),
  };
}

function mapPersistedAgentRunSnapshot(
  snapshot: PersistedAgentRunSnapshot
): AgentRunSnapshot {
  return {
    ...snapshot,
    createdAt: snapshot.createdAt.toISOString(),
  };
}

function toPersistedRunItem(item: RunItem): PersistedRunItem {
  return {
    ...item,
    createdAt: new Date(item.createdAt),
  };
}

function mapPersistedRunItem(item: PersistedRunItem): RunItem {
  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
  } as RunItem;
}

function toPersistedPendingInput(input: PendingInput): PersistedPendingInput {
  return {
    ...input,
    acceptedAt: new Date(input.acceptedAt),
    consumedAt: input.consumedAt ? new Date(input.consumedAt) : undefined,
  };
}

function mapPersistedPendingInput(input: PersistedPendingInput): PendingInput {
  return {
    ...input,
    acceptedAt: input.acceptedAt.toISOString(),
    consumedAt: input.consumedAt?.toISOString(),
  };
}

function toPersistedAuditLogEntry(
  entry: AuditLogEntry
): PersistedAuditLogEntry {
  return {
    ...entry,
    timestamp: new Date(entry.timestamp),
  };
}

function mapPersistedAuditLogEntry(
  entry: PersistedAuditLogEntry
): AuditLogEntry {
  return {
    ...entry,
    timestamp: entry.timestamp.toISOString(),
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

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as T;
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
    criticalDevices: devices.filter((device) => device.status === "critical")
      .length,
    offlineDevices: devices.filter((device) => device.status === "offline").length,
    openIncidents: incidents.filter((incident) => incident.status !== "resolved")
      .length,
    criticalIncidents: incidents.filter(
      (incident) => incident.severity === "critical"
    ).length,
  };
}
