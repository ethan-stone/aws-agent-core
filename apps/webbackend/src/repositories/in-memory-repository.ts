import {
  type AgentRun,
  type AgentRunResult,
  type AuditLogEntry,
  type CreateAgentRunRequest,
  demoAuditLogs,
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
  type IncidentEvent,
  type PulseForgeSnapshot,
  type RemediationAction,
  type Ticket,
} from "../../../../shared/pulseforge-domain/src/index.js";
import { randomUUID } from "node:crypto";
import type {
  IncidentAggregate,
  PulseForgeRepository,
} from "./types.js";

export class InMemoryPulseForgeRepository implements PulseForgeRepository {
  private readonly agentRuns = new Map<string, AgentRun>(
    demoAgentRuns.map((run) => [run.id, run])
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
      agentRuns: [...this.agentRuns.values()],
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

  async getAgentRun(runId: string): Promise<AgentRun | null> {
    return this.agentRuns.get(runId) ?? null;
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

  async createAgentRun(
    run: CreateAgentRunRequest & { id: string; requestedByUserId?: string }
  ): Promise<AgentRun> {
    const created: AgentRun = {
      id: run.id,
      incidentId: run.incidentId,
      deviceId: run.deviceId,
      sessionId: run.sessionId,
      agentKind: run.agentKind,
      status: "queued",
      requestedAt: new Date().toISOString(),
      requestedByUserId: run.requestedByUserId,
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

  async requireAgentRunAuth(
    runId: string,
    authRequired: NonNullable<AgentRunResult["authRequired"]>
  ): Promise<AgentRun | null> {
    const existing = this.agentRuns.get(runId);
    if (!existing) {
      return null;
    }

    const updated: AgentRun = {
      ...existing,
      status: "auth_required",
      summary: "Agent run requires delegated tool authorization.",
      authRequired,
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

    this.incidentEvents.clear();
    this.remediationActions.clear();
    this.tickets.clear();
    this.agentRuns.clear();
    this.auditLogs.clear();

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
