import { getMongoClient, getMongoDbName, isMongoConfigured } from "./mongodb.js";
import { InMemoryPulseForgeRepository } from "./repositories/in-memory-repository.js";
import { MongoPulseForgeRepository } from "./repositories/mongo-repository.js";
import type { PulseForgeRepository } from "./repositories/types.js";
import type {
  AgentRunResult,
  AuditActor,
  AuditLogEntry,
  CreateAgentRunRequest,
  IncidentInvestigationContext,
  IncidentEvent,
  RemediationAction,
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
    events: aggregate.events,
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

export async function createIncidentEvent(
  event: Omit<IncidentEvent, "id" | "timestamp"> & {
    id?: string;
    timestamp?: string;
    createdBy: AuditActor;
  }
) {
  return (await getRepository()).createIncidentEvent(event);
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

export async function createAgentRun(
  run: CreateAgentRunRequest & { id: string; requestedByUserId?: string }
) {
  return (await getRepository()).createAgentRun(run);
}

export async function completeAgentRun(runId: string, result: AgentRunResult) {
  return (await getRepository()).completeAgentRun(runId, result);
}

export async function requireAgentRunAuth(
  runId: string,
  authRequired: NonNullable<AgentRunResult["authRequired"]>
) {
  return (await getRepository()).requireAgentRunAuth(runId, authRequired);
}

export async function failAgentRun(runId: string, errorMessage: string) {
  return (await getRepository()).failAgentRun(runId, errorMessage);
}

export async function seedDemoData() {
  return (await getRepository()).seedDemoData();
}

export async function resetRepositoryForTests(): Promise<void> {
  repositoryPromise = null;
}
