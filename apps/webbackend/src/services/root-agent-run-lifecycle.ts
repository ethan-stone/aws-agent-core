import { randomUUID } from "node:crypto";
import type {
  AgentRun,
  Conversation,
  ConversationDetail,
  CreateConversationRequest,
  CreateConversationRunRequest,
  IncidentInvestigationContext,
  RuntimeSession,
  AuthenticatedAppUser,
} from "../../../../shared/pulseforge-domain/src/index.js";
import { agentConversationStorage } from "./agent-conversation-storage.js";
import * as agentRuntime from "./agent-runtime-client.js";
import {
  parseAgentRuntimeResponse,
  type AgentRuntimeSseEvent,
  type ParsedRuntimeResponse,
} from "./runtime-output-projection.js";
import type {
  AppendRunItemInput,
} from "../../../../shared/pulseforge-backend/src/index.js";

export class ActiveRootRunError extends Error {
  constructor(conversationId: string, runId: string) {
    super(`Conversation ${conversationId} already has active root run ${runId}`);
    this.name = "ActiveRootRunError";
  }
}

export async function createConversationAndRun(
  request: CreateConversationRequest,
  user?: AuthenticatedAppUser | null,
  investigationContext?: IncidentInvestigationContext | null
): Promise<ConversationDetail> {
  return collectFinalDetail(
    await createConversationAndRunStream(request, user, investigationContext)
  );
}

export async function createConversationAndRunStream(
  request: CreateConversationRequest,
  user?: AuthenticatedAppUser | null,
  investigationContext?: IncidentInvestigationContext | null
): Promise<AsyncGenerator<ConversationDetail>> {
  const conversation = await agentConversationStorage.conversations.create({
    id: randomUUID(),
    rootAgentKind: request.agentKind,
  });

  return runRootAgentWithProgress(
    conversation,
    request,
    user,
    investigationContext
  );
}

export async function runConversation(
  conversationId: string,
  request: CreateConversationRunRequest,
  user?: AuthenticatedAppUser | null,
  investigationContext?: IncidentInvestigationContext | null
): Promise<ConversationDetail | null> {
  const stream = await runConversationStream(
    conversationId,
    request,
    user,
    investigationContext
  );
  return stream ? collectFinalDetail(stream) : null;
}

export async function runConversationStream(
  conversationId: string,
  request: CreateConversationRunRequest,
  user?: AuthenticatedAppUser | null,
  investigationContext?: IncidentInvestigationContext | null
): Promise<AsyncGenerator<ConversationDetail> | null> {
  const conversation =
    await agentConversationStorage.conversations.get(conversationId);
  if (!conversation) {
    return null;
  }

  if (conversation.activeRootRunId) {
    throw new ActiveRootRunError(conversation.id, conversation.activeRootRunId);
  }

  return runRootAgentWithProgress(
    conversation,
    {
      ...request,
      agentKind: conversation.rootAgentKind,
    },
    user,
    investigationContext
  );
}

async function* runRootAgentWithProgress(
  conversation: Conversation,
  request: CreateConversationRequest,
  user?: AuthenticatedAppUser | null,
  investigationContext?: IncidentInvestigationContext | null
): AsyncGenerator<ConversationDetail> {
  const runtimeSession = await getOrCreateRuntimeSession(conversation.id);
  const run = await startRootAgentRun(
    conversation,
    request,
    runtimeSession,
    user
  );
  const runtimeEvents: AgentRuntimeSseEvent[] = [];
  const liveRequiredActionIds = new Set<string>();

  yield await getRequiredConversationDetail(conversation.id);

  try {
    await agentConversationStorage.runtimeSessions.updateUsage(
      runtimeSession.id,
      "active"
    );
    for await (const event of agentRuntime.streamRootAgentRuntime(
      request,
      run,
      runtimeSession,
      user?.sub ?? "pulseforge-webbackend",
      investigationContext
    )) {
      runtimeEvents.push(event);
      if (await recordLiveRequiredAction(run, event, liveRequiredActionIds)) {
        yield await getRequiredConversationDetail(conversation.id);
      }
    }

    const result = parseAgentRuntimeResponse(runtimeEvents, run);
    await recordCompletedRootAgentRun(
      run,
      withoutLiveRequiredActions(result, liveRequiredActionIds)
    );
    await agentConversationStorage.runtimeSessions.updateUsage(
      runtimeSession.id,
      "idle"
    );
  } catch (error) {
    await recordFailedRootAgentRun(run, request, runtimeSession, error);
    await agentConversationStorage.runtimeSessions.updateUsage(
      runtimeSession.id,
      "idle"
    );
  } finally {
    await agentConversationStorage.conversations.setActiveRootRun(
      conversation.id,
      null
    );
  }

  yield await getRequiredConversationDetail(conversation.id);
}

async function getOrCreateRuntimeSession(
  conversationId: string
): Promise<RuntimeSession> {
  const runtimeIdentity = agentRuntime.getRuntimeIdentity();
  const existing = await agentConversationStorage.runtimeSessions.getByProvider(
    conversationId,
    agentRuntime.runtimeProvider,
    runtimeIdentity
  );
  if (existing) {
    return existing;
  }

  return agentConversationStorage.runtimeSessions.create({
    id: randomUUID(),
    provider: agentRuntime.runtimeProvider,
    runtimeIdentity,
    providerSessionId: `conversation-${conversationId}`,
    conversationId,
    status: "active",
  });
}

async function startRootAgentRun(
  conversation: Conversation,
  request: CreateConversationRequest,
  runtimeSession: RuntimeSession,
  user?: AuthenticatedAppUser | null
): Promise<AgentRun> {
  const runId = randomUUID();
  const claimed = await agentConversationStorage.conversations.claimActiveRootRun(
    conversation.id,
    runId
  );
  if (!claimed) {
    const latest =
      await agentConversationStorage.conversations.get(conversation.id);
    throw new ActiveRootRunError(
      conversation.id,
      latest?.activeRootRunId ?? "unknown"
    );
  }

  try {
    const run = await agentConversationStorage.agentRuns.create({
      id: runId,
      conversationId: conversation.id,
      incidentId: request.incidentId,
      deviceId: request.deviceId,
      runtimeSessionId: runtimeSession.id,
      agentKind: conversation.rootAgentKind,
      relationship: "root",
      status: "running",
      requestedByUserId: user?.sub,
    });

    await agentConversationStorage.runItems.append(run.id, [
      {
        runId: run.id,
        kind: "message",
        role: "user",
        source: { type: "user", userId: user?.sub ?? "anonymous" },
        content: [{ type: "text", text: request.prompt }],
      },
    ]);

    return run;
  } catch (error) {
    await agentConversationStorage.conversations.setActiveRootRun(
      conversation.id,
      null
    );
    throw error;
  }
}

async function recordCompletedRootAgentRun(
  run: AgentRun,
  result: ParsedRuntimeResponse
) {
  if (result.items.length > 0) {
    await agentConversationStorage.runItems.append(run.id, result.items);
  }

  if (result.authRequired && !result.hasCompletedOutput) {
    await agentConversationStorage.agentRuns.updateStatus(run.id, {
      status: "auth_required",
      summary: result.summary,
      authRequired: result.authRequired,
    });
    return;
  }

  await agentConversationStorage.agentRuns.updateStatus(run.id, {
    status: "completed",
    summary: result.summary,
    investigation: result.investigation,
  });
}

async function recordLiveRequiredAction(
  run: AgentRun,
  event: AgentRuntimeSseEvent,
  liveRequiredActionIds: Set<string>
): Promise<boolean> {
  if (event.event !== "auth_required" && event.event !== "required_action") {
    return false;
  }

  const result = parseAgentRuntimeResponse([event], run);
  const requiredActions = result.items.filter(
    (
      item
    ): item is Extract<AppendRunItemInput, { kind: "required_action" }> =>
      item.kind === "required_action" &&
      !liveRequiredActionIds.has(item.requiredActionId)
  );
  if (requiredActions.length === 0) {
    return false;
  }

  await agentConversationStorage.runItems.append(run.id, requiredActions);
  for (const item of requiredActions) {
    liveRequiredActionIds.add(item.requiredActionId);
  }

  await agentConversationStorage.agentRuns.updateStatus(run.id, {
    status: result.authRequired ? "auth_required" : "waiting_for_action",
    summary: result.summary,
    authRequired: result.authRequired,
  });

  return true;
}

function withoutLiveRequiredActions(
  result: ParsedRuntimeResponse,
  liveRequiredActionIds: Set<string>
): ParsedRuntimeResponse {
  if (liveRequiredActionIds.size === 0) {
    return result;
  }

  return {
    ...result,
    items: result.items.filter(
      (item) =>
        item.kind !== "required_action" ||
        !liveRequiredActionIds.has(item.requiredActionId)
    ),
  };
}

async function collectFinalDetail(
  stream: AsyncGenerator<ConversationDetail>
): Promise<ConversationDetail> {
  let finalDetail: ConversationDetail | null = null;
  for await (const detail of stream) {
    finalDetail = detail;
  }
  if (!finalDetail) {
    throw new Error("Agent run did not produce a conversation detail.");
  }
  return finalDetail;
}

async function getRequiredConversationDetail(
  conversationId: string
): Promise<ConversationDetail> {
  const detail =
    await agentConversationStorage.conversations.getDetail(conversationId);
  if (!detail) {
    throw new Error("Conversation disappeared after agent run.");
  }
  return detail;
}

async function recordFailedRootAgentRun(
  run: AgentRun,
  request: CreateConversationRequest,
  runtimeSession: RuntimeSession,
  error: unknown
) {
  const message = formatAgentInvocationError(error);
  console.error("[agent] invocation failed", {
    runId: run.id,
    conversationId: run.conversationId,
    runtimeSessionId: runtimeSession.providerSessionId,
    agentKind: request.agentKind,
    incidentId: request.incidentId,
    deviceId: request.deviceId,
    error: message,
  });

  await agentConversationStorage.runItems.append(run.id, [
    {
      runId: run.id,
      kind: "run_note",
      noteType: "agent_invocation_failed",
      message,
      source: { type: "system" },
    },
  ]);
  await agentConversationStorage.agentRuns.updateStatus(run.id, {
    status: "failed",
    summary: "Agent run failed.",
    errorMessage: message,
  });
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
