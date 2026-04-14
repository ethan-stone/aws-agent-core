import { MongoClient, type Collection, type Db } from "mongodb";
import {
  demoAgentRuns,
  demoDeviceMetrics,
  demoDevices,
  demoIncidentEvents,
  demoIncidents,
  demoRemediationActions,
  demoSites,
  demoTickets,
  type AgentRun,
  type DashboardSummary,
  type Device,
  type DeviceMetricSnapshot,
  type Incident,
  type IncidentEvent,
  type PulseForgeSnapshot,
  type RemediationAction,
  type Site,
  type Ticket,
} from "../../../../shared/pulseforge-domain/src/index.js";
import type {
  IncidentAggregate,
  PulseForgeRepository,
} from "./types.js";

interface Collections {
  sites: Collection<Site>;
  devices: Collection<Device>;
  telemetry: Collection<DeviceMetricSnapshot & { deviceId: string }>;
  incidents: Collection<Incident>;
  incidentEvents: Collection<IncidentEvent>;
  remediationActions: Collection<RemediationAction>;
  tickets: Collection<Ticket>;
  agentRuns: Collection<AgentRun>;
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
      devices: this.db.collection<Device>("devices"),
      telemetry: this.db.collection<DeviceMetricSnapshot & { deviceId: string }>(
        "telemetry"
      ),
      incidents: this.db.collection<Incident>("incidents"),
      incidentEvents: this.db.collection<IncidentEvent>("incident_events"),
      remediationActions:
        this.db.collection<RemediationAction>("remediation_actions"),
      tickets: this.db.collection<Ticket>("tickets"),
      agentRuns: this.db.collection<AgentRun>("agent_runs"),
    };
  }

  async getSnapshot(): Promise<PulseForgeSnapshot> {
    const collections = this.collections();
    const [
      sites,
      devices,
      telemetryDocs,
      incidents,
      incidentEvents,
      remediationActions,
      tickets,
      agentRuns,
    ] = await Promise.all([
      collections.sites.find().toArray(),
      collections.devices.find().toArray(),
      collections.telemetry.find().toArray(),
      collections.incidents.find().toArray(),
      collections.incidentEvents.find().toArray(),
      collections.remediationActions.find().toArray(),
      collections.tickets.find().toArray(),
      collections.agentRuns.find().toArray(),
    ]);

    const deviceMetrics = telemetryDocs.reduce<
      Record<string, DeviceMetricSnapshot[]>
    >((acc, item) => {
      const { deviceId, ...metric } = item;
      acc[deviceId] ??= [];
      acc[deviceId].push(metric);
      return acc;
    }, {});

    for (const metrics of Object.values(deviceMetrics)) {
      metrics.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }

    return {
      sites,
      devices,
      deviceMetrics,
      incidents,
      incidentEvents,
      remediationActions,
      tickets,
      agentRuns,
      dashboard: buildDashboard(devices, incidents, sites.length),
    };
  }

  async getDashboard(): Promise<DashboardSummary> {
    const collections = this.collections();
    const [devices, incidents, totalSites] = await Promise.all([
      collections.devices.find().toArray(),
      collections.incidents.find().toArray(),
      collections.sites.countDocuments(),
    ]);

    return buildDashboard(devices, incidents, totalSites);
  }

  async listDevices(): Promise<Device[]> {
    return this.collections().devices.find().sort({ name: 1 }).toArray();
  }

  async getDevice(deviceId: string): Promise<Device | null> {
    return this.collections().devices.findOne({ id: deviceId });
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

    return items.map(({ deviceId: _deviceId, ...metric }) => metric);
  }

  async listIncidents(): Promise<Incident[]> {
    return this.collections().incidents.find().sort({ updatedAt: -1 }).toArray();
  }

  async getIncident(incidentId: string): Promise<IncidentAggregate | null> {
    const collections = this.collections();
    const [incident, events] = await Promise.all([
      collections.incidents.findOne({ id: incidentId }),
      collections.incidentEvents
        .find({ incidentId })
        .sort({ timestamp: 1 })
        .toArray(),
    ]);

    if (!incident) {
      return null;
    }

    return { incident, events };
  }

  async seedDemoData(): Promise<void> {
    const collections = this.collections();

    await Promise.all([
      collections.sites.deleteMany({}),
      collections.devices.deleteMany({}),
      collections.telemetry.deleteMany({}),
      collections.incidents.deleteMany({}),
      collections.incidentEvents.deleteMany({}),
      collections.remediationActions.deleteMany({}),
      collections.tickets.deleteMany({}),
      collections.agentRuns.deleteMany({}),
    ]);

    await Promise.all([
      collections.sites.insertMany(demoSites),
      collections.devices.insertMany(demoDevices),
      collections.telemetry.insertMany(
        Object.entries(demoDeviceMetrics).flatMap(([deviceId, metrics]) =>
          metrics.map((metric) => ({ deviceId, ...metric }))
        )
      ),
      collections.incidents.insertMany(demoIncidents),
      collections.incidentEvents.insertMany(demoIncidentEvents),
      collections.remediationActions.insertMany(demoRemediationActions),
      collections.tickets.insertMany(demoTickets),
      collections.agentRuns.insertMany(demoAgentRuns),
    ]);

    await Promise.all([
      collections.devices.createIndex({ id: 1 }, { unique: true }),
      collections.incidents.createIndex({ id: 1 }, { unique: true }),
      collections.incidentEvents.createIndex({ incidentId: 1, timestamp: 1 }),
      collections.telemetry.createIndex({ deviceId: 1, timestamp: 1 }),
      collections.tickets.createIndex({ incidentId: 1 }),
      collections.agentRuns.createIndex({ incidentId: 1 }),
    ]);
  }
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
