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
import type { ParsedRuntimeResponse } from "./runtime-output-projection.js";

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
  const conversation = await agentConversationStorage.conversations.create({
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
  const conversation =
    await agentConversationStorage.conversations.get(conversationId);
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
  const run = await startRootAgentRun(
    conversation,
    request,
    runtimeSession,
    user
  );

  try {
    await agentConversationStorage.runtimeSessions.updateUsage(
      runtimeSession.id,
      "active"
    );
    const result = await agentRuntime.invokeRootAgentRuntime(
      request,
      run,
      runtimeSession,
      user?.sub ?? "pulseforge-webbackend",
      investigationContext
    );

    await recordCompletedRootAgentRun(run, result);
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

  const detail =
    await agentConversationStorage.conversations.getDetail(conversation.id);
  if (!detail) {
    throw new Error("Conversation disappeared after agent run.");
  }

  return detail;
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
  const run = await agentConversationStorage.agentRuns.create({
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

  await agentConversationStorage.conversations.setActiveRootRun(
    conversation.id,
    run.id
  );
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
