import type {
  DashboardSummary,
  Device,
  DeviceMetricSnapshot,
  Incident,
  IncidentEvent,
  PulseForgeSnapshot,
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
  seedDemoData(): Promise<void>;
}
