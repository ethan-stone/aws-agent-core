import {
  type ApiAuthConfig,
  type AgentRun,
  type CreateAgentRunRequest,
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
import { getStoredAccessToken } from "./auth-storage.js";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

function withAuthHeaders(headers?: HeadersInit) {
  const token = getStoredAccessToken();
  return {
    ...(headers ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function getJson<T>(path: string, fallback: T): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: withAuthHeaders(),
    });
  } catch {
    return fallback;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

async function requestJson<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...withAuthHeaders(init?.headers),
    },
    ...init,
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;

    try {
      const body = (await response.json()) as {
        error?: string;
        errorMessage?: string;
      };
      if (body.errorMessage) {
        message = body.errorMessage;
      } else if (body.error) {
        message = body.error;
      }
    } catch {
      // Ignore JSON parsing failures and fall back to status text.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function fetchDashboard(): Promise<DashboardSummary> {
  return getJson("/api/dashboard", demoDashboard);
}

export async function fetchAuthConfig(): Promise<ApiAuthConfig> {
  return requestJson("/api/auth/config");
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

export async function createAgentRun(
  request: CreateAgentRunRequest
): Promise<AgentRun> {
  return requestJson("/api/agent-runs", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function fetchAgentRun(runId: string): Promise<AgentRun> {
  return requestJson(`/api/agent-runs/${runId}`);
}
