import type {
  AgentRun,
  AgentRunResult,
  AuditActor,
  AuditLogEntry,
  CreateAgentRunRequest,
  DashboardSummary,
  Device,
  DeviceMetricSnapshot,
  Incident,
  IncidentEvent,
  PulseForgeSnapshot,
  RemediationAction,
  Ticket,
} from "../../../../shared/pulseforge-domain/src/index.js";

export interface IncidentAggregate {
  incident: Incident;
  events: IncidentEvent[];
}

export interface PulseForgeRepository {
  getSnapshot(): Promise<PulseForgeSnapshot>;
  getDashboard(): Promise<DashboardSummary>;
  listDevices(): Promise<Device[]>;
  getDevice(deviceId: string): Promise<Device | null>;
  getDeviceTelemetry(deviceId: string): Promise<DeviceMetricSnapshot[] | null>;
  listIncidents(): Promise<Incident[]>;
  getIncident(incidentId: string): Promise<IncidentAggregate | null>;
  getAgentRun(runId: string): Promise<AgentRun | null>;
  createIncidentEvent(event: Omit<IncidentEvent, "id" | "timestamp"> & {
    id?: string;
    timestamp?: string;
    createdBy: AuditActor;
  }): Promise<IncidentEvent>;
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
  createAgentRun(
    run: CreateAgentRunRequest & { id: string; requestedByUserId?: string }
  ): Promise<AgentRun>;
  completeAgentRun(
    runId: string,
    result: AgentRunResult
  ): Promise<AgentRun | null>;
  failAgentRun(runId: string, errorMessage: string): Promise<AgentRun | null>;
  seedDemoData(): Promise<void>;
}
