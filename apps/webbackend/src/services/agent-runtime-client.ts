import {
  BedrockAgentCoreClient,
  CompleteResourceTokenAuthCommand,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { fromIni } from "@aws-sdk/credential-providers";
import type {
  AgentRun,
  AgentRuntimeInvocation,
  AgentRuntimeInterruptResume,
  AgentRuntimeInvocationActor,
  AuthenticatedAppUser,
  CreateConversationRequest,
  OperatorPromptTrigger,
  RuntimeSession,
} from "../../../../shared/pulseforge-domain/src/index.js";
import {
  parseAgentRuntimeResponse,
  type AgentRuntimeSseEvent,
  type ParsedRuntimeResponse,
} from "./runtime-output-projection.js";
import {
  type WebBackendDiagnosticContext,
  extendDiagnostics,
  webBackendDiagnostics,
} from "./webbackend-diagnostics.js";

const region = process.env.AWS_REGION ?? "us-east-1";
export const runtimeProvider = "aws-agentcore";
const isDebugLoggingEnabled =
  process.env.API_LOG_LEVEL === "debug" || process.env.API_LOG_LEVEL === "info";
let client: BedrockAgentCoreClient | null = null;

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

export async function completeAgentResourceTokenAuth(
  sessionUri: string,
  user: AuthenticatedAppUser,
  diagnostics?: WebBackendDiagnosticContext
) {
  if (isDebugLoggingEnabled) {
    webBackendDiagnostics.resourceTokenAuthCompleted(diagnostics, {
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

export async function invokeRootAgentRuntime(
  request: CreateConversationRequest,
  run: AgentRun,
  runtimeSession: RuntimeSession,
  runtimeUserId: string,
  diagnostics?: WebBackendDiagnosticContext
): Promise<ParsedRuntimeResponse> {
  const events: AgentRuntimeSseEvent[] = [];
  for await (const event of streamRootAgentRuntime(
    request,
    run,
    runtimeSession,
    runtimeUserId,
    diagnostics
  )) {
    events.push(event);
  }

  return parseAgentRuntimeResponse(events, run);
}

export async function* streamRootAgentRuntime(
  request: CreateConversationRequest,
  run: AgentRun,
  runtimeSession: RuntimeSession,
  runtimeUserId: string,
  diagnostics?: WebBackendDiagnosticContext
): AsyncGenerator<AgentRuntimeSseEvent> {
  yield* streamAgentRuntimeInvocation(
    buildInvocationPayload(request, run, runtimeSession, runtimeUserId),
    run,
    runtimeSession,
    runtimeUserId,
    diagnostics
  );
}

export async function* streamRootAgentRuntimeResume(
  run: AgentRun,
  runtimeSession: RuntimeSession,
  runtimeUserId: string,
  resume: AgentRuntimeInterruptResume,
  diagnostics?: WebBackendDiagnosticContext
): AsyncGenerator<AgentRuntimeSseEvent> {
  yield* streamAgentRuntimeInvocation(
    {
      conversationId: run.conversationId,
      agentRunId: run.id,
      runtimeSessionId: runtimeSession.id,
      providerSessionId: runtimeSession.providerSessionId,
      version: "2026-05-28",
      operation: "resume_required_action",
      actor: invocationActorFromRuntimeUser(runtimeUserId),
      ...resume,
    },
    run,
    runtimeSession,
    runtimeUserId,
    diagnostics
  );
}

async function* streamAgentRuntimeInvocation(
  invocation: AgentRuntimeInvocation,
  run: AgentRun,
  runtimeSession: RuntimeSession,
  runtimeUserId: string,
  diagnostics?: WebBackendDiagnosticContext
): AsyncGenerator<AgentRuntimeSseEvent> {
  const runtimeArn = process.env.AGENT_RUNTIME_ARN;
  const qualifier = process.env.AGENT_RUNTIME_QUALIFIER;
  if (!runtimeArn) {
    throw new Error("AGENT_RUNTIME_ARN is not configured for the API.");
  }
  if (!qualifier) {
    throw new Error("AGENT_RUNTIME_QUALIFIER is not configured for the API.");
  }

  if (isDebugLoggingEnabled) {
    webBackendDiagnostics.runtimeInvocationStarted(
      extendDiagnostics(diagnostics, {
        runId: run.id,
        conversationId: run.conversationId,
        agentKind: run.agentKind,
        runtimeSessionId: runtimeSession.id,
        providerSessionId: runtimeSession.providerSessionId,
        incidentId: run.incidentId,
        deviceId: run.deviceId,
      }),
      {
        runtimeArn,
        qualifier,
        runtimeUserId,
      }
    );
  }

  const response = await getClient().send(
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn: runtimeArn,
      qualifier,
      contentType: "application/json",
      accept: "text/event-stream",
      runtimeSessionId: runtimeSession.providerSessionId,
      runtimeUserId,
      payload: new TextEncoder().encode(JSON.stringify(invocation)),
    })
  );

  let eventIndex = 0;
  for await (const event of readAgentRuntimeEvents(response.response)) {
    eventIndex += 1;
    webBackendDiagnostics.runtimeEventReceived(
      extendDiagnostics(diagnostics, {
        runId: run.id,
        conversationId: run.conversationId,
        agentKind: run.agentKind,
        runtimeSessionId: runtimeSession.id,
        providerSessionId: runtimeSession.providerSessionId,
      }),
      {
        event: event.event,
        index: eventIndex,
      }
    );
    yield event;
  }
}

export function getRuntimeIdentity() {
  const runtimeArn = process.env.AGENT_RUNTIME_ARN;
  const qualifier = process.env.AGENT_RUNTIME_QUALIFIER;
  return [
    runtimeArn ?? "unconfigured-runtime",
    qualifier ?? "unconfigured-qualifier",
  ].join(":");
}

function buildInvocationPayload(
  request: CreateConversationRequest,
  run: AgentRun,
  runtimeSession: RuntimeSession,
  runtimeUserId: string
): AgentRuntimeInvocation {
  return {
    version: "2026-05-28",
    operation: "start_agent_run",
    conversationId: run.conversationId,
    agentRunId: run.id,
    runtimeSessionId: runtimeSession.id,
    providerSessionId: runtimeSession.providerSessionId,
    agentKind: request.agentKind,
    actor: invocationActorFromRuntimeUser(runtimeUserId),
    trigger: {
      type: "operator_prompt",
      prompt: request.prompt,
      ...optionalDomainIds(request),
    },
  };
}

function optionalDomainIds(source: {
  incidentId?: string | null;
  deviceId?: string | null;
}): Pick<OperatorPromptTrigger, "incidentId" | "deviceId"> {
  return {
    ...(typeof source.incidentId === "string"
      ? { incidentId: source.incidentId }
      : {}),
    ...(typeof source.deviceId === "string"
      ? { deviceId: source.deviceId }
      : {}),
  };
}

function invocationActorFromRuntimeUser(
  runtimeUserId: string
): AgentRuntimeInvocationActor {
  return runtimeUserId === "pulseforge-webbackend"
    ? { type: "system", systemId: runtimeUserId }
    : { type: "user", userId: runtimeUserId };
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
  const chunks = rawText
    .split(/\n\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

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
