import type {
  AgentRun,
  AuditLogEntry,
  ContentBlock,
  Device,
  DeviceMetricSnapshot,
  IncidentActionApproval,
  IncidentActivity,
  IncidentAgentMention,
  IncidentComment,
  IncidentInvestigationContext,
  RemediationAction,
  RunItem,
  SimulationScenario,
  Ticket,
} from "../../../shared/pulseforge-domain/src/index.js";

const RECENT_ACTIVITY_LIMIT = 12;
const RECENT_TELEMETRY_LIMIT = 24;
const RELATED_INCIDENT_LIMIT = 5;
const LINKED_RUN_ITEM_LIMIT = 30;
const AUDIT_LOG_LIMIT = 30;

export function serializeDevice(device: Device) {
  return {
    ok: true as const,
    device: {
      id: device.id,
      siteId: device.siteId,
      name: device.name,
      type: device.type,
      source: device.source,
      firmwareVersion: device.firmwareVersion,
      batteryPercent: device.batteryPercent,
      connectivityPercent: device.connectivityPercent,
      status: device.status,
      tags: device.tags,
      lastSeenAt: device.lastSeenAt,
    },
  };
}

export function serializeDeviceTelemetry(
  deviceId: string,
  telemetry: DeviceMetricSnapshot[]
) {
  const recentTelemetry = telemetry.slice(-RECENT_TELEMETRY_LIMIT);

  return {
    ok: true as const,
    deviceId,
    count: telemetry.length,
    latest: telemetry.at(-1) ?? null,
    recentTelemetry,
  };
}

export function serializeDeviceReset(deviceId: string, reason: string) {
  return {
    ok: true as const,
    deviceReset: {
      deviceId,
      status: "succeeded",
      reason,
      resetAt: new Date().toISOString(),
      message: `Device ${deviceId} reset successfully.`,
    },
  };
}

export function serializeIncidentContext(context: IncidentInvestigationContext) {
  return {
    ok: true as const,
    incident: {
      id: context.incident.id,
      siteId: context.incident.siteId,
      title: context.incident.title,
      summary: context.incident.summary,
      severity: context.incident.severity,
      status: context.incident.status,
      category: context.incident.category,
      deviceIds: context.incident.deviceIds,
      createdAt: context.incident.createdAt,
      updatedAt: context.incident.updatedAt,
      resolvedAt: context.incident.resolvedAt,
      resolvedByUserId: context.incident.resolvedByUserId,
    },
    recentActivity: context.activities
      .slice(-RECENT_ACTIVITY_LIMIT)
      .map(serializeIncidentActivity),
    comments: context.comments.map(serializeIncidentComment),
    agentMentions: context.agentMentions.map(serializeIncidentAgentMention),
    actionApprovals: context.actionApprovals.map(serializeIncidentActionApproval),
    affectedDevices: context.devices.map(({ device, telemetry }) => ({
      ...serializeDevice(device).device,
      telemetry: serializeDeviceTelemetry(device.id, telemetry),
    })),
    relatedIncidents: context.relatedIncidents
      .slice(0, RELATED_INCIDENT_LIMIT)
      .map((incident) => ({
        id: incident.id,
        title: incident.title,
        severity: incident.severity,
        status: incident.status,
        category: incident.category,
        updatedAt: incident.updatedAt,
      })),
    runbook: context.runbook
      ? {
          id: context.runbook.id,
          title: context.runbook.title,
          summary: context.runbook.summary,
          steps: context.runbook.steps.slice(0, 5),
        }
      : null,
    remediationActions: context.remediationActions.map(serializeRemediationActionData),
    tickets: context.tickets.map(serializeTicketData),
    simulationScenarios: context.simulationScenarios.map(serializeSimulationScenario),
    linkedAgentWork: context.linkedAgentWork.map((work) => ({
      conversation: {
        id: work.conversation.id,
        rootAgentKind: work.conversation.rootAgentKind,
        incidentId: work.conversation.incidentId,
        interactionMode: work.conversation.interactionMode,
        createdAt: work.conversation.createdAt,
        updatedAt: work.conversation.updatedAt,
      },
      runs: work.runs.map(serializeAgentRun),
      recentItems: work.items
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(-LINKED_RUN_ITEM_LIMIT)
        .map(serializeRunItem),
    })),
    auditLogs: context.auditLogs
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      .slice(-AUDIT_LOG_LIMIT)
      .map(serializeAuditLog),
    resolutionEvidence: context.resolutionEvidence,
  };
}

export function serializeIncidentActivity(activity: IncidentActivity) {
  return {
    id: activity.id,
    incidentId: activity.incidentId,
    timestamp: activity.timestamp,
    kind: activity.kind,
    message: activity.message,
    conversationId: activity.conversationId,
    agentRunId: activity.agentRunId,
    agentKind: activity.agentKind,
    agentStatus: activity.agentStatus,
    title: activity.title,
    summary: activity.summary,
    causedByCommentId: activity.causedByCommentId,
    incidentActionApprovalId: activity.incidentActionApprovalId,
  };
}

function serializeIncidentComment(comment: IncidentComment) {
  return {
    id: comment.id,
    authorUserId: comment.authorUserId,
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

function serializeIncidentAgentMention(mention: IncidentAgentMention) {
  return {
    id: mention.id,
    commentId: mention.commentId,
    status: mention.status,
    conversationId: mention.conversationId,
    agentRunId: mention.agentRunId,
    activityId: mention.activityId,
    acceptedAt: mention.acceptedAt,
    errorMessage: mention.errorMessage,
  };
}

function serializeIncidentActionApproval(approval: IncidentActionApproval) {
  return {
    id: approval.id,
    conversationId: approval.conversationId,
    agentRunId: approval.agentRunId,
    requiredActionId: approval.requiredActionId,
    toolName: approval.toolName,
    title: approval.title,
    summary: approval.summary,
    status: approval.status,
    requestedAt: approval.requestedAt,
    resolvedAt: approval.resolvedAt,
    resolvedByUserId: approval.resolvedByUserId,
    activityId: approval.activityId,
  };
}

export function serializeCreatedIncidentActivity(activity: IncidentActivity) {
  return {
    ok: true as const,
    activity: serializeIncidentActivity(activity),
  };
}

export function serializeTicket(ticket: Ticket) {
  return {
    ok: true as const,
    ticket: serializeTicketData(ticket),
  };
}

export function serializeRemediationAction(action: RemediationAction) {
  return {
    ok: true as const,
    remediationAction: serializeRemediationActionData(action),
  };
}

export function serializeToolError(errorCode: string, message: string) {
  return {
    ok: false as const,
    errorCode,
    message,
  };
}

function serializeTicketData(ticket: Ticket) {
  return {
    id: ticket.id,
    incidentId: ticket.incidentId,
    externalRef: ticket.externalRef,
    status: ticket.status,
    assigneeTeam: ticket.assigneeTeam,
    createdAt: ticket.createdAt,
  };
}

function serializeRemediationActionData(action: RemediationAction) {
  return {
    id: action.id,
    incidentId: action.incidentId,
    type: action.type,
    status: action.status,
    risk: action.risk,
    summary: action.summary,
    createdBy: action.createdBy,
  };
}

function serializeSimulationScenario(scenario: SimulationScenario) {
  return {
    id: scenario.id,
    deviceId: scenario.deviceId,
    type: scenario.type,
    status: scenario.status,
    incidentId: scenario.incidentId,
    createdAt: scenario.createdAt,
    startedAt: scenario.startedAt,
    triggeredAt: scenario.triggeredAt,
    completedAt: scenario.completedAt,
    completedReason: scenario.completedReason,
  };
}

function serializeAgentRun(run: AgentRun) {
  return {
    id: run.id,
    conversationId: run.conversationId,
    incidentId: run.incidentId,
    deviceId: run.deviceId,
    agentKind: run.agentKind,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    requestedByUserId: run.requestedByUserId,
    summary: run.summary,
    investigation: run.investigation,
    errorMessage: run.errorMessage,
  };
}

function serializeRunItem(item: RunItem) {
  const base = {
    id: item.id,
    runId: item.runId,
    sequence: item.sequence,
    kind: item.kind,
    createdAt: item.createdAt,
    source: item.source,
  };

  if (item.kind === "message") {
    return {
      ...base,
      role: item.role,
      content: contentToText(item.content),
    };
  }

  if (item.kind === "tool_call") {
    return {
      ...base,
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      status: item.status,
      arguments: item.arguments,
    };
  }

  if (item.kind === "tool_result") {
    return {
      ...base,
      toolCallId: item.toolCallId,
      isError: item.isError,
      content: contentToText(item.content),
    };
  }

  if (item.kind === "required_action") {
    return {
      ...base,
      requiredActionId: item.requiredActionId,
      actionType: item.actionType,
      status: item.status,
      content: contentToText(item.content),
      data: item.data,
      resolvedAt: item.resolvedAt,
      resolvedBy: item.resolvedBy,
    };
  }

  if (item.kind === "action_resolution") {
    return {
      ...base,
      requiredActionId: item.requiredActionId,
      outcome: item.outcome,
      content: contentToText(item.content ?? []),
      data: item.data,
    };
  }

  if (item.kind === "run_agent") {
    return {
      ...base,
      relationship: item.relationship,
      agentKind: item.agentKind,
      childRunId: item.childRunId,
      toolCallId: item.toolCallId,
      status: item.status,
    };
  }

  return {
    ...base,
    noteType: item.noteType,
    message: item.message,
    data: item.data,
  };
}

function serializeAuditLog(entry: AuditLogEntry) {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    actor: entry.actor,
    operation: entry.operation,
    method: entry.method,
    path: entry.path,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    outcome: entry.outcome,
    statusCode: entry.statusCode,
    message: entry.message,
  };
}

function contentToText(content: ContentBlock[]): string {
  return content
    .map((block) => {
      if (block.type === "text") {
        return stripThinkingBlocks(block.text);
      }
      if (block.type === "json") {
        return JSON.stringify(block.value);
      }
      if (block.type === "resource_ref") {
        return `${block.resourceType}:${block.resourceId}`;
      }
      if (block.type === "file") {
        return block.name ?? block.fileId;
      }
      return block.alt ?? block.fileId;
    })
    .filter(Boolean)
    .join("\n");
}

function stripThinkingBlocks(value: string): string {
  return value
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<\/?thinking>/gi, "")
    .trim();
}
