import {
  type ApiAuthConfig,
  type ConversationDetail,
  type ConversationSummary,
  type CreateConversationRequest,
  type CreateConversationRunRequest,
  demoDashboard,
  demoDevices,
  demoIncidents,
  demoSnapshot,
  type DashboardSummary,
  type Device,
  type DeviceMetricSnapshot,
  type Incident,
  type IncidentActionApproval,
  type IncidentActivity,
  type IncidentAgentMention,
  type IncidentComment,
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

async function requestConversationDetail(
  path: string,
  init: RequestInit,
  onUpdate?: (detail: ConversationDetail) => void
): Promise<ConversationDetail> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      ...withAuthHeaders(init.headers),
    },
  });

  if (!response.ok) {
    await throwResponseError(response);
  }

  if (!response.body) {
    return (await response.json()) as ConversationDetail;
  }

  let latestDetail: ConversationDetail | null = null;
  for await (const event of readSseEvents(response.body)) {
    if (event.event === "conversation") {
      latestDetail = event.data as ConversationDetail;
      onUpdate?.(latestDetail);
    }

    if (event.event === "error") {
      const data = event.data as { error?: string };
      throw new Error(data.error ?? "Agent run failed.");
    }
  }

  if (!latestDetail) {
    throw new Error("Agent run did not return a conversation.");
  }

  return latestDetail;
}

async function throwResponseError(response: Response): Promise<never> {
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

async function* readSseEvents(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const parsed = consumeSseBuffer(buffer);
      buffer = parsed.remaining;
      yield* parsed.events;
    }

    buffer += decoder.decode();
    yield* consumeSseBuffer(buffer, true).events;
  } finally {
    reader.releaseLock();
  }
}

function consumeSseBuffer(buffer: string, flush = false) {
  const events: Array<{ event: string; data: unknown }> = [];
  let remaining = buffer;
  let separatorIndex = remaining.indexOf("\n\n");

  while (separatorIndex >= 0) {
    const chunk = remaining.slice(0, separatorIndex);
    remaining = remaining.slice(separatorIndex + 2);
    const event = parseSseChunk(chunk);
    if (event) {
      events.push(event);
    }
    separatorIndex = remaining.indexOf("\n\n");
  }

  if (flush) {
    const event = parseSseChunk(remaining);
    if (event) {
      events.push(event);
    }
    remaining = "";
  }

  return { events, remaining };
}

function parseSseChunk(chunk: string): { event: string; data: unknown } | null {
  const trimmed = chunk.trim();
  if (!trimmed) {
    return null;
  }

  let event = "message";
  const dataLines: string[] = [];

  for (const line of trimmed.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  const dataText = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(dataText) };
  } catch {
    return { event, data: { text: dataText } };
  }
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
  activities: IncidentActivity[];
  comments: IncidentComment[];
  agentMentions: IncidentAgentMention[];
  actionApprovals: IncidentActionApproval[];
} | null> {
  const fallback = (() => {
    const incident = demoIncidents.find((item) => item.id === incidentId);
    if (!incident) {
      return null;
    }

    return {
      incident,
      activities: demoSnapshot.incidentActivities.filter(
        (activity) => activity.incidentId === incidentId
      ),
      comments: demoSnapshot.incidentComments.filter(
        (comment) => comment.incidentId === incidentId
      ),
      agentMentions: demoSnapshot.incidentAgentMentions.filter(
        (mention) => mention.incidentId === incidentId
      ),
      actionApprovals: demoSnapshot.incidentActionApprovals.filter(
        (approval) => approval.incidentId === incidentId
      ),
    };
  })();

  const response = await getJson<
    | {
        incident: Incident;
        activities?: IncidentActivity[];
        events?: IncidentActivity[];
        comments?: IncidentComment[];
        agentMentions?: IncidentAgentMention[];
        actionApprovals?: IncidentActionApproval[];
      }
    | null
  >(
    `/api/incidents/${incidentId}`,
    fallback
  );
  if (!response) {
    return null;
  }

  return {
    incident: response.incident,
    activities: response.activities ?? response.events ?? [],
    comments: response.comments ?? [],
    agentMentions: response.agentMentions ?? [],
    actionApprovals: response.actionApprovals ?? [],
  };
}

export async function postIncidentComment(
  incidentId: string,
  body: string
): Promise<{
  incident: Incident;
  activities: IncidentActivity[];
  comments: IncidentComment[];
  agentMentions: IncidentAgentMention[];
  actionApprovals: IncidentActionApproval[];
}> {
  return requestJson(`/api/incidents/${incidentId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function createConversation(
  request: CreateConversationRequest,
  onUpdate?: (detail: ConversationDetail) => void
): Promise<ConversationDetail> {
  return requestConversationDetail(
    "/api/conversations",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
    onUpdate
  );
}

export async function fetchConversations(): Promise<ConversationSummary[]> {
  const response = await getJson<{ items: ConversationSummary[] }>(
    "/api/conversations",
    {
      items: demoSnapshot.conversations
        .filter(
          (conversation) =>
            conversation.rootAgentKind === "ops-copilot" &&
            conversation.interactionMode !== "observe_only"
        )
        .map((conversation) => {
          const runs = demoSnapshot.agentRuns.filter(
            (run) => run.conversationId === conversation.id
          );
          const latestRun = runs.at(-1);
          return {
            conversation,
            latestRun,
            title: conversation.incidentId ?? "Untitled conversation",
            preview: latestRun?.summary,
            itemCount: runs.reduce(
              (count, run) =>
                count +
                demoSnapshot.runItems.filter((item) => item.runId === run.id)
                  .length,
              0
            ),
            updatedAt:
              latestRun?.completedAt ?? latestRun?.startedAt ?? conversation.updatedAt,
          };
        }),
    }
  );
  return response.items;
}

export async function completeResourceTokenAuth(
  sessionUri: string
): Promise<void> {
  await requestJson<{ ok: true }>("/api/oauth2/complete-resource-token-auth", {
    method: "POST",
    body: JSON.stringify({ sessionUri }),
  });
}

export async function createConversationRun(
  conversationId: string,
  request: CreateConversationRunRequest,
  onUpdate?: (detail: ConversationDetail) => void
): Promise<ConversationDetail> {
  return requestConversationDetail(
    `/api/conversations/${conversationId}/runs`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
    onUpdate
  );
}

export async function resolveRequiredAction(
  runId: string,
  requiredActionId: string,
  request: {
    outcome: "resolved" | "declined";
    decision?: "allow_once" | "allow_always" | "decline";
    comment?: string;
  }
): Promise<ConversationDetail> {
  return requestJson(
    `/api/agent-runs/${runId}/required-actions/${requiredActionId}/resolve`,
    {
      method: "POST",
      body: JSON.stringify(request),
    }
  );
}

export async function fetchConversation(
  conversationId: string
): Promise<ConversationDetail> {
  const fallback = demoConversationDetail(conversationId);
  if (!fallback) {
    return requestJson(`/api/conversations/${conversationId}`);
  }

  return getJson(`/api/conversations/${conversationId}`, fallback);
}

function demoConversationDetail(
  conversationId: string
): ConversationDetail | null {
  const conversation =
    demoSnapshot.conversations.find((item) => item.id === conversationId) ??
    null;
  if (!conversation) {
    return null;
  }

  const runs = demoSnapshot.agentRuns.filter(
    (run) => run.conversationId === conversationId
  );
  return {
    conversation,
    runs,
    itemsByRunId: Object.fromEntries(
      runs.map((run) => [
        run.id,
        demoSnapshot.runItems
          .filter((item) => item.runId === run.id)
          .sort((left, right) => left.sequence - right.sequence),
      ])
    ),
    runtimeSessions: demoSnapshot.runtimeSessions.filter(
      (session) => session.conversationId === conversationId
    ),
  };
}
