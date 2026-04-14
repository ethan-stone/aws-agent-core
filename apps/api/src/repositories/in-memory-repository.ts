import {
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
