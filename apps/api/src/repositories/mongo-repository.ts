import { MongoClient, type Collection, type Db, type WithId } from "mongodb";
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
  type AgentRunResult,
  type CreateAgentRunRequest,
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

type PersistedDevice = Omit<Device, "lastSeenAt"> & { lastSeenAt: Date };
type PersistedTelemetry = Omit<DeviceMetricSnapshot, "timestamp"> & {
  deviceId: string;
  timestamp: Date;
};
type PersistedIncident = Omit<Incident, "createdAt" | "updatedAt"> & {
  createdAt: Date;
  updatedAt: Date;
};
type PersistedIncidentEvent = Omit<IncidentEvent, "timestamp"> & {
  timestamp: Date;
};
type PersistedTicket = Omit<Ticket, "createdAt"> & { createdAt: Date };
type PersistedAgentRun = Omit<AgentRun, "requestedAt" | "completedAt"> & {
  requestedAt: Date;
  completedAt?: Date;
};

interface Collections {
  sites: Collection<Site>;
  devices: Collection<PersistedDevice>;
  telemetry: Collection<PersistedTelemetry>;
  incidents: Collection<PersistedIncident>;
  incidentEvents: Collection<PersistedIncidentEvent>;
  remediationActions: Collection<RemediationAction>;
  tickets: Collection<PersistedTicket>;
  agentRuns: Collection<PersistedAgentRun>;
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
      devices: this.db.collection<PersistedDevice>("devices"),
      telemetry: this.db.collection<PersistedTelemetry>("telemetry"),
      incidents: this.db.collection<PersistedIncident>("incidents"),
      incidentEvents:
        this.db.collection<PersistedIncidentEvent>("incident_events"),
      remediationActions:
        this.db.collection<RemediationAction>("remediation_actions"),
      tickets: this.db.collection<PersistedTicket>("tickets"),
      agentRuns: this.db.collection<PersistedAgentRun>("agent_runs"),
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

    const normalizedSites = sites.map((site) => stripMongoId<Site>(site));
    const normalizedDevices = devices.map((device) =>
      mapPersistedDevice(stripMongoId<PersistedDevice>(device))
    );
    const normalizedIncidents = incidents.map((incident) =>
      mapPersistedIncident(stripMongoId<PersistedIncident>(incident))
    );
    const normalizedIncidentEvents = incidentEvents.map((event) =>
      mapPersistedIncidentEvent(stripMongoId<PersistedIncidentEvent>(event))
    );
    const normalizedRemediationActions = remediationActions.map((action) =>
      stripMongoId<RemediationAction>(action)
    );
    const normalizedTickets = tickets.map((ticket) =>
      mapPersistedTicket(stripMongoId<PersistedTicket>(ticket))
    );
    const normalizedAgentRuns = agentRuns.map((run) =>
      mapPersistedAgentRun(stripMongoId<PersistedAgentRun>(run))
    );

    const deviceMetrics = telemetryDocs.reduce<
      Record<string, DeviceMetricSnapshot[]>
    >((acc, item) => {
      const { _id, deviceId, ...metric } = item;
      acc[deviceId] ??= [];
      acc[deviceId].push(mapPersistedTelemetry(metric));
      return acc;
    }, {});

    for (const metrics of Object.values(deviceMetrics)) {
      metrics.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }

    return {
      sites: normalizedSites,
      devices: normalizedDevices,
      deviceMetrics,
      incidents: normalizedIncidents,
      incidentEvents: normalizedIncidentEvents,
      remediationActions: normalizedRemediationActions,
      tickets: normalizedTickets,
      agentRuns: normalizedAgentRuns,
      dashboard: buildDashboard(
        normalizedDevices,
        normalizedIncidents,
        normalizedSites.length
      ),
    };
  }

  async getDashboard(): Promise<DashboardSummary> {
    const collections = this.collections();
    const [devices, incidents, totalSites] = await Promise.all([
      collections.devices.find().toArray(),
      collections.incidents.find().toArray(),
      collections.sites.countDocuments(),
    ]);

    return buildDashboard(
      devices.map((device) =>
        mapPersistedDevice(stripMongoId<PersistedDevice>(device))
      ),
      incidents.map((incident) =>
        mapPersistedIncident(stripMongoId<PersistedIncident>(incident))
      ),
      totalSites
    );
  }

  async listDevices(): Promise<Device[]> {
    const items = await this.collections().devices.find().sort({ name: 1 }).toArray();
    return items.map((device) =>
      mapPersistedDevice(stripMongoId<PersistedDevice>(device))
    );
  }

  async getDevice(deviceId: string): Promise<Device | null> {
    const item = await this.collections().devices.findOne({ id: deviceId });
    return item
      ? mapPersistedDevice(stripMongoId<PersistedDevice>(item))
      : null;
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

    return items.map(({ _id, deviceId: _deviceId, ...metric }) =>
      mapPersistedTelemetry(metric)
    );
  }

  async listIncidents(): Promise<Incident[]> {
    const items = await this.collections()
      .incidents.find()
      .sort({ updatedAt: -1 })
      .toArray();
    return items.map((incident) =>
      mapPersistedIncident(stripMongoId<PersistedIncident>(incident))
    );
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

    return {
      incident: mapPersistedIncident(stripMongoId<PersistedIncident>(incident)),
      events: events.map((event) =>
        mapPersistedIncidentEvent(stripMongoId<PersistedIncidentEvent>(event))
      ),
    };
  }

  async getAgentRun(runId: string): Promise<AgentRun | null> {
    const item = await this.collections().agentRuns.findOne({ id: runId });
    return item
      ? mapPersistedAgentRun(stripMongoId<PersistedAgentRun>(item))
      : null;
  }

  async createAgentRun(
    run: CreateAgentRunRequest & { id: string }
  ): Promise<AgentRun> {
    const created: PersistedAgentRun = {
      id: run.id,
      incidentId: run.incidentId,
      deviceId: run.deviceId,
      sessionId: run.sessionId,
      agentKind: run.agentKind,
      status: "queued",
      requestedAt: new Date(),
      summary: "Queued for AgentCore invocation.",
      prompt: run.prompt,
      messages: [{ role: "user", content: run.prompt }],
    };

    await this.collections().agentRuns.insertOne(created);
    return mapPersistedAgentRun(created);
  }

  async completeAgentRun(
    runId: string,
    result: AgentRunResult
  ): Promise<AgentRun | null> {
    const completedAt = new Date();
    await this.collections().agentRuns.updateOne(
      { id: runId },
      {
        $set: {
          status: "completed",
          completedAt,
          summary: result.summary,
          messages: result.messages,
          investigation: result.investigation,
        },
      }
    );

    return this.getAgentRun(runId);
  }

  async failAgentRun(
    runId: string,
    errorMessage: string
  ): Promise<AgentRun | null> {
    const completedAt = new Date();
    await this.collections().agentRuns.updateOne(
      { id: runId },
      {
        $set: {
          status: "failed",
          completedAt,
          summary: "Agent run failed.",
          errorMessage,
        },
      }
    );

    return this.getAgentRun(runId);
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
      collections.devices.insertMany(demoDevices.map(toPersistedDevice)),
      collections.telemetry.insertMany(
        Object.entries(demoDeviceMetrics).flatMap(([deviceId, metrics]) =>
          metrics.map((metric) => toPersistedTelemetry(deviceId, metric))
        )
      ),
      collections.incidents.insertMany(demoIncidents.map(toPersistedIncident)),
      collections.incidentEvents.insertMany(
        demoIncidentEvents.map(toPersistedIncidentEvent)
      ),
      collections.remediationActions.insertMany(demoRemediationActions),
      collections.tickets.insertMany(demoTickets.map(toPersistedTicket)),
      collections.agentRuns.insertMany(demoAgentRuns.map(toPersistedAgentRun)),
    ]);

    await Promise.all([
      collections.devices.createIndex({ id: 1 }, { unique: true }),
      collections.incidents.createIndex({ id: 1 }, { unique: true }),
      collections.incidentEvents.createIndex({ incidentId: 1, timestamp: 1 }),
      collections.telemetry.createIndex({ deviceId: 1, timestamp: 1 }),
      collections.tickets.createIndex({ incidentId: 1 }),
      collections.agentRuns.createIndex({ id: 1 }, { unique: true }),
      collections.agentRuns.createIndex({ incidentId: 1 }),
    ]);
  }
}

function stripMongoId<T>(document: WithId<T>): T {
  const { _id, ...rest } = document as WithId<T>;
  void _id;
  return rest as T;
}

function toPersistedDevice(device: Device): PersistedDevice {
  return {
    ...device,
    lastSeenAt: new Date(device.lastSeenAt),
  };
}

function mapPersistedDevice(device: PersistedDevice): Device {
  return {
    ...device,
    lastSeenAt: device.lastSeenAt.toISOString(),
  };
}

function toPersistedTelemetry(
  deviceId: string,
  metric: DeviceMetricSnapshot
): PersistedTelemetry {
  return {
    deviceId,
    ...metric,
    timestamp: new Date(metric.timestamp),
  };
}

function mapPersistedTelemetry(
  metric: Omit<PersistedTelemetry, "deviceId">
): DeviceMetricSnapshot {
  return {
    ...metric,
    timestamp: metric.timestamp.toISOString(),
  };
}

function toPersistedIncident(incident: Incident): PersistedIncident {
  return {
    ...incident,
    createdAt: new Date(incident.createdAt),
    updatedAt: new Date(incident.updatedAt),
  };
}

function mapPersistedIncident(incident: PersistedIncident): Incident {
  return {
    ...incident,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
  };
}

function toPersistedIncidentEvent(event: IncidentEvent): PersistedIncidentEvent {
  return {
    ...event,
    timestamp: new Date(event.timestamp),
  };
}

function mapPersistedIncidentEvent(
  event: PersistedIncidentEvent
): IncidentEvent {
  return {
    ...event,
    timestamp: event.timestamp.toISOString(),
  };
}

function toPersistedTicket(ticket: Ticket): PersistedTicket {
  return {
    ...ticket,
    createdAt: new Date(ticket.createdAt),
  };
}

function mapPersistedTicket(ticket: PersistedTicket): Ticket {
  return {
    ...ticket,
    createdAt: ticket.createdAt.toISOString(),
  };
}

function toPersistedAgentRun(run: AgentRun): PersistedAgentRun {
  return {
    ...run,
    requestedAt: new Date(run.requestedAt),
    completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
  };
}

function mapPersistedAgentRun(run: PersistedAgentRun): AgentRun {
  return {
    ...run,
    requestedAt: run.requestedAt.toISOString(),
    completedAt: run.completedAt?.toISOString(),
  };
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
