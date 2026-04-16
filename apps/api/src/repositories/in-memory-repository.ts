import {
  type AgentRun,
  type AgentRunResult,
  type CreateAgentRunRequest,
  demoAgentRuns,
  demoDashboard,
  demoDeviceMetrics,
  demoDevices,
  demoIncidentEvents,
  demoIncidents,
  demoRemediationActions,
  demoSites,
  demoSnapshot,
  demoTickets,
  type DashboardSummary,
  type Device,
  type DeviceMetricSnapshot,
  type Incident,
  type PulseForgeSnapshot,
} from "../../../../shared/pulseforge-domain/src/index.js";
import type {
  IncidentAggregate,
  PulseForgeRepository,
} from "./types.js";

export class InMemoryPulseForgeRepository implements PulseForgeRepository {
  private readonly agentRuns = new Map<string, AgentRun>(
    demoAgentRuns.map((run) => [run.id, run])
  );

  async getSnapshot(): Promise<PulseForgeSnapshot> {
    return demoSnapshot;
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
      events: demoIncidentEvents.filter((event) => event.incidentId === incidentId),
    };
  }

  async getAgentRun(runId: string): Promise<AgentRun | null> {
    return this.agentRuns.get(runId) ?? null;
  }

  async createAgentRun(
    run: CreateAgentRunRequest & { id: string }
  ): Promise<AgentRun> {
    const created: AgentRun = {
      id: run.id,
      incidentId: run.incidentId,
      deviceId: run.deviceId,
      sessionId: run.sessionId,
      agentKind: run.agentKind,
      status: "queued",
      requestedAt: new Date().toISOString(),
      summary: "Queued for AgentCore invocation.",
      prompt: run.prompt,
      messages: [{ role: "user", content: run.prompt }],
    };

    this.agentRuns.set(created.id, created);
    return created;
  }

  async completeAgentRun(
    runId: string,
    result: AgentRunResult
  ): Promise<AgentRun | null> {
    const existing = this.agentRuns.get(runId);
    if (!existing) {
      return null;
    }

    const updated: AgentRun = {
      ...existing,
      status: "completed",
      completedAt: new Date().toISOString(),
      summary: result.summary,
      messages: result.messages,
      investigation: result.investigation,
    };

    this.agentRuns.set(runId, updated);
    return updated;
  }

  async failAgentRun(
    runId: string,
    errorMessage: string
  ): Promise<AgentRun | null> {
    const existing = this.agentRuns.get(runId);
    if (!existing) {
      return null;
    }

    const updated: AgentRun = {
      ...existing,
      status: "failed",
      completedAt: new Date().toISOString(),
      summary: "Agent run failed.",
      errorMessage,
    };

    this.agentRuns.set(runId, updated);
    return updated;
  }

  async seedDemoData(): Promise<void> {
    void demoSites;
    void demoDevices;
    void demoDeviceMetrics;
    void demoIncidents;
    void demoIncidentEvents;
    void demoRemediationActions;
    void demoTickets;
    void demoAgentRuns;
  }
}
