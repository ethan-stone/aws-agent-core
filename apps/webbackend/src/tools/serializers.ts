import type {
  Device,
  DeviceMetricSnapshot,
  IncidentEvent,
  IncidentInvestigationContext,
  RemediationAction,
  Ticket,
} from "../../../../shared/pulseforge-domain/src/index.js";

const RECENT_EVENT_LIMIT = 12;
const RECENT_TELEMETRY_LIMIT = 24;
const RELATED_INCIDENT_LIMIT = 5;

export function serializeDevice(device: Device) {
  return {
    ok: true as const,
    device: {
      id: device.id,
      siteId: device.siteId,
      name: device.name,
      type: device.type,
      firmwareVersion: device.firmwareVersion,
      batteryPercent: device.batteryPercent,
      connectivityPercent: device.connectivityPercent,
      status: device.status,
      tags: device.tags,
      lastSeenAt: device.lastSeenAt,
    },
  };
}

export function serializeDeviceTelemetry(
  deviceId: string,
  telemetry: DeviceMetricSnapshot[]
) {
  const recentTelemetry = telemetry.slice(-RECENT_TELEMETRY_LIMIT);

  return {
    ok: true as const,
    deviceId,
    count: telemetry.length,
    latest: telemetry.at(-1) ?? null,
    recentTelemetry,
  };
}

export function serializeIncidentContext(context: IncidentInvestigationContext) {
  return {
    ok: true as const,
    incident: {
      id: context.incident.id,
      siteId: context.incident.siteId,
      title: context.incident.title,
      summary: context.incident.summary,
      severity: context.incident.severity,
      status: context.incident.status,
      category: context.incident.category,
      deviceIds: context.incident.deviceIds,
      createdAt: context.incident.createdAt,
      updatedAt: context.incident.updatedAt,
    },
    recentEvents: context.events.slice(-RECENT_EVENT_LIMIT).map(serializeIncidentEvent),
    affectedDevices: context.devices.map(({ device, telemetry }) => ({
      ...serializeDevice(device).device,
      telemetry: serializeDeviceTelemetry(device.id, telemetry),
    })),
    relatedIncidents: context.relatedIncidents
      .slice(0, RELATED_INCIDENT_LIMIT)
      .map((incident) => ({
        id: incident.id,
        title: incident.title,
        severity: incident.severity,
        status: incident.status,
        category: incident.category,
        updatedAt: incident.updatedAt,
      })),
    runbook: context.runbook
      ? {
          id: context.runbook.id,
          title: context.runbook.title,
          summary: context.runbook.summary,
          steps: context.runbook.steps.slice(0, 5),
        }
      : null,
  };
}

export function serializeIncidentEvent(event: IncidentEvent) {
  return {
    id: event.id,
    incidentId: event.incidentId,
    timestamp: event.timestamp,
    kind: event.kind,
    message: event.message,
  };
}

export function serializeCreatedIncidentEvent(event: IncidentEvent) {
  return {
    ok: true as const,
    event: serializeIncidentEvent(event),
  };
}

export function serializeTicket(ticket: Ticket) {
  return {
    ok: true as const,
    ticket: {
      id: ticket.id,
      incidentId: ticket.incidentId,
      externalRef: ticket.externalRef,
      status: ticket.status,
      assigneeTeam: ticket.assigneeTeam,
      createdAt: ticket.createdAt,
    },
  };
}

export function serializeRemediationAction(action: RemediationAction) {
  return {
    ok: true as const,
    remediationAction: {
      id: action.id,
      incidentId: action.incidentId,
      type: action.type,
      status: action.status,
      risk: action.risk,
      summary: action.summary,
    },
  };
}

export function serializeToolError(errorCode: string, message: string) {
  return {
    ok: false as const,
    errorCode,
    message,
  };
}
