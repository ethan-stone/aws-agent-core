import { getMongoClient, getMongoDbName, isMongoConfigured } from "./mongodb.js";
import { InMemoryPulseForgeRepository } from "./repositories/in-memory-repository.js";
import { MongoPulseForgeRepository } from "./repositories/mongo-repository.js";
import type { PulseForgeRepository } from "./repositories/types.js";
import type {
  AuditActor,
  AuditLogEntry,
  ConversationDetail,
  IncidentInvestigationContext,
  IncidentActivity,
  IncidentActionApproval,
  IncidentAgentMention,
  IncidentComment,
  RemediationAction,
  RuntimeSession,
  RunItem,
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

export async function getDeviceTelemetry(deviceId: string) {
  return (await getRepository()).getDeviceTelemetry(deviceId);
}

export async function listIncidents() {
  return (await getRepository()).listIncidents();
}

export async function getIncident(incidentId: string) {
  return (await getRepository()).getIncident(incidentId);
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
  const devices = await Promise.all(
    aggregate.incident.deviceIds.map(async (deviceId) => {
      const device = snapshot.devices.find((item) => item.id === deviceId);
      if (!device) {
        return null;
      }

      const telemetry = (await repository.getDeviceTelemetry(deviceId)) ?? [];
      return { device, telemetry };
    })
  );

  return {
    incident: aggregate.incident,
    activities: aggregate.activities,
    devices: devices.filter((item): item is NonNullable<typeof item> => Boolean(item)),
    relatedIncidents: snapshot.incidents.filter(
      (item) =>
        item.id !== aggregate.incident.id &&
        (item.siteId === aggregate.incident.siteId ||
          item.category === aggregate.incident.category)
    ),
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

export async function resetRepositoryForTests(): Promise<void> {
  repositoryPromise = null;
}
