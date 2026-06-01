import { getMongoClient, getMongoDbName, isMongoConfigured } from "./mongodb.js";
import { InMemoryPulseForgeRepository } from "./repositories/in-memory-repository.js";
import { MongoPulseForgeRepository } from "./repositories/mongo-repository.js";
import type { PulseForgeRepository } from "./repositories/types.js";
import type {
  AgentRun,
  AuditActor,
  AuditLogEntry,
  ContentBlock,
  DeviceMetricSnapshot,
  ConversationDetail,
  IncidentInvestigationContext,
  IncidentActivity,
  IncidentActionApproval,
  IncidentAgentMention,
  IncidentComment,
  RemediationAction,
  ResolutionEvidence,
  ResolutionEvidenceTimelineEntry,
  RuntimeSession,
  RunItem,
  SimulationScenario,
  Ticket,
} from "@agent-core/pulseforge-domain";
import { demoRunbooks } from "@agent-core/pulseforge-domain";

const fallbackRepository = new InMemoryPulseForgeRepository();
let repositoryPromise: Promise<PulseForgeRepository> | null = null;

async function getRepository(): Promise<PulseForgeRepository> {
  if (!isMongoConfigured()) {
    return fallbackRepository;
  }

  if (!repositoryPromise) {
    repositoryPromise = getMongoClient().then(
      (client) => new MongoPulseForgeRepository(client, getMongoDbName())
    );
  }

  return repositoryPromise;
}

export async function getStorageMode(): Promise<"memory" | "mongodb"> {
  return isMongoConfigured() ? "mongodb" : "memory";
}

export async function getSnapshot() {
  return (await getRepository()).getSnapshot();
}

export async function getDashboard() {
  return (await getRepository()).getDashboard();
}

export async function listDevices() {
  return (await getRepository()).listDevices();
}

export async function getDevice(deviceId: string) {
  return (await getRepository()).getDevice(deviceId);
}

export async function createDevice(
  device: Parameters<PulseForgeRepository["createDevice"]>[0]
) {
  return (await getRepository()).createDevice(device);
}

export async function updateDeviceCurrentState(
  deviceId: string,
  update: Parameters<PulseForgeRepository["updateDeviceCurrentState"]>[1]
) {
  return (await getRepository()).updateDeviceCurrentState(deviceId, update);
}

export async function getDeviceTelemetry(deviceId: string) {
  return (await getRepository()).getDeviceTelemetry(deviceId);
}

export async function appendDeviceTelemetry(
  deviceId: string,
  metric: Parameters<PulseForgeRepository["appendDeviceTelemetry"]>[1]
) {
  return (await getRepository()).appendDeviceTelemetry(deviceId, metric);
}

export async function listIncidents() {
  return (await getRepository()).listIncidents();
}

export async function getIncident(incidentId: string) {
  return (await getRepository()).getIncident(incidentId);
}

export async function createIncident(
  incident: Parameters<PulseForgeRepository["createIncident"]>[0]
) {
  return (await getRepository()).createIncident(incident);
}

export async function updateIncident(
  incidentId: string,
  update: Parameters<PulseForgeRepository["updateIncident"]>[1]
) {
  return (await getRepository()).updateIncident(incidentId, update);
}

export async function resolveIncident(incidentId: string, userId?: string) {
  const repository = await getRepository();
  const existing = await repository.getIncident(incidentId);
  if (!existing) {
    return null;
  }
  if (existing.incident.status === "resolved") {
    return existing.incident;
  }

  const resolvedAt = new Date().toISOString();
  const incident = await repository.updateIncident(incidentId, {
    status: "resolved",
    updatedAt: resolvedAt,
    resolvedAt,
    ...(userId ? { resolvedByUserId: userId } : {}),
  });
  if (!incident) {
    return null;
  }

  await repository.createIncidentActivity({
    incidentId,
    kind: "incident_resolved",
    message: "Incident marked resolved.",
    title: "Incident resolved",
    createdBy: userId
      ? { actorType: "user", actorId: userId }
      : { actorType: "system", actorId: "pulseforge" },
    timestamp: resolvedAt,
  });

  return incident;
}

export async function findOpenIncidentForDeviceCategory(
  deviceId: string,
  category: Parameters<PulseForgeRepository["findOpenIncidentForDeviceCategory"]>[1]
) {
  return (await getRepository()).findOpenIncidentForDeviceCategory(
    deviceId,
    category
  );
}

export async function listSimulationScenarios(
  statuses?: SimulationScenario["status"][]
) {
  return (await getRepository()).listSimulationScenarios(statuses);
}

export async function createSimulationScenario(
  scenario: Parameters<PulseForgeRepository["createSimulationScenario"]>[0]
) {
  return (await getRepository()).createSimulationScenario(scenario);
}

export async function updateSimulationScenario(
  scenarioId: string,
  update: Parameters<PulseForgeRepository["updateSimulationScenario"]>[1]
) {
  return (await getRepository()).updateSimulationScenario(scenarioId, update);
}

export async function completeActiveSimulationScenariosForDevice(
  deviceId: string,
  reason: NonNullable<SimulationScenario["completedReason"]>
) {
  return (await getRepository()).completeActiveSimulationScenariosForDevice(
    deviceId,
    reason
  );
}

export async function buildIncidentInvestigationContext(
  incidentId: string
): Promise<IncidentInvestigationContext | null> {
  const repository = await getRepository();
  const aggregate = await repository.getIncident(incidentId);
  if (!aggregate) {
    return null;
  }

  const snapshot = await repository.getSnapshot();
  const linkedConversationIds = uniqueStrings([
    ...snapshot.conversations.flatMap((conversation) =>
      conversation.incidentId === aggregate.incident.id
        ? [conversation.id]
        : []
    ),
  ]);
  const linkedAgentWork = (
    await Promise.all(
      linkedConversationIds.map(async (conversationId) => {
        const conversation = await repository.getConversation(conversationId);
        if (!conversation) {
          return null;
        }
        const runs = await repository.listAgentRuns(conversationId);
        const itemEntries = await Promise.all(
          runs.map(async (run) => repository.listRunItems(run.id))
        );
        return {
          conversation,
          runs,
          items: itemEntries.flat().map(redactInternalRunItemData),
        };
      })
    )
  ).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const linkedRunIds = new Set([
    ...linkedAgentWork.flatMap((work) => work.runs.map((run) => run.id)),
    ...aggregate.activities.flatMap((activity) =>
      activity.agentRunId ? [activity.agentRunId] : []
    ),
    ...aggregate.agentMentions.flatMap((mention) =>
      mention.agentRunId ? [mention.agentRunId] : []
    ),
    ...aggregate.actionApprovals.map((approval) => approval.agentRunId),
  ]);
  const devices = (
    await Promise.all(
      aggregate.incident.deviceIds.map(async (deviceId) => {
        const device = snapshot.devices.find((item) => item.id === deviceId);
        if (!device) {
          return null;
        }

        const telemetry = (await repository.getDeviceTelemetry(deviceId)) ?? [];
        return { device, telemetry };
      })
    )
  ).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const remediationActions = snapshot.remediationActions.filter(
    (action) => action.incidentId === aggregate.incident.id
  );
  const tickets = snapshot.tickets.filter(
    (ticket) => ticket.incidentId === aggregate.incident.id
  );
  const simulationScenarios = snapshot.simulationScenarios.filter(
    (scenario) =>
      scenario.incidentId === aggregate.incident.id ||
      aggregate.incident.deviceIds.includes(scenario.deviceId)
  );
  const auditLogs = snapshot.auditLogs.filter(
    (entry) =>
      entry.resourceId === aggregate.incident.id ||
      aggregate.incident.deviceIds.includes(entry.resourceId ?? "") ||
      Boolean(entry.actor.agentRunId && linkedRunIds.has(entry.actor.agentRunId))
  );
  const resolutionEvidence = buildResolutionEvidence({
    incident: aggregate.incident,
    activities: aggregate.activities,
    comments: aggregate.comments,
    actionApprovals: aggregate.actionApprovals,
    devices,
    linkedAgentWork,
    auditLogs,
    simulationScenarios,
  });

  return {
    incident: aggregate.incident,
    activities: aggregate.activities,
    comments: aggregate.comments,
    agentMentions: aggregate.agentMentions,
    actionApprovals: aggregate.actionApprovals,
    devices,
    relatedIncidents: snapshot.incidents.filter(
      (item) =>
        item.id !== aggregate.incident.id &&
        (item.siteId === aggregate.incident.siteId ||
          item.category === aggregate.incident.category)
    ),
    remediationActions,
    tickets,
    simulationScenarios,
    linkedAgentWork,
    auditLogs,
    resolutionEvidence,
    runbook: demoRunbooks.find(
      (item) => item.category === aggregate.incident.category
    ),
  };
}

export async function getAgentRun(runId: string) {
  return (await getRepository()).getAgentRun(runId);
}

export async function getConversation(conversationId: string) {
  return (await getRepository()).getConversation(conversationId);
}

export async function getConversationDetail(
  conversationId: string
): Promise<ConversationDetail | null> {
  const repository = await getRepository();
  const conversation = await repository.getConversation(conversationId);
  if (!conversation) {
    return null;
  }

  const [runs, runtimeSessions] = await Promise.all([
    repository.listAgentRuns(conversationId),
    repository.listRuntimeSessions(conversationId),
  ]);
  const itemEntries = await Promise.all(
    runs.map(async (run) => [run.id, await repository.listRunItems(run.id)] as const)
  );

  return {
    conversation,
    runs,
    runtimeSessions,
    itemsByRunId: Object.fromEntries(
      itemEntries.map(([runId, items]) => [
        runId,
        items.map(redactInternalRunItemData),
      ])
    ),
  };
}

export async function createConversation(
  conversation: Parameters<PulseForgeRepository["createConversation"]>[0]
) {
  return (await getRepository()).createConversation(conversation);
}

export async function updateConversationActiveRun(
  conversationId: string,
  activeRootRunId: string | null
) {
  return (await getRepository()).updateConversationActiveRun(
    conversationId,
    activeRootRunId
  );
}

export async function claimConversationActiveRun(
  conversationId: string,
  activeRootRunId: string
) {
  return (await getRepository()).claimConversationActiveRun(
    conversationId,
    activeRootRunId
  );
}

export async function upsertConversationToolApprovalGrant(
  conversationId: string,
  grant: Parameters<PulseForgeRepository["upsertConversationToolApprovalGrant"]>[1]
) {
  return (await getRepository()).upsertConversationToolApprovalGrant(
    conversationId,
    grant
  );
}

export async function getRuntimeSessionByProvider(
  conversationId: string,
  provider: string,
  runtimeIdentity: string
) {
  return (await getRepository()).getRuntimeSessionByProvider(
    conversationId,
    provider,
    runtimeIdentity
  );
}

export async function listRuntimeSessions(conversationId: string) {
  return (await getRepository()).listRuntimeSessions(conversationId);
}

export async function createRuntimeSession(
  session: Parameters<PulseForgeRepository["createRuntimeSession"]>[0]
) {
  return (await getRepository()).createRuntimeSession(session);
}

export async function touchRuntimeSession(
  sessionId: string,
  status?: RuntimeSession["status"]
) {
  return (await getRepository()).touchRuntimeSession(sessionId, status);
}

export async function createAgentRun(
  run: Parameters<PulseForgeRepository["createAgentRun"]>[0]
) {
  return (await getRepository()).createAgentRun(run);
}

export async function createAgentRunSnapshot(
  snapshot: Parameters<PulseForgeRepository["createAgentRunSnapshot"]>[0]
) {
  return (await getRepository()).createAgentRunSnapshot(snapshot);
}

export async function getAgentRunSnapshot(snapshotId: string) {
  return (await getRepository()).getAgentRunSnapshot(snapshotId);
}

export async function updateAgentRunStatus(
  runId: string,
  update: Parameters<PulseForgeRepository["updateAgentRunStatus"]>[1]
) {
  return (await getRepository()).updateAgentRunStatus(runId, update);
}

export async function appendRunItems(
  runId: string,
  items: Parameters<PulseForgeRepository["appendRunItems"]>[1]
) {
  return (await getRepository()).appendRunItems(runId, items);
}

export async function listRunItems(runId: string) {
  return (await getRepository()).listRunItems(runId);
}

export async function updateRequiredActionStatus(
  runId: string,
  requiredActionId: string,
  update: Parameters<PulseForgeRepository["updateRequiredActionStatus"]>[2]
) {
  return (await getRepository()).updateRequiredActionStatus(
    runId,
    requiredActionId,
    update
  );
}

export async function updateRequiredActionData(
  runId: string,
  requiredActionId: string,
  update: Parameters<PulseForgeRepository["updateRequiredActionData"]>[2]
) {
  return (await getRepository()).updateRequiredActionData(
    runId,
    requiredActionId,
    update
  );
}

export async function updateToolCallStatus(
  runId: string,
  toolCallId: string,
  status: Parameters<PulseForgeRepository["updateToolCallStatus"]>[2]
) {
  return (await getRepository()).updateToolCallStatus(
    runId,
    toolCallId,
    status
  );
}

function redactInternalRunItemData(item: RunItem): RunItem {
  if (
    item.kind !== "required_action" ||
    typeof item.data !== "object" ||
    item.data === null ||
    !("resume" in item.data)
  ) {
    return item;
  }

  const { resume: _resume, ...publicData } = item.data as Record<
    string,
    unknown
  >;
  return {
    ...item,
    data: publicData,
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function buildResolutionEvidence(input: {
  incident: IncidentInvestigationContext["incident"];
  activities: IncidentActivity[];
  comments: IncidentComment[];
  actionApprovals: IncidentActionApproval[];
  devices: IncidentInvestigationContext["devices"];
  linkedAgentWork: IncidentInvestigationContext["linkedAgentWork"];
  auditLogs: AuditLogEntry[];
  simulationScenarios: SimulationScenario[];
}): ResolutionEvidence {
  const timeline: ResolutionEvidenceTimelineEntry[] = [];
  const runsById = new Map(
    input.linkedAgentWork.flatMap((work) =>
      work.runs.map((run) => [run.id, run] as const)
    )
  );
  const projectedApprovalKeys = new Set(
    input.actionApprovals.map(
      (approval) => `${approval.agentRunId}:${approval.requiredActionId}`
    )
  );

  for (const activity of input.activities) {
    if (activity.kind === "detected") {
      timeline.push({
        timestamp: activity.timestamp,
        kind: "incident_detected",
        title: activity.title ?? "Incident detected",
        summary: activity.summary ?? activity.message,
        actor: activity.createdBy,
        source: { type: "incident_activity", id: activity.id },
      });
    }

    if (activity.kind === "incident_resolved") {
      timeline.push({
        timestamp: activity.timestamp,
        kind: "incident_resolved",
        title: activity.title ?? "Incident resolved",
        summary: activity.summary ?? activity.message,
        actor: activity.createdBy,
        source: { type: "incident_activity", id: activity.id },
      });
    }
  }

  for (const comment of input.comments.filter(isResolutionRelevantComment)) {
    timeline.push({
      timestamp: comment.createdAt,
      kind: "incident_comment",
      title: "Operator comment",
      summary: comment.body,
      actor: { actorType: "user", actorId: comment.authorUserId },
      source: { type: "incident_comment", id: comment.id },
    });
  }

  for (const work of input.linkedAgentWork) {
    const itemsByRunId = new Map<string, RunItem[]>();
    for (const item of work.items) {
      itemsByRunId.set(item.runId, [...(itemsByRunId.get(item.runId) ?? []), item]);
    }

    for (const run of work.runs) {
      timeline.push({
        timestamp: run.startedAt ?? work.conversation.createdAt,
        kind: "agent_run_started",
        title: `${agentKindLabel(run.agentKind)} started`,
        summary: run.requestedByUserId
          ? `Requested by ${run.requestedByUserId}.`
          : undefined,
        actor: run.requestedByUserId
          ? { actorType: "user", actorId: run.requestedByUserId }
          : { actorType: "agent", actorId: run.agentKind, agentRunId: run.id },
        source: { type: "agent_run", id: run.id },
      });

      const summary = agentRunSummary(run, itemsByRunId.get(run.id) ?? []);
      if (summary) {
        timeline.push({
          timestamp: run.completedAt ?? run.startedAt ?? work.conversation.updatedAt,
          kind: "agent_summary",
          title: summary.title,
          summary: summary.summary,
          actor: { actorType: "agent", actorId: run.agentKind, agentRunId: run.id },
          source: { type: "agent_run", id: run.id },
        });
      }
    }

    const relevantToolCallIds = new Set(
      work.items.flatMap((item) =>
        item.kind === "tool_call" && isResolutionRelevantToolName(item.toolName)
          ? [item.toolCallId]
          : []
      )
    );

    for (const item of work.items) {
      const entry = runItemTimelineEntry(item, {
        relevantToolCallIds,
        projectedApprovalKeys,
      });
      if (entry) {
        timeline.push(entry);
      }
    }
  }

  for (const approval of input.actionApprovals) {
    const run = runsById.get(approval.agentRunId);
    timeline.push({
      timestamp: approval.requestedAt,
      kind: "approval_requested",
      title: approval.title,
      summary: approval.summary,
      actor: run ? agentActorFromRun(run) : undefined,
      source: { type: "incident_action_approval", id: approval.id },
    });

    if (approval.status !== "pending" && approval.resolvedAt) {
      timeline.push({
        timestamp: approval.resolvedAt,
        kind:
          approval.status === "resolved"
            ? "approval_resolved"
            : "approval_declined",
        title:
          approval.status === "resolved"
            ? `Approved: ${approval.title}`
            : `Declined: ${approval.title}`,
        summary: approval.summary,
        actor: approval.resolvedByUserId
          ? { actorType: "user", actorId: approval.resolvedByUserId }
          : undefined,
        source: { type: "incident_action_approval", id: approval.id },
      });
    }
  }

  for (const entry of input.auditLogs.filter(isResolutionRelevantAuditLog)) {
    timeline.push({
      timestamp: entry.timestamp,
      kind: "audit_event",
      title: auditLogTitle(entry),
      summary: entry.message ?? `${entry.method} ${entry.path}`,
      actor: entry.actor,
      source: { type: "audit_log", id: entry.id },
    });
  }

  for (const scenario of input.simulationScenarios) {
    if (scenario.completedReason === "reset_recovery" && scenario.completedAt) {
      timeline.push({
        timestamp: scenario.completedAt,
        kind: "recovery_signal",
        title: "Simulation recovered after reset",
        summary: `${scenario.type} scenario for ${scenario.deviceId} completed with reset recovery.`,
        source: { type: "simulation_scenario", id: scenario.id },
      });
    }
  }

  for (const { device, telemetry } of input.devices) {
    if (input.incident.status === "resolved" && device.status === "healthy") {
      timeline.push({
        timestamp: device.lastSeenAt,
        kind: "recovery_signal",
        title: `${device.name} is currently healthy`,
        summary: latestTelemetrySummary(telemetry.at(-1)),
        source: { type: "device", id: device.id },
      });
    }
  }

  if (
    input.incident.status === "resolved" &&
    input.incident.resolvedAt &&
    !timeline.some((entry) => entry.kind === "incident_resolved")
  ) {
    timeline.push({
      timestamp: input.incident.resolvedAt,
      kind: "incident_resolved",
      title: "Incident resolved",
      actor: input.incident.resolvedByUserId
        ? { actorType: "user", actorId: input.incident.resolvedByUserId }
        : undefined,
      source: { type: "incident", id: input.incident.id },
    });
  }

  return {
    isResolved: input.incident.status === "resolved",
    resolvedAt: input.incident.resolvedAt,
    resolvedByUserId: input.incident.resolvedByUserId,
    timeline: timeline.sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp)
    ),
    currentState: {
      incidentStatus: input.incident.status,
      latestDeviceStates: input.devices.map(({ device, telemetry }) => ({
        deviceId: device.id,
        status: device.status,
        batteryPercent: device.batteryPercent,
        connectivityPercent: device.connectivityPercent,
        lastSeenAt: device.lastSeenAt,
        latestTelemetry: telemetry.at(-1),
      })),
    },
  };
}

function isResolutionRelevantComment(comment: IncidentComment): boolean {
  return /@copilot|approv|fix|investigat|recover|remediat|reset|resolv/i.test(
    comment.body
  );
}

function runItemTimelineEntry(
  item: RunItem,
  context: {
    relevantToolCallIds: Set<string>;
    projectedApprovalKeys: Set<string>;
  }
): ResolutionEvidenceTimelineEntry | null {
  if (item.kind === "tool_call") {
    if (!isResolutionRelevantToolName(item.toolName)) {
      return null;
    }
    return {
      timestamp: item.createdAt,
      kind: "tool_call",
      title: `Tool called: ${item.toolName}`,
      summary: stringifyCompact(item.arguments),
      actor: agentActorFromRunItem(item),
      source: { type: "run_item", id: item.id },
    };
  }

  if (item.kind === "tool_result") {
    if (!context.relevantToolCallIds.has(item.toolCallId)) {
      return null;
    }
    return {
      timestamp: item.createdAt,
      kind: "tool_result",
      title: item.isError ? "Tool failed" : "Tool succeeded",
      summary: contentToText(item.content),
      actor: toolActorFromRunItem(item),
      source: { type: "run_item", id: item.id },
    };
  }

  if (item.kind === "required_action") {
    if (
      item.actionType !== "tool_approval" ||
      context.projectedApprovalKeys.has(`${item.runId}:${item.requiredActionId}`)
    ) {
      return null;
    }
    return {
      timestamp: item.createdAt,
      kind: "approval_requested",
      title: "Approval requested",
      summary: contentToText(item.content),
      actor: agentActorFromRunItem(item),
      source: { type: "run_item", id: item.id },
    };
  }

  if (
    item.kind !== "action_resolution" ||
    context.projectedApprovalKeys.has(`${item.runId}:${item.requiredActionId}`)
  ) {
    return null;
  }

  return {
    timestamp: item.createdAt,
    kind: item.outcome === "resolved" ? "approval_resolved" : "approval_declined",
    title:
      item.outcome === "resolved" ? "Approval resolved" : "Approval declined",
    summary: contentToText(item.content ?? []),
    actor: actorFromRunItemSource(item.source),
    source: { type: "run_item", id: item.id },
  };
}

function agentRunSummary(run: AgentRun, items: RunItem[]) {
  if (run.investigation) {
    return {
      title: run.investigation.title,
      summary: [
        run.investigation.summary,
        ...run.investigation.findings.map((finding) => `Finding: ${finding}`),
        ...run.investigation.recommendedActions.map(
          (action) => `Recommended action: ${action}`
        ),
      ].join("\n"),
    };
  }
  if (run.summary) {
    return {
      title: `${agentKindLabel(run.agentKind)} summary`,
      summary: run.summary,
    };
  }
  const finalAgentMessage = [...items]
    .reverse()
    .find(
      (item): item is Extract<RunItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "agent"
    );
  if (!finalAgentMessage) {
    return null;
  }
  return {
    title: `${agentKindLabel(run.agentKind)} response`,
    summary: contentToText(finalAgentMessage.content),
  };
}

function isResolutionRelevantToolName(toolName?: string): boolean {
  return toolName === "reset_device";
}

function isResolutionRelevantAuditLog(entry: AuditLogEntry): boolean {
  return entry.operation === "device.reset";
}

function auditLogTitle(entry: AuditLogEntry): string {
  if (entry.operation === "device.reset") {
    return entry.outcome === "succeeded"
      ? "Device reset audited"
      : "Device reset failed";
  }
  return `Audit event: ${entry.operation}`;
}

function agentActorFromRunItem(
  item: RunItem
): ResolutionEvidenceTimelineEntry["actor"] {
  return item.source.type === "agent"
    ? {
        actorType: "agent",
        actorId: item.source.agentKind,
        agentRunId: item.source.agentRunId,
      }
    : undefined;
}

function toolActorFromRunItem(
  item: RunItem
): ResolutionEvidenceTimelineEntry["actor"] {
  return item.source.type === "tool"
    ? { actorType: "system", actorId: item.source.toolName }
    : undefined;
}

function agentActorFromRun(run: AgentRun): ResolutionEvidenceTimelineEntry["actor"] {
  return { actorType: "agent", actorId: run.agentKind, agentRunId: run.id };
}

function actorFromRunItemSource(
  source: RunItem["source"]
): ResolutionEvidenceTimelineEntry["actor"] {
  if (source.type === "user") {
    return { actorType: "user", actorId: source.userId };
  }
  if (source.type === "agent") {
    return {
      actorType: "agent",
      actorId: source.agentKind,
      agentRunId: source.agentRunId,
    };
  }
  if (source.type === "tool") {
    return { actorType: "system", actorId: source.toolName };
  }
  if (source.type === "external_service") {
    return { actorType: "system", actorId: source.service };
  }
  return { actorType: "system", actorId: "pulseforge" };
}

function agentKindLabel(agentKind: AgentRun["agentKind"]): string {
  return agentKind === "ops-copilot" ? "Copilot" : "Incident Responder";
}

function latestTelemetrySummary(point?: DeviceMetricSnapshot): string | undefined {
  if (!point) {
    return undefined;
  }
  const parts = [
    `latest telemetry at ${point.timestamp}`,
    `signal ${point.signalStrength}`,
    `packet loss ${point.packetLossPercent}%`,
    `battery ${point.batteryPercent}%`,
  ];
  if (typeof point.temperatureC === "number") {
    parts.push(`temperature ${point.temperatureC}C`);
  }
  if (typeof point.vibrationMmS === "number") {
    parts.push(`vibration ${point.vibrationMmS}mm/s`);
  }
  return parts.join(", ");
}

function contentToText(content: ContentBlock[]): string {
  return content
    .map((block) => {
      if (block.type === "text") {
        return stripThinkingBlocks(block.text);
      }
      if (block.type === "json") {
        return stringifyCompact(block.value);
      }
      if (block.type === "resource_ref") {
        return `${block.resourceType}:${block.resourceId}`;
      }
      if (block.type === "file") {
        return block.name ?? block.fileId;
      }
      return block.alt ?? block.fileId;
    })
    .filter(Boolean)
    .join("\n");
}

function stringifyCompact(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stripThinkingBlocks(value: string): string {
  return value
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<\/?thinking>/gi, "")
    .trim();
}

export async function createIncidentActivity(
  activity: Omit<IncidentActivity, "id" | "timestamp"> & {
    id?: string;
    timestamp?: string;
    createdBy: AuditActor;
  }
) {
  return (await getRepository()).createIncidentActivity(activity);
}

export async function updateIncidentActivity(
  activityId: string,
  update: Parameters<PulseForgeRepository["updateIncidentActivity"]>[1]
) {
  return (await getRepository()).updateIncidentActivity(activityId, update);
}

export async function updateIncidentActivityByAgentRun(
  agentRunId: string,
  update: Parameters<PulseForgeRepository["updateIncidentActivityByAgentRun"]>[1]
) {
  return (await getRepository()).updateIncidentActivityByAgentRun(
    agentRunId,
    update
  );
}

export async function createIncidentComment(
  comment: Omit<IncidentComment, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
  }
) {
  return (await getRepository()).createIncidentComment(comment);
}

export async function createIncidentAgentMention(
  mention: Omit<IncidentAgentMention, "id" | "createdAt"> & {
    id?: string;
    createdAt?: string;
  }
) {
  return (await getRepository()).createIncidentAgentMention(mention);
}

export async function updateIncidentAgentMention(
  mentionId: string,
  update: Parameters<PulseForgeRepository["updateIncidentAgentMention"]>[1]
) {
  return (await getRepository()).updateIncidentAgentMention(mentionId, update);
}

export async function createIncidentActionApproval(
  approval: Omit<IncidentActionApproval, "id" | "requestedAt" | "status"> & {
    id?: string;
    requestedAt?: string;
    status?: IncidentActionApproval["status"];
  }
) {
  return (await getRepository()).createIncidentActionApproval(approval);
}

export async function updateIncidentActionApprovalStatus(
  approvalId: string,
  update: Parameters<PulseForgeRepository["updateIncidentActionApprovalStatus"]>[1]
) {
  return (await getRepository()).updateIncidentActionApprovalStatus(
    approvalId,
    update
  );
}

export async function updateIncidentActionApprovalByRequiredAction(
  agentRunId: string,
  requiredActionId: string,
  update: Parameters<
    PulseForgeRepository["updateIncidentActionApprovalByRequiredAction"]
  >[2]
) {
  return (await getRepository()).updateIncidentActionApprovalByRequiredAction(
    agentRunId,
    requiredActionId,
    update
  );
}

export async function createTicket(
  ticket: Omit<Ticket, "id" | "createdAt" | "externalRef" | "status"> & {
    id?: string;
    externalRef?: string;
    status?: Ticket["status"];
    createdAt?: string;
    createdBy: AuditActor;
  }
) {
  return (await getRepository()).createTicket(ticket);
}

export async function createRemediationAction(
  action: Omit<RemediationAction, "id" | "status"> & {
    id?: string;
    status?: RemediationAction["status"];
    createdBy: AuditActor;
  }
) {
  return (await getRepository()).createRemediationAction(action);
}

export async function createAuditLog(
  entry: Omit<AuditLogEntry, "id" | "timestamp"> & {
    id?: string;
    timestamp?: string;
  }
) {
  return (await getRepository()).createAuditLog(entry);
}

export async function seedDemoData() {
  return (await getRepository()).seedDemoData();
}

export async function cleanupDemoData() {
  return (await getRepository()).cleanupDemoData();
}

export async function resetRepositoryForTests(): Promise<void> {
  repositoryPromise = null;
}
