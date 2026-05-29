import { randomUUID } from "node:crypto";
import type {
  AgentRun,
  AgentRuntimeInterruptResume,
  Conversation,
  ConversationDetail,
  CreateConversationRequest,
  CreateConversationRunRequest,
  RuntimeSession,
  AuthenticatedAppUser,
  RunItem,
} from "../../../../shared/pulseforge-domain/src/index.js";
import { agentConversationStorage } from "./agent-conversation-storage.js";
import * as agentRuntime from "./agent-runtime-client.js";
import {
  type WebBackendDiagnosticContext,
  extendDiagnostics,
  webBackendDiagnostics,
} from "./webbackend-diagnostics.js";

export class ActiveRootRunError extends Error {
  constructor(conversationId: string, runId: string) {
    super(`Conversation ${conversationId} already has active root run ${runId}`);
    this.name = "ActiveRootRunError";
  }
}

export class RequiredActionResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequiredActionResolutionError";
  }
}

export async function createConversationAndRun(
  request: CreateConversationRequest,
  user?: AuthenticatedAppUser | null,
  diagnostics?: WebBackendDiagnosticContext
): Promise<ConversationDetail> {
  return collectFinalDetail(
    await createConversationAndRunStream(
      request,
      user,
      diagnostics
    )
  );
}

export async function createConversationAndRunStream(
  request: CreateConversationRequest,
  user?: AuthenticatedAppUser | null,
  diagnostics?: WebBackendDiagnosticContext
): Promise<AsyncGenerator<ConversationDetail>> {
  const conversation = await agentConversationStorage.conversations.create({
    id: randomUUID(),
    rootAgentKind: request.agentKind,
  });

  return runRootAgentWithProgress(
    conversation,
    request,
    user,
    diagnostics
  );
}

export async function runConversation(
  conversationId: string,
  request: CreateConversationRunRequest,
  user?: AuthenticatedAppUser | null,
  diagnostics?: WebBackendDiagnosticContext
): Promise<ConversationDetail | null> {
  const stream = await runConversationStream(
    conversationId,
    request,
    user,
    diagnostics
  );
  return stream ? collectFinalDetail(stream) : null;
}

export async function runConversationStream(
  conversationId: string,
  request: CreateConversationRunRequest,
  user?: AuthenticatedAppUser | null,
  diagnostics?: WebBackendDiagnosticContext
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
    diagnostics
  );
}

export async function resolveRunRequiredAction(
  runId: string,
  requiredActionId: string,
  request: {
    outcome: "resolved" | "declined";
    decision?: AgentRuntimeInterruptResume["response"]["decision"];
    comment?: string;
  },
  user?: AuthenticatedAppUser | null,
  diagnostics?: WebBackendDiagnosticContext
): Promise<ConversationDetail | null> {
  const run = await agentConversationStorage.agentRuns.get(runId);
  if (!run) {
    return null;
  }

  const items = await agentConversationStorage.runItems.list(run.id);
  const matchingRequiredActions = items.filter(
    (item): item is Extract<RunItem, { kind: "required_action" }> =>
      item.kind === "required_action" &&
      item.requiredActionId === requiredActionId
  );
  const requiredAction =
    matchingRequiredActions.find((item) => item.status === "pending") ??
    matchingRequiredActions.at(-1);
  if (!requiredAction) {
    throw new RequiredActionResolutionError("Required action not found.");
  }
  if (requiredAction.status !== "pending") {
    throw new RequiredActionResolutionError("Required action is not pending.");
  }

  const resumeState = await getInterruptResumeState(requiredAction);
  if (!resumeState) {
    throw new RequiredActionResolutionError(
      "Required action is not resumable by interrupt."
    );
  }

  const runtimeSession = await getOrCreateRuntimeSession(
    run.conversationId,
    diagnostics
  );
  const claimed = await agentConversationStorage.conversations.claimActiveRootRun(
    run.conversationId,
    run.id
  );
  if (!claimed) {
    const conversation =
      await agentConversationStorage.conversations.get(run.conversationId);
    throw new ActiveRootRunError(
      run.conversationId,
      conversation?.activeRootRunId ?? "unknown"
    );
  }

  const runDiagnostics = extendDiagnostics(diagnostics, {
    conversationId: run.conversationId,
    runId: run.id,
    agentKind: run.agentKind,
    incidentId: run.incidentId,
    deviceId: run.deviceId,
    userId: user?.sub,
    runtimeSessionId: runtimeSession.id,
    providerSessionId: runtimeSession.providerSessionId,
  });
  const response: AgentRuntimeInterruptResume["response"] = {
    approved: request.outcome === "resolved",
    decision:
      request.decision ??
      (request.outcome === "resolved" ? "allow_once" : "decline"),
    ...(request.comment ? { comment: request.comment } : {}),
    ...(user?.sub ? { resolvedByUserId: user.sub } : {}),
  };

  try {
    await agentConversationStorage.agentRuns.updateStatus(run.id, {
      status: "running",
      authRequired: undefined,
    });
    await agentConversationStorage.runtimeSessions.updateUsage(
      runtimeSession.id,
      "active"
    );
    for await (const event of agentRuntime.streamRootAgentRuntimeResume(
      run,
      runtimeSession,
      user?.sub ?? run.requestedByUserId ?? "pulseforge-webbackend",
      {
        requiredActionId,
        interruptId: resumeState.interruptId,
        snapshot: resumeState.snapshot,
        response,
      },
      runDiagnostics
    )) {
      // Runtime lifecycle persistence owns the resumed run activity. The
      // webbackend consumes the stream so the runtime can finish, then returns
      // a fresh read model from storage.
    }
    await agentConversationStorage.runtimeSessions.updateUsage(
      runtimeSession.id,
      "idle"
    );
  } catch (error) {
    await recordFailedRootAgentRun(
      run,
      runtimeSession,
      error,
      runDiagnostics
    );
    await agentConversationStorage.runtimeSessions.updateUsage(
      runtimeSession.id,
      "idle"
    );
  } finally {
    await agentConversationStorage.conversations.setActiveRootRun(
      run.conversationId,
      null
    );
  }

  return getRequiredConversationDetail(run.conversationId);
}

async function* runRootAgentWithProgress(
  conversation: Conversation,
  request: CreateConversationRequest,
  user?: AuthenticatedAppUser | null,
  diagnostics?: WebBackendDiagnosticContext
): AsyncGenerator<ConversationDetail> {
  const conversationDiagnostics = extendDiagnostics(diagnostics, {
    conversationId: conversation.id,
    agentKind: conversation.rootAgentKind,
    incidentId: request.incidentId,
    deviceId: request.deviceId,
    userId: user?.sub,
  });
  const runtimeSession = await getOrCreateRuntimeSession(
    conversation.id,
    conversationDiagnostics
  );
  const run = await startRootAgentRun(
    conversation,
    request,
    runtimeSession,
    user,
    conversationDiagnostics
  );
  const runDiagnostics = extendDiagnostics(conversationDiagnostics, {
    runId: run.id,
    runtimeSessionId: runtimeSession.id,
    providerSessionId: runtimeSession.providerSessionId,
  });

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
      runDiagnostics
    )) {
      if (isRuntimeProgressEvent(event.event)) {
        yield await getRequiredConversationDetail(conversation.id);
      }
    }

    await agentConversationStorage.runtimeSessions.updateUsage(
      runtimeSession.id,
      "idle"
    );
  } catch (error) {
    await recordFailedRootAgentRun(
      run,
      runtimeSession,
      error,
      runDiagnostics
    );
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
  conversationId: string,
  diagnostics?: WebBackendDiagnosticContext
): Promise<RuntimeSession> {
  const runtimeIdentity = agentRuntime.getRuntimeIdentity();
  const existing = await agentConversationStorage.runtimeSessions.getByProvider(
    conversationId,
    agentRuntime.runtimeProvider,
    runtimeIdentity
  );
  if (existing) {
    webBackendDiagnostics.runtimeSessionResolved(
      extendDiagnostics(diagnostics, {
        runtimeSessionId: existing.id,
        providerSessionId: existing.providerSessionId,
      }),
      {
        created: false,
        runtimeIdentity,
      }
    );
    return existing;
  }

  const created = await agentConversationStorage.runtimeSessions.create({
    id: randomUUID(),
    provider: agentRuntime.runtimeProvider,
    runtimeIdentity,
    providerSessionId: `conversation-${conversationId}`,
    conversationId,
    status: "active",
  });
  webBackendDiagnostics.runtimeSessionResolved(
    extendDiagnostics(diagnostics, {
      runtimeSessionId: created.id,
      providerSessionId: created.providerSessionId,
    }),
    {
      created: true,
      runtimeIdentity,
    }
  );
  return created;
}

async function startRootAgentRun(
  conversation: Conversation,
  request: CreateConversationRequest,
  runtimeSession: RuntimeSession,
  user?: AuthenticatedAppUser | null,
  diagnostics?: WebBackendDiagnosticContext
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

    webBackendDiagnostics.agentRunStarted(
      extendDiagnostics(diagnostics, {
        runId: run.id,
        runtimeSessionId: runtimeSession.id,
        providerSessionId: runtimeSession.providerSessionId,
      }),
      {
        requestedByUserId: user?.sub,
      }
    );

    return run;
  } catch (error) {
    await agentConversationStorage.conversations.setActiveRootRun(
      conversation.id,
      null
    );
    throw error;
  }
}

async function getInterruptResumeState(
  item: Extract<RunItem, { kind: "required_action" }>
): Promise<Pick<AgentRuntimeInterruptResume, "interruptId" | "snapshot"> | null> {
  if (item.actionType !== "tool_approval") {
    return null;
  }
  if (typeof item.data !== "object" || item.data === null) {
    return null;
  }
  if (!("resume" in item.data)) {
    return null;
  }

  const resume = item.data.resume;
  if (
    typeof resume !== "object" ||
    resume === null ||
    !("interruptId" in resume) ||
    typeof resume.interruptId !== "string" ||
    !("snapshotId" in resume) ||
    typeof resume.snapshotId !== "string"
  ) {
    return null;
  }

  const snapshot = await agentConversationStorage.agentRunSnapshots.get(
    resume.snapshotId
  );
  if (!snapshot) {
    return null;
  }

  return {
    interruptId: resume.interruptId,
    snapshot: snapshot.snapshot,
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
  runtimeSession: RuntimeSession,
  error: unknown,
  diagnostics?: WebBackendDiagnosticContext
) {
  const message = formatAgentInvocationError(error);
  webBackendDiagnostics.agentRunFailed(
    extendDiagnostics(diagnostics, {
      runId: run.id,
      conversationId: run.conversationId,
      runtimeSessionId: runtimeSession.id,
      providerSessionId: runtimeSession.providerSessionId,
      agentKind: run.agentKind,
      incidentId: run.incidentId,
      deviceId: run.deviceId,
    }),
    error
  );

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

function isRuntimeProgressEvent(event: string): boolean {
  return (
    event === "message" ||
    event === "summary" ||
    event === "auth_required" ||
    event === "required_action" ||
    event === "action_resolution" ||
    event === "tool_call" ||
    event === "tool_result" ||
    event === "run_agent" ||
    event === "run_note"
  );
}
