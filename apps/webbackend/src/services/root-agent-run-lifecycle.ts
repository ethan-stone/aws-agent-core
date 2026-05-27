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
  parseAgentRuntimeResponse,
  type AgentRuntimeSseEvent,
  type ParsedRuntimeResponse,
} from "./runtime-output-projection.js";
import type {
  AppendRunItemInput,
} from "../../../../shared/pulseforge-backend/src/index.js";
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
  const requiredAction = items.find(
    (item): item is Extract<RunItem, { kind: "required_action" }> =>
      item.kind === "required_action" &&
      item.requiredActionId === requiredActionId
  );
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
  const runtimeEvents: AgentRuntimeSseEvent[] = [];
  const liveRequiredActionIds = new Set<string>();
  const liveActionResolutionIds = new Set<string>();
  const response: AgentRuntimeInterruptResume["response"] = {
    approved: request.outcome === "resolved",
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
      runtimeEvents.push(event);
      await recordLiveRequiredAction(
        run,
        event,
        liveRequiredActionIds,
        runDiagnostics
      );
      await recordLiveActionResolution(
        run,
        event,
        liveActionResolutionIds,
        runDiagnostics
      );
    }

    const result = parseAgentRuntimeResponse(runtimeEvents, run);
    await recordCompletedRootAgentRun(
      run,
      withoutLiveRequiredActionUpdates(
        result,
        liveRequiredActionIds,
        liveActionResolutionIds
      ),
      runDiagnostics
    );
    await agentConversationStorage.runtimeSessions.updateUsage(
      runtimeSession.id,
      "idle"
    );
  } catch (error) {
    await recordFailedRootAgentRun(
      run,
      {
        agentKind: run.agentKind,
        prompt: "",
        incidentId: run.incidentId,
        deviceId: run.deviceId,
      },
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
  const runtimeEvents: AgentRuntimeSseEvent[] = [];
  const liveRequiredActionIds = new Set<string>();
  const liveActionResolutionIds = new Set<string>();

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
      runtimeEvents.push(event);
      if (
        await recordLiveRequiredAction(
          run,
          event,
          liveRequiredActionIds,
          runDiagnostics
        )
      ) {
        yield await getRequiredConversationDetail(conversation.id);
      }
      if (
        await recordLiveActionResolution(
          run,
          event,
          liveActionResolutionIds,
          runDiagnostics
        )
      ) {
        yield await getRequiredConversationDetail(conversation.id);
      }
    }

    const result = parseAgentRuntimeResponse(runtimeEvents, run);
    await recordCompletedRootAgentRun(
      run,
      withoutLiveRequiredActionUpdates(
        result,
        liveRequiredActionIds,
        liveActionResolutionIds
      ),
      runDiagnostics
    );
    await agentConversationStorage.runtimeSessions.updateUsage(
      runtimeSession.id,
      "idle"
    );
  } catch (error) {
    await recordFailedRootAgentRun(
      run,
      request,
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

async function recordCompletedRootAgentRun(
  run: AgentRun,
  result: ParsedRuntimeResponse,
  diagnostics?: WebBackendDiagnosticContext
) {
  if (result.items.length > 0) {
    await agentConversationStorage.runItems.append(
      run.id,
      await externalizeRunItemSnapshots(run, result.items)
    );
  }

  if (result.authRequired && !result.hasCompletedOutput) {
    await agentConversationStorage.agentRuns.updateStatus(run.id, {
      status: "auth_required",
      summary: result.summary,
      authRequired: result.authRequired,
    });
    webBackendDiagnostics.agentRunCompleted(
      extendDiagnostics(diagnostics, {
        runId: run.id,
        conversationId: run.conversationId,
        agentKind: run.agentKind,
      }),
      {
        status: "auth_required",
        itemCount: result.items.length,
        summary: result.summary,
      }
    );
    return;
  }

  if (result.hasPendingRequiredAction && !result.hasCompletedOutput) {
    await agentConversationStorage.agentRuns.updateStatus(run.id, {
      status: "waiting_for_action",
      summary: result.summary,
    });
    webBackendDiagnostics.agentRunCompleted(
      extendDiagnostics(diagnostics, {
        runId: run.id,
        conversationId: run.conversationId,
        agentKind: run.agentKind,
      }),
      {
        status: "waiting_for_action",
        itemCount: result.items.length,
        summary: result.summary,
      }
    );
    return;
  }

  await agentConversationStorage.agentRuns.updateStatus(run.id, {
    status: "completed",
    summary: result.summary,
    investigation: result.investigation,
  });
  webBackendDiagnostics.agentRunCompleted(
    extendDiagnostics(diagnostics, {
      runId: run.id,
      conversationId: run.conversationId,
      agentKind: run.agentKind,
    }),
    {
      status: "completed",
      itemCount: result.items.length,
      summary: result.summary,
    }
  );
}

async function recordLiveRequiredAction(
  run: AgentRun,
  event: AgentRuntimeSseEvent,
  liveRequiredActionIds: Set<string>,
  diagnostics?: WebBackendDiagnosticContext
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

  await agentConversationStorage.runItems.append(
    run.id,
    await externalizeRunItemSnapshots(run, requiredActions)
  );
  for (const item of requiredActions) {
    liveRequiredActionIds.add(item.requiredActionId);
    webBackendDiagnostics.agentRequiredActionObserved(
      extendDiagnostics(diagnostics, {
        runId: run.id,
        conversationId: run.conversationId,
        agentKind: run.agentKind,
      }),
      {
        actionType: item.actionType,
        requiredActionId: item.requiredActionId,
        status: item.status,
      }
    );
  }

  await agentConversationStorage.agentRuns.updateStatus(run.id, {
    status: result.authRequired ? "auth_required" : "waiting_for_action",
    summary: result.summary,
    authRequired: result.authRequired,
  });

  return true;
}

async function recordLiveActionResolution(
  run: AgentRun,
  event: AgentRuntimeSseEvent,
  liveActionResolutionIds: Set<string>,
  diagnostics?: WebBackendDiagnosticContext
): Promise<boolean> {
  if (event.event !== "action_resolution") {
    return false;
  }

  const result = parseAgentRuntimeResponse([event], run);
  const resolutions = result.items.filter(
    (
      item
    ): item is Extract<AppendRunItemInput, { kind: "action_resolution" }> =>
      item.kind === "action_resolution" &&
      !liveActionResolutionIds.has(item.requiredActionId)
  );
  if (resolutions.length === 0) {
    return false;
  }

  await agentConversationStorage.runItems.append(run.id, resolutions);
  for (const item of resolutions) {
    liveActionResolutionIds.add(item.requiredActionId);
    await agentConversationStorage.runItems.updateRequiredActionStatus(
      run.id,
      item.requiredActionId,
      {
        status: item.outcome,
        resolvedBy: { type: "system" },
      }
    );
    webBackendDiagnostics.agentRequiredActionObserved(
      extendDiagnostics(diagnostics, {
        runId: run.id,
        conversationId: run.conversationId,
        agentKind: run.agentKind,
      }),
      {
        actionType: "action_resolution",
        requiredActionId: item.requiredActionId,
        status: item.outcome,
      }
    );
  }

  await agentConversationStorage.agentRuns.updateStatus(run.id, {
    status: "running",
    authRequired: undefined,
  });

  return true;
}

function withoutLiveRequiredActionUpdates(
  result: ParsedRuntimeResponse,
  liveRequiredActionIds: Set<string>,
  liveActionResolutionIds: Set<string>
): ParsedRuntimeResponse {
  if (
    liveRequiredActionIds.size === 0 &&
    liveActionResolutionIds.size === 0
  ) {
    return result;
  }

  return {
    ...result,
    items: result.items.filter(
      (item) =>
        !(
          (item.kind === "required_action" &&
            liveRequiredActionIds.has(item.requiredActionId)) ||
          (item.kind === "action_resolution" &&
            liveActionResolutionIds.has(item.requiredActionId))
        )
    ),
  };
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

async function externalizeRunItemSnapshots(
  run: AgentRun,
  items: AppendRunItemInput[]
): Promise<AppendRunItemInput[]> {
  const externalized: AppendRunItemInput[] = [];

  for (const item of items) {
    if (item.kind !== "required_action") {
      externalized.push(item);
      continue;
    }

    const data = item.data;
    if (
      typeof data !== "object" ||
      data === null ||
      !("resume" in data) ||
      typeof data.resume !== "object" ||
      data.resume === null ||
      !("interruptId" in data.resume) ||
      typeof data.resume.interruptId !== "string" ||
      !("snapshot" in data.resume)
    ) {
      externalized.push(item);
      continue;
    }

    const snapshotId = randomUUID();
    await agentConversationStorage.agentRunSnapshots.create({
      id: snapshotId,
      runId: run.id,
      requiredActionId: item.requiredActionId,
      provider: "strands",
      kind: "interrupt_resume",
      snapshot: data.resume.snapshot,
    });

    const { snapshot: _snapshot, ...resumeReference } = data.resume;
    externalized.push({
      ...item,
      data: {
        ...data,
        resume: {
          ...resumeReference,
          snapshotId,
        },
      },
    });
  }

  return externalized;
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
      agentKind: request.agentKind,
      incidentId: request.incidentId,
      deviceId: request.deviceId,
    }),
    error
  );

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
