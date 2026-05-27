import { randomUUID } from "node:crypto";
import type {
  AgentRunAuthRequired,
  AgentRunInvestigationSummary,
  AgentRuntimeStreamEvent,
  AgentRuntimeInvocation,
  ContentBlock,
  RequiredActionStatus,
  RunItem,
} from "../../../shared/pulseforge-domain/src/index.js";
import {
  appendRunItems,
  createAgentRunSnapshot,
  updateAgentRunStatus,
  updateRequiredActionStatus,
  updateToolCallStatus,
  type AppendRunItemInput,
} from "../../../shared/pulseforge-backend/src/index.js";

export interface AgentRunLifecycleStorage {
  appendRunItems(
    runId: string,
    items: AppendRunItemInput[]
  ): Promise<RunItem[]>;
  createAgentRunSnapshot: typeof createAgentRunSnapshot;
  updateAgentRunStatus: typeof updateAgentRunStatus;
  updateRequiredActionStatus: typeof updateRequiredActionStatus;
  updateToolCallStatus: typeof updateToolCallStatus;
}

const defaultStorage: AgentRunLifecycleStorage = {
  appendRunItems,
  createAgentRunSnapshot,
  updateAgentRunStatus,
  updateRequiredActionStatus,
  updateToolCallStatus,
};

export class AgentRunLifecycle {
  constructor(
    private readonly request: AgentRuntimeInvocation,
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
  }

  async recordRequiredAction(
    details: Extract<AgentRuntimeStreamEvent, { event: "required_action" }>["data"]
  ): Promise<void> {
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

  async completeRun(
    summary: string,
    investigation?: AgentRunInvestigationSummary
  ): Promise<void> {
    await this.storage.updateAgentRunStatus(this.request.agentRunId, {
      status: "completed",
      summary: stripThinkingBlocks(summary),
      investigation,
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
