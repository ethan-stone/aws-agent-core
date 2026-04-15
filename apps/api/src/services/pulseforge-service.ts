import { getMongoClient, getMongoDbName, isMongoConfigured } from "../lib/mongodb.js";
import { InMemoryPulseForgeRepository } from "../repositories/in-memory-repository.js";
import { MongoPulseForgeRepository } from "../repositories/mongo-repository.js";
import type { PulseForgeRepository } from "../repositories/types.js";
import type {
  AgentRunResult,
  CreateAgentRunRequest,
} from "../../../../shared/pulseforge-domain/src/index.js";

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

export async function getAgentRun(runId: string) {
  return (await getRepository()).getAgentRun(runId);
}

export async function createAgentRun(run: CreateAgentRunRequest & { id: string }) {
  return (await getRepository()).createAgentRun(run);
}

export async function completeAgentRun(runId: string, result: AgentRunResult) {
  return (await getRepository()).completeAgentRun(runId, result);
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
