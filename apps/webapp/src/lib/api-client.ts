import {
  demoDashboard,
  demoDevices,
  demoIncidents,
  demoSnapshot,
  type DashboardSummary,
  type Device,
  type DeviceMetricSnapshot,
  type Incident,
  type IncidentEvent,
} from "../../../../shared/pulseforge-domain/src/index.js";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${path}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export async function fetchDashboard(): Promise<DashboardSummary> {
  return getJson("/api/dashboard", demoDashboard);
}

export async function fetchDevices(): Promise<Device[]> {
  const response = await getJson<{ items: Device[] }>("/api/devices", {
    items: demoDevices,
  });
  return response.items;
}

export async function fetchDevice(deviceId: string): Promise<Device | null> {
  return getJson(
    `/api/devices/${deviceId}`,
    demoDevices.find((device) => device.id === deviceId) ?? null
  );
}

export async function fetchDeviceTelemetry(
  deviceId: string
): Promise<DeviceMetricSnapshot[]> {
  const response = await getJson<{ items: DeviceMetricSnapshot[] }>(
    `/api/devices/${deviceId}/telemetry`,
    {
      items: demoSnapshot.deviceMetrics[deviceId] ?? [],
    }
  );
  return response.items;
}

export async function fetchIncidents(): Promise<Incident[]> {
  const response = await getJson<{ items: Incident[] }>("/api/incidents", {
    items: demoIncidents,
  });
  return response.items;
}

export async function fetchIncident(incidentId: string): Promise<{
  incident: Incident;
  events: IncidentEvent[];
} | null> {
  return getJson(
    `/api/incidents/${incidentId}`,
    (() => {
      const incident = demoIncidents.find((item) => item.id === incidentId);
      if (!incident) {
        return null;
      }

      return {
        incident,
        events: demoSnapshot.incidentEvents.filter(
          (event) => event.incidentId === incidentId
        ),
      };
    })()
  );
}
