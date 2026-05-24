import { randomUUID } from "node:crypto";
import {
  BedrockAgentCoreClient,
  CompleteResourceTokenAuthCommand,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { fromIni } from "@aws-sdk/credential-providers";
import type {
  AgentRun,
  AgentRunAuthRequired,
  AgentRunInvestigationSummary,
  AgentRuntimeInvocation,
  AuthenticatedAppUser,
  ContentBlock,
  Conversation,
  ConversationDetail,
  CreateConversationRequest,
  CreateConversationRunRequest,
  IncidentInvestigationContext,
  RuntimeSession,
} from "../../../../shared/pulseforge-domain/src/index.js";
import type { AppendRunItemInput } from "../../../../shared/pulseforge-backend/src/index.js";
import {
  appendRunItems,
  createAgentRun,
  createConversation,
  createRuntimeSession,
  getConversation,
  getConversationDetail,
  getRuntimeSessionByProvider,
  touchRuntimeSession,
  updateAgentRunStatus,
  updateConversationActiveRun,
} from "../../../../shared/pulseforge-backend/src/index.js";

const region = process.env.AWS_REGION ?? "us-east-1";
const runtimeProvider = "aws-agentcore";
const isDebugLoggingEnabled =
  process.env.API_LOG_LEVEL === "debug" || process.env.API_LOG_LEVEL === "info";
let client: BedrockAgentCoreClient | null = null;

type AgentRuntimeSseEvent = { event: string; data: unknown };

export interface ParsedRuntimeResponse {
  summary: string;
  investigation?: AgentRunInvestigationSummary;
  authRequired?: AgentRunAuthRequired;
  items: AppendRunItemInput[];
  hasCompletedOutput: boolean;
}

export class ActiveRootRunError extends Error {
  constructor(conversationId: string, runId: string) {
    super(`Conversation ${conversationId} already has active root run ${runId}`);
    this.name = "ActiveRootRunError";
  }
}

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

export async function createConversationAndRun(
  request: CreateConversationRequest,
  user?: AuthenticatedAppUser | null,
  investigationContext?: IncidentInvestigationContext | null
): Promise<ConversationDetail> {
  const conversation = await createConversation({
    id: randomUUID(),
    rootAgentKind: request.agentKind,
  });

  return runRootAgent(conversation, request, user, investigationContext);
}

export async function runConversation(
  conversationId: string,
  request: CreateConversationRunRequest,
  user?: AuthenticatedAppUser | null,
  investigationContext?: IncidentInvestigationContext | null
): Promise<ConversationDetail | null> {
  const conversation = await getConversation(conversationId);
  if (!conversation) {
    return null;
  }

  if (conversation.activeRootRunId) {
    throw new ActiveRootRunError(conversation.id, conversation.activeRootRunId);
  }

  return runRootAgent(
    conversation,
    {
      ...request,
      agentKind: conversation.rootAgentKind,
    },
    user,
    investigationContext
  );
}

async function runRootAgent(
  conversation: Conversation,
  request: CreateConversationRequest,
  user?: AuthenticatedAppUser | null,
  investigationContext?: IncidentInvestigationContext | null
): Promise<ConversationDetail> {
  const runtimeSession = await getOrCreateRuntimeSession(conversation.id);
  const run = await createAgentRun({
    id: randomUUID(),
    conversationId: conversation.id,
    incidentId: request.incidentId,
    deviceId: request.deviceId,
    runtimeSessionId: runtimeSession.id,
    agentKind: conversation.rootAgentKind,
    relationship: "root",
    status: "running",
    requestedByUserId: user?.sub,
  });

  await updateConversationActiveRun(conversation.id, run.id);
  await appendRunItems(run.id, [
    {
      runId: run.id,
      kind: "message",
      role: "user",
      source: { type: "user", userId: user?.sub ?? "anonymous" },
      content: textContent(request.prompt),
    },
  ]);

  try {
    await touchRuntimeSession(runtimeSession.id, "active");
    const result = await invokeRuntime(
      request,
      run,
      runtimeSession,
      user?.sub ?? "pulseforge-webbackend",
      investigationContext
    );

    if (result.items.length > 0) {
      await appendRunItems(run.id, result.items);
    }

    if (result.authRequired && !result.hasCompletedOutput) {
      await updateAgentRunStatus(run.id, {
        status: "auth_required",
        summary: result.summary,
        authRequired: result.authRequired,
      });
    } else {
      await updateAgentRunStatus(run.id, {
        status: "completed",
        summary: result.summary,
        investigation: result.investigation,
      });
    }
    await touchRuntimeSession(runtimeSession.id, "idle");
  } catch (error) {
    const message = formatAgentInvocationError(error);
    console.error("[agent] invocation failed", {
      runId: run.id,
      conversationId: conversation.id,
      runtimeSessionId: runtimeSession.providerSessionId,
      agentKind: request.agentKind,
      incidentId: request.incidentId,
      deviceId: request.deviceId,
      error: message,
    });

    await appendRunItems(run.id, [
      {
        runId: run.id,
        kind: "run_note",
        noteType: "agent_invocation_failed",
        message,
        source: { type: "system" },
      },
    ]);
    await updateAgentRunStatus(run.id, {
      status: "failed",
      summary: "Agent run failed.",
      errorMessage: message,
    });
    await touchRuntimeSession(runtimeSession.id, "idle");
  } finally {
    await updateConversationActiveRun(conversation.id, null);
  }

  const detail = await getConversationDetail(conversation.id);
  if (!detail) {
    throw new Error("Conversation disappeared after agent run.");
  }

  return detail;
}

async function getOrCreateRuntimeSession(
  conversationId: string
): Promise<RuntimeSession> {
  const runtimeIdentity = getRuntimeIdentity();
  const existing = await getRuntimeSessionByProvider(
    conversationId,
    runtimeProvider,
    runtimeIdentity
  );
  if (existing) {
    return existing;
  }

  return createRuntimeSession({
    id: randomUUID(),
    provider: runtimeProvider,
    runtimeIdentity,
    providerSessionId: `conversation-${conversationId}`,
    conversationId,
    status: "active",
  });
}

async function invokeRuntime(
  request: CreateConversationRequest,
  run: AgentRun,
  runtimeSession: RuntimeSession,
  runtimeUserId: string,
  investigationContext?: IncidentInvestigationContext | null
): Promise<ParsedRuntimeResponse> {
  const runtimeArn = process.env.AGENT_RUNTIME_ARN;
  const qualifier = process.env.AGENT_RUNTIME_QUALIFIER;
  if (!runtimeArn) {
    throw new Error("AGENT_RUNTIME_ARN is not configured for the API.");
  }
  if (!qualifier) {
    throw new Error("AGENT_RUNTIME_QUALIFIER is not configured for the API.");
  }

  const invocation = buildInvocationPayload(
    request,
    run.id,
    runtimeUserId,
    investigationContext
  );
  if (isDebugLoggingEnabled) {
    console.info("[agent] invoking aws runtime", {
      runtimeArn,
      qualifier,
      runtimeSessionId: runtimeSession.providerSessionId,
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
      runtimeSessionId: runtimeSession.providerSessionId,
      runtimeUserId,
      payload: new TextEncoder().encode(JSON.stringify(invocation)),
    })
  );

  const events: AgentRuntimeSseEvent[] = [];
  for await (const event of readAgentRuntimeEvents(response.response)) {
    events.push(event);
  }

  return parseAgentRuntimeResponse(events, run);
}

function buildInvocationPayload(
  request: CreateConversationRequest,
  runId: string,
  runtimeUserId: string,
  investigationContext?: IncidentInvestigationContext | null
): AgentRuntimeInvocation {
  return {
    agentRunId: runId,
    agentKind: request.agentKind,
    prompt: request.prompt,
    incidentId: request.incidentId,
    deviceId: request.deviceId,
    actorId: runtimeUserId,
    investigationContext: investigationContext ?? undefined,
  };
}

export function parseAgentRuntimeResponse(
  events: AgentRuntimeSseEvent[],
  run: Pick<AgentRun, "id" | "agentKind">
): ParsedRuntimeResponse {
  const items: AppendRunItemInput[] = [];
  let summary = "Agent run completed.";
  let investigation: AgentRunInvestigationSummary | undefined;
  let authRequired: AgentRunAuthRequired | undefined;

  for (const event of events) {
    const maybeText = asEventText(event.data);
    if (event.event === "message" && maybeText) {
      items.push(agentMessageItem(run, textContent(maybeText)));
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

    if (event.event === "auth_required" && isAuthRequiredData(event.data)) {
      authRequired = {
        ...event.data,
        agentRunId: run.id,
      };
      summary = "Agent run requires delegated tool authorization.";
    }
  }

  const hasCompletedOutput = events.some(
    (event) => event.event === "message" || event.event === "summary"
  );

  if (items.length === 0 && !authRequired) {
    items.push(agentMessageItem(run, textContent(summary)));
  }

  return {
    summary,
    investigation,
    authRequired,
    items,
    hasCompletedOutput,
  };
}

function agentMessageItem(
  run: Pick<AgentRun, "id" | "agentKind">,
  content: ContentBlock[]
): AppendRunItemInput {
  return {
    runId: run.id,
    kind: "message",
    role: "agent",
    source: { type: "agent", agentRunId: run.id, agentKind: run.agentKind },
    content,
  };
}

function textContent(text: string): ContentBlock[] {
  return [{ type: "text", text }];
}

function getRuntimeIdentity() {
  const runtimeArn = process.env.AGENT_RUNTIME_ARN;
  const qualifier = process.env.AGENT_RUNTIME_QUALIFIER;
  return [runtimeArn ?? "unconfigured-runtime", qualifier ?? "unconfigured-qualifier"].join(
    ":"
  );
}

function formatAgentInvocationError(error: unknown) {
  if (error instanceof Error) {
    const parts = [error.message];
    const metadata = (
      error as Error & {
        $metadata?: { httpStatusCode?: number; requestId?: string };
      }
    ).$metadata;
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

function isAuthRequiredData(data: unknown): data is AgentRunAuthRequired {
  return (
    typeof data === "object" &&
    data !== null &&
    "providerName" in data &&
    typeof data.providerName === "string" &&
    "authUrl" in data &&
    typeof data.authUrl === "string" &&
    "scopes" in data &&
    Array.isArray(data.scopes)
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
