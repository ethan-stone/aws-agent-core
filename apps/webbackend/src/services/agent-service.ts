import { randomUUID } from "node:crypto";
import {
  BedrockAgentCoreClient,
  CompleteResourceTokenAuthCommand,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { fromIni } from "@aws-sdk/credential-providers";
import type {
  AgentRun,
  AgentRunMessage,
  AgentRunResult,
  AgentRunStreamEvent,
  AgentRuntimeInvocation,
  AuthenticatedAppUser,
  CreateAgentRunRequest,
} from "../../../../shared/pulseforge-domain/src/index.js";
import {
  completeAgentRun,
  createAgentRun,
  failAgentRun,
  requireAgentRunAuth,
} from "../../../../shared/pulseforge-backend/src/index.js";

const region = process.env.AWS_REGION ?? "us-east-1";
const isDebugLoggingEnabled =
  process.env.API_LOG_LEVEL === "debug" || process.env.API_LOG_LEVEL === "info";
let client: BedrockAgentCoreClient | null = null;

type AgentRuntimeSseEvent = { event: string; data: unknown };

function getClient(): BedrockAgentCoreClient {
  if (!client) {
    client = new BedrockAgentCoreClient({
      region,
      ...(process.env.AWS_PROFILE
        ? { credentials: fromIni({ profile: process.env.AWS_PROFILE }) }
        : {}),
    });
  }

  return client;
}

export async function runAgent(
  request: CreateAgentRunRequest,
  user?: AuthenticatedAppUser | null
): Promise<AgentRun> {
  let latestRun: AgentRun | null = null;

  for await (const event of runAgentStream(request, user)) {
    if (event.event === "run") {
      latestRun = event.data;
    }
  }

  if (!latestRun) {
    throw new Error("Agent run did not produce a persisted run.");
  }

  return latestRun;
}

export async function completeAgentResourceTokenAuth(
  sessionUri: string,
  user: AuthenticatedAppUser
) {
  if (isDebugLoggingEnabled) {
    console.info("[agent] completing resource token auth", {
      sessionUri,
      userId: user.sub,
      clientId: user.clientId,
    });
  }

  await getClient().send(
    new CompleteResourceTokenAuthCommand({
      sessionUri,
      userIdentifier: {
        userId: user.sub,
      },
    })
  );
}

export async function* runAgentStream(
  request: CreateAgentRunRequest,
  user?: AuthenticatedAppUser | null
): AsyncGenerator<AgentRunStreamEvent> {
  const runId = randomUUID();
  const sessionId = request.sessionId ?? `agent-run-${runId}`;
  const runtimeUserId = user?.sub ?? "pulseforge-webbackend";

  const queued = await createAgentRun({
    ...request,
    id: runId,
    sessionId,
    requestedByUserId: user?.sub,
  });

  yield { event: "run", data: queued };

  try {
    const events: AgentRuntimeSseEvent[] = [];
    for await (const event of invokeRuntimeStream(
      request,
      runId,
      sessionId,
      runtimeUserId
    )) {
      events.push(event);

      const streamEvent = toAgentRunStreamEvent(event);
      if (streamEvent) {
        yield streamEvent;
      }
    }

    const result = buildAgentRunResult(events);
    if (result.authRequired && !hasCompletedAgentOutput(events)) {
      const authRequired = await requireAgentRunAuth(runId, result.authRequired);
      yield { event: "run", data: authRequired ?? queued };
      return;
    }

    const completed = await completeAgentRun(runId, result);
    yield { event: "run", data: completed ?? queued };
  } catch (error) {
    const message = formatAgentInvocationError(error);
    console.error("[agent] invocation failed", {
      runId,
      sessionId,
      agentKind: request.agentKind,
      incidentId: request.incidentId,
      deviceId: request.deviceId,
      runtimeUserId,
      error: message,
    });
    const failed = await failAgentRun(runId, message);
    yield { event: "error", data: { message } };
    yield { event: "run", data: failed ?? queued };
  }
}

async function* invokeRuntimeStream(
  request: CreateAgentRunRequest,
  runId: string,
  sessionId: string,
  runtimeUserId: string
): AsyncGenerator<AgentRuntimeSseEvent> {
  const runtimeArn = process.env.AGENT_RUNTIME_ARN;
  const qualifier = process.env.AGENT_RUNTIME_QUALIFIER;
  if (!runtimeArn) {
    throw new Error("AGENT_RUNTIME_ARN is not configured for the API.");
  }
  if (!qualifier) {
    throw new Error("AGENT_RUNTIME_QUALIFIER is not configured for the API.");
  }

  const invocation = buildInvocationPayload(request, runId, runtimeUserId);
  if (isDebugLoggingEnabled) {
    console.info("[agent] invoking aws runtime", {
      runtimeArn,
      qualifier,
      sessionId,
      runtimeUserId,
      agentKind: request.agentKind,
      incidentId: request.incidentId,
      deviceId: request.deviceId,
    });
  }

  const response = await getClient().send(
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn: runtimeArn,
      qualifier,
      contentType: "application/json",
      accept: "text/event-stream",
      runtimeSessionId: sessionId,
      runtimeUserId,
      payload: new TextEncoder().encode(
        JSON.stringify(invocation)
      ),
    })
  );

  if (isDebugLoggingEnabled) {
    console.info("[agent] runtime stream opened", {
      sessionId,
    });
  }

  yield* readAgentRuntimeEvents(response.response);
}

function formatAgentInvocationError(error: unknown) {
  if (error instanceof Error) {
    const parts = [error.message];
    const metadata = (error as Error & { $metadata?: { httpStatusCode?: number; requestId?: string } }).$metadata;
    const name = (error as Error & { name?: string }).name;

    if (name && name !== "Error") {
      parts.unshift(name);
    }

    if (metadata?.httpStatusCode) {
      parts.push(`status=${metadata.httpStatusCode}`);
    }

    if (metadata?.requestId) {
      parts.push(`requestId=${metadata.requestId}`);
    }

    return parts.join(" | ");
  }

  return "Unknown error";
}

function buildInvocationPayload(
  request: CreateAgentRunRequest,
  runId: string,
  runtimeUserId: string
): AgentRuntimeInvocation {
  return {
    agentRunId: runId,
    agentKind: request.agentKind,
    prompt: request.prompt,
    incidentId: request.incidentId,
    deviceId: request.deviceId,
    actorId: runtimeUserId,
  };
}

function buildAgentRunResult(events: AgentRuntimeSseEvent[]): AgentRunResult {
  const messages: AgentRunMessage[] = [];
  let summary = "Agent run completed.";
  let investigation: AgentRunResult["investigation"];
  let authRequired: AgentRunResult["authRequired"];

  for (const event of events) {
    const maybeText = asEventText(event.data);
    if (event.event === "message" && maybeText) {
      messages.push({ role: "assistant", content: maybeText });
      authRequired = undefined;
    }

    if (event.event === "summary" && event.data) {
      const data = event.data as {
        summary?: string;
        title?: string;
        findings?: string[];
        recommendedActions?: string[];
      };
      if (data.summary) {
        summary = data.summary;
      }
      investigation = {
        title: data.title ?? "Investigation summary",
        summary: data.summary ?? summary,
        findings: data.findings ?? [],
        recommendedActions: data.recommendedActions ?? [],
      };
      authRequired = undefined;
    }

    if (event.event === "auth_required" && event.data) {
      const data = event.data as AgentRunResult["authRequired"];
      if (
        data &&
        typeof data.providerName === "string" &&
        typeof data.authUrl === "string" &&
        Array.isArray(data.scopes) &&
        typeof data.agentRunId === "string"
      ) {
        authRequired = data;
        summary = "Agent run requires delegated tool authorization.";
      }
    }
  }

  if (messages.length === 0) {
    messages.push({ role: "assistant", content: summary });
  }

  return {
    summary,
    messages,
    investigation,
    authRequired,
  };
}

function hasCompletedAgentOutput(events: AgentRuntimeSseEvent[]): boolean {
  return events.some(
    (event) => event.event === "message" || event.event === "summary"
  );
}

function toAgentRunStreamEvent(
  event: AgentRuntimeSseEvent
): AgentRunStreamEvent | null {
  const maybeText = asEventText(event.data);
  if (event.event === "message" && maybeText) {
    return { event: "message", data: { text: maybeText } };
  }

  if (event.event === "summary" && isSummaryData(event.data)) {
    return { event: "summary", data: event.data };
  }

  if (event.event === "auth_required" && isAuthRequiredData(event.data)) {
    return { event: "auth_required", data: event.data };
  }

  return null;
}

function asEventText(data: unknown): string | null {
  if (
    typeof data === "object" &&
    data !== null &&
    "text" in data &&
    typeof data.text === "string"
  ) {
    return data.text;
  }

  return null;
}

function isSummaryData(data: unknown): data is Extract<
  AgentRunStreamEvent,
  { event: "summary" }
>["data"] {
  return typeof data === "object" && data !== null;
}

function isAuthRequiredData(
  data: unknown
): data is NonNullable<AgentRunResult["authRequired"]> {
  return (
    typeof data === "object" &&
    data !== null &&
    "providerName" in data &&
    typeof data.providerName === "string" &&
    "authUrl" in data &&
    typeof data.authUrl === "string" &&
    "scopes" in data &&
    Array.isArray(data.scopes) &&
    "agentRunId" in data &&
    typeof data.agentRunId === "string"
  );
}

async function* readAgentRuntimeEvents(
  body: unknown
): AsyncGenerator<AgentRuntimeSseEvent> {
  if (!body) {
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const emitChunk = function* (text: string, flush = false) {
    buffer += text;
    buffer = buffer.replace(/\r\n/g, "\n");
    const parsed = consumeSseBuffer(buffer, flush);
    buffer = parsed.remaining;
    yield* parsed.events;
  };

  if (hasTransformToWebStream(body)) {
    const reader = body.transformToWebStream().getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        yield* emitChunk(decoder.decode(value, { stream: true }));
      }
      yield* emitChunk(decoder.decode(), true);
    } finally {
      reader.releaseLock();
    }
    return;
  }

  if (isAsyncIterableBody(body)) {
    for await (const chunk of body) {
      yield* emitChunk(
        typeof chunk === "string"
          ? chunk
          : decoder.decode(chunk, { stream: true })
      );
    }
    yield* emitChunk(decoder.decode(), true);
    return;
  }

  if (hasTransformToString(body)) {
    yield* parseSse(await body.transformToString());
  }
}

function hasTransformToWebStream(
  body: unknown
): body is { transformToWebStream: () => ReadableStream<Uint8Array> } {
  return (
    typeof body === "object" &&
    body !== null &&
    "transformToWebStream" in body &&
    typeof body.transformToWebStream === "function"
  );
}

function hasTransformToString(
  body: unknown
): body is { transformToString: () => Promise<string> } {
  return (
    typeof body === "object" &&
    body !== null &&
    "transformToString" in body &&
    typeof body.transformToString === "function"
  );
}

function isAsyncIterableBody(
  body: unknown
): body is AsyncIterable<Uint8Array | string> {
  return (
    typeof body === "object" &&
    body !== null &&
    Symbol.asyncIterator in body
  );
}

function consumeSseBuffer(buffer: string, flush = false) {
  const events: AgentRuntimeSseEvent[] = [];
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

function parseSse(rawText: string): AgentRuntimeSseEvent[] {
  const chunks = rawText.split(/\n\n+/).map((chunk) => chunk.trim()).filter(Boolean);

  return chunks
    .map(parseSseChunk)
    .filter((event): event is AgentRuntimeSseEvent => Boolean(event));
}

function parseSseChunk(chunk: string): AgentRuntimeSseEvent | null {
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
