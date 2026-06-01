import type {
  AuthenticatedAppUser,
  IncidentAgentActivityStatus,
} from "../../../../shared/pulseforge-domain/src/index.js";
import {
  createIncidentActivity,
  createIncidentAgentMention,
  createIncidentComment,
  getIncident,
  updateIncidentAgentMention,
  type IncidentAggregate,
} from "../../../../shared/pulseforge-backend/src/index.js";
import {
  createConversationAndRun,
  createConversationAndRunStream,
} from "./root-agent-run-lifecycle.js";
import type { WebBackendDiagnosticContext } from "./webbackend-diagnostics.js";

const COPILOT_MENTION_PATTERN = /(^|\s)@copilot\b/gi;

export class IncidentCommentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentCommentError";
  }
}

export async function postIncidentComment(
  incidentId: string,
  body: string,
  user?: AuthenticatedAppUser | null,
  diagnostics?: WebBackendDiagnosticContext
): Promise<IncidentAggregate | null> {
  const incident = await getIncident(incidentId);
  if (!incident) {
    return null;
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
    const detail = await createConversationAndRun(
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
    const run = detail.runs.at(-1);
    const activity = await createIncidentActivity({
      incidentId,
      kind: "agent_conversation",
      message: `Copilot connected by ${user?.username ?? authorUserId}.`,
      createdBy: { actorType: "user", actorId: authorUserId },
      conversationId: detail.conversation.id,
      agentRunId: run?.id,
      agentKind: "ops-copilot",
      agentStatus: run ? toIncidentAgentActivityStatus(run.status) : "queued",
      title: "Copilot conversation",
      summary: run?.summary,
      causedByCommentId: comment.id,
      causedByMentionId: mention.id,
    });
    await updateIncidentAgentMention(mention.id, {
      conversationId: detail.conversation.id,
      agentRunId: run?.id,
      activityId: activity.id,
    });
  }

  return getIncident(incidentId);
}

export async function startIncidentCreatedAutomation(
  incidentId: string,
  diagnostics?: WebBackendDiagnosticContext
): Promise<IncidentAggregate | null> {
  const incident = await getIncident(incidentId);
  if (!incident) {
    return null;
  }

  const stream = await createConversationAndRunStream(
    {
      agentKind: "incident-responder",
      prompt: `Incident ${incidentId} was created. Investigate the incident, record high-signal activity, and recommend next operator actions.`,
      incidentId,
      interactionMode: "observe_only",
    },
    null,
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

function countCopilotMentions(body: string): number {
  return [...body.matchAll(COPILOT_MENTION_PATTERN)].length;
}

function buildCopilotMentionPrompt(body: string, incidentId: string): string {
  const cleaned = body.replace(COPILOT_MENTION_PATTERN, " ").trim();
  return cleaned
    ? `Incident ${incidentId}: ${cleaned}`
    : `Review incident ${incidentId} and provide concise operator guidance.`;
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
