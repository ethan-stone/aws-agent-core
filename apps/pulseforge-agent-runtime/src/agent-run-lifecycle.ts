import { randomUUID } from "node:crypto";
import type {
  AgentRunAuthRequired,
  AgentRunInvestigationSummary,
  AgentRuntimeStreamEvent,
  AgentKind,
  ContentBlock,
  Conversation,
  RequiredActionStatus,
  RunItem,
  ToolApprovalGrant,
} from "../../../shared/pulseforge-domain/src/index.js";
import {
  appendRunItems,
  createAgentRunSnapshot,
  createIncidentActionApproval,
  createIncidentActivity,
  getConversation,
  listRunItems,
  updateRequiredActionData,
  updateAgentRunStatus,
  updateIncidentActivityByAgentRun,
  updateIncidentActionApprovalStatus,
  updateIncidentActionApprovalByRequiredAction,
  updateRequiredActionStatus,
  updateToolCallStatus,
  upsertConversationToolApprovalGrant,
  type AppendRunItemInput,
} from "../../../shared/pulseforge-backend/src/index.js";

export interface AgentRunLifecycleStorage {
  appendRunItems(
    runId: string,
    items: AppendRunItemInput[]
  ): Promise<RunItem[]>;
  createAgentRunSnapshot: typeof createAgentRunSnapshot;
  createIncidentActionApproval: typeof createIncidentActionApproval;
  createIncidentActivity: typeof createIncidentActivity;
  getConversation: typeof getConversation;
  listRunItems: typeof listRunItems;
  updateRequiredActionData: typeof updateRequiredActionData;
  updateAgentRunStatus: typeof updateAgentRunStatus;
  updateIncidentActivityByAgentRun: typeof updateIncidentActivityByAgentRun;
  updateIncidentActionApprovalStatus: typeof updateIncidentActionApprovalStatus;
  updateIncidentActionApprovalByRequiredAction: typeof updateIncidentActionApprovalByRequiredAction;
  updateRequiredActionStatus: typeof updateRequiredActionStatus;
  updateToolCallStatus: typeof updateToolCallStatus;
  upsertConversationToolApprovalGrant: typeof upsertConversationToolApprovalGrant;
}

export interface AgentRunLifecycleContext {
  conversationId: string;
  agentRunId: string;
  agentKind: AgentKind;
  incidentId?: string;
  actorId?: string;
}

const defaultStorage: AgentRunLifecycleStorage = {
  appendRunItems,
  createAgentRunSnapshot,
  createIncidentActionApproval,
  createIncidentActivity,
  getConversation,
  listRunItems,
  updateRequiredActionData,
  updateAgentRunStatus,
  updateIncidentActivityByAgentRun,
  updateIncidentActionApprovalStatus,
  updateIncidentActionApprovalByRequiredAction,
  updateRequiredActionStatus,
  updateToolCallStatus,
  upsertConversationToolApprovalGrant,
};

export class AgentRunLifecycle {
  constructor(
    private readonly request: AgentRunLifecycleContext,
    private readonly storage: AgentRunLifecycleStorage = defaultStorage
  ) {}

  async recordAgentMessage(text: string): Promise<void> {
    await this.append({
      runId: this.request.agentRunId,
      kind: "message",
      role: "agent",
      source: this.agentSource(),
      content: textContent(stripThinkingBlocks(text)),
    });
  }

  async recordToolCallStarted(details: {
    toolCallId: string;
    toolName: string;
    input: unknown;
  }): Promise<void> {
    await this.append({
      runId: this.request.agentRunId,
      kind: "tool_call",
      toolCallId: details.toolCallId,
      toolName: details.toolName,
      arguments: details.input,
      status: "pending",
      source: this.agentSource(),
    });
  }

  async recordToolCallCompleted(details: {
    toolCallId: string;
    toolName: string;
    output: unknown;
  }): Promise<void> {
    await this.storage.updateToolCallStatus(
      this.request.agentRunId,
      details.toolCallId,
      "succeeded"
    );
    await this.append({
      runId: this.request.agentRunId,
      kind: "tool_result",
      toolCallId: details.toolCallId,
      content: toContentBlocks(details.output),
      source: { type: "tool", toolName: details.toolName },
    });
  }

  async recordToolCallFailed(details: {
    toolCallId: string;
    toolName: string;
    error: unknown;
  }): Promise<void> {
    await this.storage.updateToolCallStatus(
      this.request.agentRunId,
      details.toolCallId,
      "failed"
    );
    await this.append({
      runId: this.request.agentRunId,
      kind: "tool_result",
      toolCallId: details.toolCallId,
      content: toContentBlocks(details.error),
      isError: true,
      source: { type: "tool", toolName: details.toolName },
    });
  }

  async recordAuthorizationRequired(
    details: AgentRunAuthRequired & { requiredActionId?: string }
  ): Promise<void> {
    const requiredActionId =
      details.requiredActionId ?? `auth:${this.request.agentRunId}:${Date.now()}`;
    const authRequired: AgentRunAuthRequired = {
      providerName: details.providerName,
      providerDisplayName: details.providerDisplayName,
      authUrl: details.authUrl,
      scopes: details.scopes,
      agentRunId: this.request.agentRunId,
    };

    await this.append({
      runId: this.request.agentRunId,
      kind: "required_action",
      requiredActionId,
      actionType: "auth_required",
      status: "pending",
      source: { type: "system" },
      content: [
        {
          type: "text",
          text: `Authorization required for ${details.providerDisplayName ?? details.providerName}.`,
        },
      ],
      data: {
        type: "auth_required",
        providerName: details.providerName,
        providerDisplayName: details.providerDisplayName,
        authUrl: details.authUrl,
        scopes: details.scopes,
        agentRunId: this.request.agentRunId,
      },
    });

    await this.storage.updateAgentRunStatus(this.request.agentRunId, {
      status: "auth_required",
      summary: "Agent run requires delegated tool authorization.",
      authRequired,
    });
    await this.updateObserveOnlyIncidentActivity({
      agentStatus: "waiting_for_authorization",
      message: "Incident Responder is waiting for delegated authorization.",
      summary: "Agent run requires delegated tool authorization.",
    });
  }

  async recordRequiredAction(
    details: Extract<AgentRuntimeStreamEvent, { event: "required_action" }>["data"]
  ): Promise<void> {
    const existing = await this.getRequiredAction(details.requiredActionId);
    if (existing) {
      if (existing.status === "pending") {
        await this.storage.updateRequiredActionData(
          this.request.agentRunId,
          details.requiredActionId,
          {
            content: details.content,
            data: await this.externalizeRequiredActionData(
              details.requiredActionId,
              details.data
            ),
          }
        );
        await this.recordRunNote(
          "duplicate_required_action_refreshed",
          `Refreshed pending required action ${details.requiredActionId}.`,
          {
            requiredActionId: details.requiredActionId,
            actionType: details.actionType,
          }
        );
        return;
      }

      await this.recordRunNote(
        "duplicate_required_action_ignored",
        `Ignored duplicate required action ${details.requiredActionId}.`,
        {
          requiredActionId: details.requiredActionId,
          existingStatus: existing.status,
          actionType: details.actionType,
        }
      );
      return;
    }

    await this.append({
      runId: this.request.agentRunId,
      kind: "required_action",
      requiredActionId: details.requiredActionId,
      actionType: details.actionType,
      status: "pending",
      content: details.content,
      data: await this.externalizeRequiredActionData(
        details.requiredActionId,
        details.data
      ),
      source: { type: "system" },
    });

    await this.storage.updateAgentRunStatus(this.request.agentRunId, {
      status: "waiting_for_action",
      summary: "Agent run is waiting for operator action.",
    });
    await this.projectObserveOnlyIncidentActionApproval(details);
  }

  async recordActionResolution(details: {
    requiredActionId: string;
    outcome: Exclude<RequiredActionStatus, "pending">;
    content?: ContentBlock[];
    data?: unknown;
  }): Promise<void> {
    await this.storage.updateRequiredActionStatus(
      this.request.agentRunId,
      details.requiredActionId,
      {
        status: details.outcome,
        resolvedBy: { type: "system" },
      }
    );
    await this.append({
      runId: this.request.agentRunId,
      kind: "action_resolution",
      requiredActionId: details.requiredActionId,
      outcome: details.outcome,
      content: details.content,
      data: details.data,
      source: { type: "system" },
    });
    await this.storage.updateAgentRunStatus(this.request.agentRunId, {
      status: "running",
      authRequired: undefined,
    });
    await this.updateObserveOnlyIncidentActionApproval(details);
    await this.updateObserveOnlyIncidentActivity({
      agentStatus: "running",
      message: "Incident Responder resumed after operator action.",
    });
  }

  private async updateObserveOnlyIncidentActionApproval(details: {
    requiredActionId: string;
    outcome: Exclude<RequiredActionStatus, "pending">;
    data?: unknown;
  }): Promise<void> {
    if (!(await this.isObserveOnlyIncidentAutomation())) {
      return;
    }
    const data = asRecord(details.data);
    const resolvedByUserId = stringFromRecord(data, "resolvedByUserId");
    await this.storage.updateIncidentActionApprovalByRequiredAction(
      this.request.agentRunId,
      details.requiredActionId,
      {
        status: details.outcome,
        resolvedAt: new Date().toISOString(),
        resolvedByUserId,
      }
    );
  }

  async recordRunNote(
    noteType: string,
    message: string,
    data?: unknown
  ): Promise<void> {
    await this.append({
      runId: this.request.agentRunId,
      kind: "run_note",
      noteType,
      message,
      data,
      source: { type: "system" },
    });
  }

  async getConversation(): Promise<Conversation | null> {
    return this.storage.getConversation(this.request.conversationId);
  }

  async getRequiredAction(
    requiredActionId: string
  ): Promise<Extract<RunItem, { kind: "required_action" }> | null> {
    const items = await this.storage.listRunItems(this.request.agentRunId);
    const matching = items.filter(
      (item): item is Extract<RunItem, { kind: "required_action" }> =>
          item.kind === "required_action" &&
          item.requiredActionId === requiredActionId
    );
    return (
      matching.find((item) => item.status === "pending") ??
      matching.at(-1) ??
      null
    );
  }

  async upsertToolApprovalGrant(
    grant: Omit<ToolApprovalGrant, "id" | "grantedAt"> & {
      id?: string;
      grantedAt?: string;
    }
  ): Promise<ToolApprovalGrant | null> {
    return this.storage.upsertConversationToolApprovalGrant(
      this.request.conversationId,
      grant
    );
  }

  async recordToolApprovalGrantUsed(grant: ToolApprovalGrant): Promise<void> {
    await this.recordRunNote(
      "tool_approval_grant_used",
      `Used saved approval: ${grant.approvalLabel}.`,
      {
        toolApprovalGrantId: grant.id,
        toolName: grant.toolName,
        approvalKey: grant.approvalKey,
        approvalLabel: grant.approvalLabel,
        grantedByUserId: grant.grantedByUserId,
      }
    );
  }

  async completeRun(
    summary: string,
    investigation?: AgentRunInvestigationSummary
  ): Promise<void> {
    await this.storage.updateAgentRunStatus(this.request.agentRunId, {
      status: "completed",
      summary: stripThinkingBlocks(summary),
      investigation,
    });
    await this.updateObserveOnlyIncidentActivity({
      agentStatus: "completed",
      message: "Incident Responder completed.",
      title: investigation?.title,
      summary: stripThinkingBlocks(summary),
    });
  }

  async failRun(error: unknown): Promise<void> {
    const message = formatAgentInvocationError(error);
    await this.recordRunNote("agent_invocation_failed", message);
    await this.storage.updateAgentRunStatus(this.request.agentRunId, {
      status: "failed",
      summary: "Agent run failed.",
      errorMessage: message,
    });
    await this.updateObserveOnlyIncidentActivity({
      agentStatus: "failed",
      message: "Incident Responder failed.",
      summary: message,
    });
  }

  private async append(item: AppendRunItemInput): Promise<void> {
    await this.storage.appendRunItems(this.request.agentRunId, [item]);
  }

  private async externalizeRequiredActionData(
    requiredActionId: string,
    data: unknown
  ): Promise<unknown> {
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
      return data;
    }

    const snapshotId = randomUUID();
    await this.storage.createAgentRunSnapshot({
      id: snapshotId,
      runId: this.request.agentRunId,
      requiredActionId,
      provider: "strands",
      kind: "interrupt_resume",
      snapshot: data.resume.snapshot,
    });

    const { snapshot: _snapshot, ...resumeReference } = data.resume;
    return {
      ...data,
      resume: {
        ...resumeReference,
        snapshotId,
      },
    };
  }

  private agentSource(): Extract<AppendRunItemInput["source"], { type: "agent" }> {
    return {
      type: "agent",
      agentRunId: this.request.agentRunId,
      agentKind: this.request.agentKind,
    };
  }

  private async isObserveOnlyIncidentAutomation(): Promise<boolean> {
    const conversation = await this.storage.getConversation(
      this.request.conversationId
    );
    return (
      conversation?.interactionMode === "observe_only" &&
      typeof conversation.incidentId === "string"
    );
  }

  private async updateObserveOnlyIncidentActivity(
    update: Parameters<
      AgentRunLifecycleStorage["updateIncidentActivityByAgentRun"]
    >[1]
  ): Promise<void> {
    if (!(await this.isObserveOnlyIncidentAutomation())) {
      return;
    }
    await this.storage.updateIncidentActivityByAgentRun(
      this.request.agentRunId,
      update
    );
  }

  private async projectObserveOnlyIncidentActionApproval(
    details: Extract<AgentRuntimeStreamEvent, { event: "required_action" }>["data"]
  ): Promise<void> {
    if (
      details.actionType !== "tool_approval" ||
      !(await this.isObserveOnlyIncidentAutomation()) ||
      !this.request.incidentId
    ) {
      return;
    }

    const data = asRecord(details.data);
    const title = stringFromRecord(data, "title") ?? "Approve incident action";
    const summary =
      stringFromRecord(data, "description") ??
      details.content.find((block) => block.type === "text")?.text ??
      "The incident responder needs approval before continuing.";
    const toolName = stringFromRecord(data, "toolName");
    const approval = await this.storage.createIncidentActionApproval({
      incidentId: this.request.incidentId,
      conversationId: this.request.conversationId,
      agentRunId: this.request.agentRunId,
      requiredActionId: details.requiredActionId,
      toolName,
      title,
      summary,
    });
    const activity = await this.storage.createIncidentActivity({
      incidentId: this.request.incidentId,
      kind: "incident_action_approval",
      message: `Incident Responder requested approval: ${title}.`,
      createdBy: {
        actorType: "agent",
        actorId: this.request.agentKind,
        agentRunId: this.request.agentRunId,
      },
      conversationId: this.request.conversationId,
      agentRunId: this.request.agentRunId,
      agentKind: this.request.agentKind,
      agentStatus: "waiting_for_approval",
      incidentActionApprovalId: approval.id,
      title,
      summary,
    });
    await this.storage.updateIncidentActionApprovalStatus(approval.id, {
      status: "pending",
      activityId: activity.id,
    });
    await this.updateObserveOnlyIncidentActivity({
      agentStatus: "waiting_for_approval",
      message: "Incident Responder is waiting for action approval.",
      incidentActionApprovalId: approval.id,
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringFromRecord(
  value: Record<string, unknown> | null,
  key: string
): string | undefined {
  const item = value?.[key];
  return typeof item === "string" ? item : undefined;
}

export function textContent(text: string): ContentBlock[] {
  return [{ type: "text", text }];
}

export function toContentBlocks(value: unknown): ContentBlock[] {
  if (
    Array.isArray(value) &&
    value.every((item): item is ContentBlock => isContentBlock(item))
  ) {
    return value;
  }

  if (typeof value === "string") {
    return textContent(value);
  }

  return [{ type: "json", value }];
}

export function stripThinkingBlocks(value: string): string {
  return value
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<\/?thinking>/gi, "")
    .trim();
}

export function formatAgentInvocationError(error: unknown) {
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

function isContentBlock(value: unknown): value is ContentBlock {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  if (value.type === "text") {
    return "text" in value && typeof value.text === "string";
  }

  if (value.type === "json") {
    return "value" in value;
  }

  if (value.type === "image" || value.type === "file") {
    return "fileId" in value && typeof value.fileId === "string";
  }

  if (value.type === "resource_ref") {
    return (
      "resourceType" in value &&
      typeof value.resourceType === "string" &&
      "resourceId" in value &&
      typeof value.resourceId === "string"
    );
  }

  return false;
}
