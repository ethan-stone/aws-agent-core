import type {
  AuthenticatedAppUser,
  ConversationDetail,
  IncidentAgentActivityStatus,
} from "../../../../shared/pulseforge-domain/src/index.js";
import {
  createIncidentActivity,
  createIncidentAgentMention,
  createIncidentComment,
  getIncident,
  getSnapshot,
  updateIncidentActivityByAgentRun,
  updateIncidentAgentMention,
  type IncidentAggregate,
} from "../../../../shared/pulseforge-backend/src/index.js";
import {
  createConversationAndRunStream,
  createIncidentCreatedConversationAndRunStream,
} from "./root-agent-run-lifecycle.js";
import type { WebBackendDiagnosticContext } from "./webbackend-diagnostics.js";

const COPILOT_MENTION_PATTERN = /(^|\s)@copilot\b/gi;

export class IncidentCommentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentCommentError";
  }
}

export interface IncidentCommentProgress {
  incident: IncidentAggregate;
  conversation?: ConversationDetail;
}

export interface IncidentAutomationSweepResult {
  checked: number;
  started: number;
  skipped: number;
  failed: number;
  incidents: Array<{
    incidentId: string;
    status: "started" | "skipped" | "failed";
    error?: string;
  }>;
}

export async function postIncidentComment(
  incidentId: string,
  body: string,
  user?: AuthenticatedAppUser | null,
  diagnostics?: WebBackendDiagnosticContext
): Promise<IncidentAggregate | null> {
  let latest: IncidentAggregate | null = null;
  for await (const progress of postIncidentCommentStream(
    incidentId,
    body,
    user,
    diagnostics
  )) {
    latest = progress.incident;
  }
  return latest;
}

export async function* postIncidentCommentStream(
  incidentId: string,
  body: string,
  user?: AuthenticatedAppUser | null,
  diagnostics?: WebBackendDiagnosticContext
): AsyncGenerator<IncidentCommentProgress> {
  const incident = await getIncident(incidentId);
  if (!incident) {
    return;
  }

  const authorUserId = user?.sub ?? "anonymous";
  const mentionCount = countCopilotMentions(body);
  if (mentionCount > 1) {
    throw new IncidentCommentError(
      "Only one actionable @copilot mention is supported per comment."
    );
  }

  const comment = await createIncidentComment({
    incidentId,
    body,
    authorUserId,
  });
  yield { incident: await getRequiredIncident(incidentId) };

  if (mentionCount === 1) {
    const mention = await createIncidentAgentMention({
      incidentId,
      commentId: comment.id,
      handle: "@copilot",
      agentKind: "ops-copilot",
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    });
    const prompt = buildCopilotMentionPrompt(body, incidentId);
    const stream = await createConversationAndRunStream(
      {
        agentKind: "ops-copilot",
        prompt,
        incidentId,
        interactionMode: "interactive",
        interactionOwnerUserId: authorUserId,
      },
      user,
      diagnostics
    );
    let activityId: string | null = null;
    let latestDetail: ConversationDetail | undefined;
    for await (const detail of stream) {
      latestDetail = detail;
      const run = detail.runs.at(-1);
      if (!run) {
        continue;
      }

      if (!activityId) {
        const activity = await createIncidentActivity({
          incidentId,
          kind: "agent_conversation",
          message: copilotMentionActivityMessage(
            run.status,
            user?.username ?? authorUserId
          ),
          createdBy: { actorType: "user", actorId: authorUserId },
          conversationId: detail.conversation.id,
          agentRunId: run.id,
          agentKind: "ops-copilot",
          agentStatus: toIncidentAgentActivityStatus(run.status),
          title: "Copilot conversation",
          summary: run.summary,
          causedByCommentId: comment.id,
          causedByMentionId: mention.id,
        });
        activityId = activity.id;
        await updateIncidentAgentMention(mention.id, {
          conversationId: detail.conversation.id,
          agentRunId: run.id,
          activityId,
        });
      } else {
        await updateIncidentActivityForCopilotMention(
          run.id,
          run.status,
          run.summary
        );
      }

      yield {
        incident: await getRequiredIncident(incidentId),
        conversation: latestDetail,
      };
    }
  }

  yield { incident: await getRequiredIncident(incidentId) };
}

export async function startIncidentCreatedAutomation(
  incidentId: string,
  diagnostics?: WebBackendDiagnosticContext
): Promise<IncidentAggregate | null> {
  const incident = await getIncident(incidentId);
  if (!incident) {
    return null;
  }
  if (await hasObserveOnlyIncidentConversation(incidentId)) {
    return incident;
  }

  const stream = await createIncidentCreatedConversationAndRunStream(
    incidentId,
    diagnostics
  );

  let activityCreated = false;
  for await (const detail of stream) {
    const run = detail.runs.at(-1);
    if (!activityCreated && run) {
      activityCreated = true;
      await createIncidentActivity({
        incidentId,
        kind: "agent_conversation",
        message: "Incident Responder started automatically.",
        createdBy: { actorType: "agent", actorId: "incident-responder" },
        conversationId: detail.conversation.id,
        agentRunId: run.id,
        agentKind: "incident-responder",
        agentStatus: toIncidentAgentActivityStatus(run.status),
        title: "Automatic incident response",
        summary: run.summary,
      });
    }
  }

  return getIncident(incidentId);
}

export async function runIncidentResponderAutomationSweep(
  options: {
    limit?: number;
    diagnostics?: WebBackendDiagnosticContext;
  } = {}
): Promise<IncidentAutomationSweepResult> {
  const snapshot = await getSnapshot();
  const observeOnlyIncidentIds = new Set(
    snapshot.conversations
      .filter(
        (conversation) =>
          conversation.interactionMode === "observe_only" &&
          typeof conversation.incidentId === "string"
      )
      .map((conversation) => conversation.incidentId as string)
  );
  const candidates = snapshot.incidents
    .filter(
      (incident) =>
        incident.status !== "resolved" &&
        !observeOnlyIncidentIds.has(incident.id)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, options.limit ?? 3);
  const result: IncidentAutomationSweepResult = {
    checked: candidates.length,
    started: 0,
    skipped: 0,
    failed: 0,
    incidents: [],
  };

  for (const incident of candidates) {
    try {
      const before = await hasObserveOnlyIncidentConversation(incident.id);
      const aggregate = await startIncidentCreatedAutomation(
        incident.id,
        options.diagnostics
      );
      const after = await hasObserveOnlyIncidentConversation(incident.id);
      const started = Boolean(aggregate) && !before && after;
      result[started ? "started" : "skipped"] += 1;
      result.incidents.push({
        incidentId: incident.id,
        status: started ? "started" : "skipped",
      });
    } catch (error) {
      result.failed += 1;
      result.incidents.push({
        incidentId: incident.id,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

async function hasObserveOnlyIncidentConversation(
  incidentId: string
): Promise<boolean> {
  const snapshot = await getSnapshot();
  return snapshot.conversations.some(
    (conversation) =>
      conversation.interactionMode === "observe_only" &&
      conversation.incidentId === incidentId
  );
}

function countCopilotMentions(body: string): number {
  return [...body.matchAll(COPILOT_MENTION_PATTERN)].length;
}

function buildCopilotMentionPrompt(body: string, incidentId: string): string {
  const cleaned = body.replace(COPILOT_MENTION_PATTERN, " ").trim();
  return cleaned
    ? `Incident ${incidentId}: ${cleaned}`
    : `Review incident ${incidentId} and provide concise operator guidance.`;
}

async function getRequiredIncident(
  incidentId: string
): Promise<IncidentAggregate> {
  const incident = await getIncident(incidentId);
  if (!incident) {
    throw new Error(`Incident ${incidentId} disappeared while posting comment.`);
  }
  return incident;
}

async function updateIncidentActivityForCopilotMention(
  agentRunId: string,
  status: Parameters<typeof toIncidentAgentActivityStatus>[0],
  summary?: string
) {
  await updateIncidentActivityByAgentRun(agentRunId, {
    agentStatus: toIncidentAgentActivityStatus(status),
    message: copilotMentionActivityMessage(status),
    summary,
  });
}

function copilotMentionActivityMessage(
  status: Parameters<typeof toIncidentAgentActivityStatus>[0],
  actorLabel = "operator"
): string {
  if (status === "completed") {
    return "Copilot completed its incident response.";
  }
  if (status === "failed") {
    return "Copilot could not finish this incident response.";
  }
  if (status === "cancelled") {
    return "Copilot incident response was cancelled.";
  }
  if (status === "auth_required") {
    return "Copilot is waiting for delegated authorization.";
  }
  if (status === "waiting_for_action") {
    return "Copilot is waiting for operator approval.";
  }
  return `Copilot is investigating after ${actorLabel} mentioned @copilot.`;
}

function toIncidentAgentActivityStatus(
  status: "queued" | "running" | "auth_required" | "waiting_for_action" | "completed" | "failed" | "cancelled"
): IncidentAgentActivityStatus {
  if (status === "auth_required") {
    return "waiting_for_authorization";
  }
  if (status === "waiting_for_action") {
    return "waiting_for_approval";
  }
  return status;
}
