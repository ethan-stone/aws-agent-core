import type {
  AgentRun,
  AgentRunAuthRequired,
  AgentRunInvestigationSummary,
  AgentRuntimeStreamEvent,
  ContentBlock,
} from "../../../../shared/pulseforge-domain/src/index.js";
import type { AppendRunItemInput } from "../../../../shared/pulseforge-backend/src/index.js";

export type AgentRuntimeSseEvent =
  | AgentRuntimeStreamEvent
  | { event: string; data: unknown };

export interface ParsedRuntimeResponse {
  summary: string;
  investigation?: AgentRunInvestigationSummary;
  authRequired?: AgentRunAuthRequired;
  items: AppendRunItemInput[];
  hasCompletedOutput: boolean;
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
    const data = normalizeRuntimeEventData(event.data);
    const maybeText = asEventText(data);
    if (event.event === "message" && maybeText) {
      items.push(agentMessageItem(run, textContent(stripThinkingBlocks(maybeText))));
      authRequired = undefined;
    }

    if (event.event === "summary" && data) {
      const summaryData = data as {
        summary?: string;
        title?: string;
        findings?: string[];
        recommendedActions?: string[];
      };
      if (summaryData.summary) {
        summary = stripThinkingBlocks(summaryData.summary);
      }
      investigation = {
        title: stripThinkingBlocks(summaryData.title ?? "Investigation summary"),
        summary: stripThinkingBlocks(summaryData.summary ?? summary),
        findings: (summaryData.findings ?? []).map(stripThinkingBlocks),
        recommendedActions: (summaryData.recommendedActions ?? []).map(
          stripThinkingBlocks
        ),
      };
      authRequired = undefined;
    }

    if (event.event === "auth_required" && isAuthRequiredData(data)) {
      const requiredActionId =
        data.requiredActionId ?? `auth:${run.id}:${items.length}`;
      authRequired = {
        ...data,
        agentRunId: run.id,
      };
      items.push({
        runId: run.id,
        kind: "required_action",
        requiredActionId,
        actionType: "auth_required",
        status: "pending",
        source: { type: "system" },
        content: [
          {
            type: "text",
            text: `Authorization required for ${data.providerDisplayName ?? data.providerName}.`,
          },
        ],
        data: {
          type: "auth_required",
          providerName: data.providerName,
          providerDisplayName: data.providerDisplayName,
          authUrl: data.authUrl,
          scopes: data.scopes,
          agentRunId: run.id,
        },
      });
      summary = "Agent run requires delegated tool authorization.";
    }

    if (event.event === "tool_call" && isToolCallData(data)) {
      items.push({
        runId: run.id,
        kind: "tool_call",
        toolCallId: data.toolCallId,
        toolName: data.toolName,
        arguments: data.arguments,
        status: data.status ?? "pending",
        source: { type: "agent", agentRunId: run.id, agentKind: run.agentKind },
      });
    }

    if (event.event === "tool_result" && isToolResultData(data)) {
      completeToolCall(
        items,
        data.toolCallId,
        data.isError ? "failed" : "succeeded"
      );
      items.push({
        runId: run.id,
        kind: "tool_result",
        toolCallId: data.toolCallId,
        content: toContentBlocks(data.content),
        isError: data.isError,
        source: {
          type: "tool",
          toolName: data.toolName ?? "unknown_tool",
        },
      });
    }

    if (event.event === "required_action" && isRequiredActionData(data)) {
      items.push({
        runId: run.id,
        kind: "required_action",
        requiredActionId: data.requiredActionId,
        actionType: data.actionType,
        status: "pending",
        content: data.content,
        data: data.data ?? { type: data.actionType },
        source: { type: "system" },
      });
    }

    if (event.event === "action_resolution" && isActionResolutionData(data)) {
      resolveRequiredAction(items, data.requiredActionId, data.outcome);
      authRequired = undefined;
      items.push({
        runId: run.id,
        kind: "action_resolution",
        requiredActionId: data.requiredActionId,
        outcome: data.outcome,
        content: data.content,
        data: data.data,
        source: { type: "system" },
      });
    }

    if (event.event === "run_agent" && isRunAgentData(data)) {
      items.push({
        runId: run.id,
        kind: "run_agent",
        relationship: data.relationship,
        agentKind: data.agentKind,
        childRunId: data.childRunId,
        toolCallId: data.toolCallId,
        status: data.status,
        source: { type: "agent", agentRunId: run.id, agentKind: run.agentKind },
      });
    }

    if (event.event === "run_note" && isRunNoteData(data)) {
      items.push({
        runId: run.id,
        kind: "run_note",
        noteType: data.noteType,
        message: data.message,
        data: data.data,
        source: { type: "system" },
      });
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

function toContentBlocks(value: unknown): ContentBlock[] {
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

function normalizeRuntimeEventData(data: unknown): unknown {
  let current = data;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (typeof current !== "string") {
      return current;
    }

    try {
      current = JSON.parse(current);
    } catch {
      return current;
    }
  }

  return current;
}

function completeToolCall(
  items: AppendRunItemInput[],
  toolCallId: string,
  status: "succeeded" | "failed"
): void {
  const toolCall = items.find(
    (item): item is Extract<AppendRunItemInput, { kind: "tool_call" }> =>
      item.kind === "tool_call" && item.toolCallId === toolCallId
  );
  if (toolCall) {
    toolCall.status = status;
  }
}

function resolveRequiredAction(
  items: AppendRunItemInput[],
  requiredActionId: string,
  status: "resolved" | "declined" | "expired" | "cancelled"
): void {
  const requiredAction = items.find(
    (item): item is Extract<AppendRunItemInput, { kind: "required_action" }> =>
      item.kind === "required_action" &&
      item.requiredActionId === requiredActionId
  );

  if (!requiredAction) {
    return;
  }

  requiredAction.status = status;
  requiredAction.resolvedAt = new Date().toISOString();
  requiredAction.resolvedBy = { type: "system" };
}

function stripThinkingBlocks(value: string): string {
  return value
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<\/?thinking>/gi, "")
    .trim();
}

function isAuthRequiredData(
  data: unknown
): data is AgentRunAuthRequired & { requiredActionId?: string } {
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

function isToolCallData(data: unknown): data is Extract<
  AgentRuntimeStreamEvent,
  { event: "tool_call" }
>["data"] {
  return (
    typeof data === "object" &&
    data !== null &&
    "toolCallId" in data &&
    typeof data.toolCallId === "string" &&
    "toolName" in data &&
    typeof data.toolName === "string"
  );
}

function isToolResultData(data: unknown): data is Extract<
  AgentRuntimeStreamEvent,
  { event: "tool_result" }
>["data"] {
  return (
    typeof data === "object" &&
    data !== null &&
    "toolCallId" in data &&
    typeof data.toolCallId === "string" &&
    "content" in data
  );
}

function isRequiredActionData(data: unknown): data is Extract<
  AgentRuntimeStreamEvent,
  { event: "required_action" }
>["data"] {
  return (
    typeof data === "object" &&
    data !== null &&
    "requiredActionId" in data &&
    typeof data.requiredActionId === "string" &&
    "actionType" in data &&
    typeof data.actionType === "string" &&
    "content" in data &&
    Array.isArray(data.content) &&
    data.content.every((item) => isContentBlock(item))
  );
}

function isActionResolutionData(data: unknown): data is Extract<
  AgentRuntimeStreamEvent,
  { event: "action_resolution" }
>["data"] {
  return (
    typeof data === "object" &&
    data !== null &&
    "requiredActionId" in data &&
    typeof data.requiredActionId === "string" &&
    "outcome" in data &&
    isRequiredActionOutcome(data.outcome)
  );
}

function isRunNoteData(data: unknown): data is Extract<
  AgentRuntimeStreamEvent,
  { event: "run_note" }
>["data"] {
  return (
    typeof data === "object" &&
    data !== null &&
    "noteType" in data &&
    typeof data.noteType === "string" &&
    "message" in data &&
    typeof data.message === "string"
  );
}

function isRunAgentData(data: unknown): data is Extract<
  AgentRuntimeStreamEvent,
  { event: "run_agent" }
>["data"] {
  return (
    typeof data === "object" &&
    data !== null &&
    "relationship" in data &&
    typeof data.relationship === "string" &&
    data.relationship !== "root" &&
    "agentKind" in data &&
    isAgentKind(data.agentKind) &&
    "childRunId" in data &&
    typeof data.childRunId === "string" &&
    "status" in data &&
    isAgentRunStatus(data.status)
  );
}

function isAgentKind(value: unknown): value is AgentRun["agentKind"] {
  return (
    value === "ops-copilot" ||
    value === "anomaly-investigation" ||
    value === "remediation-planner" ||
    value === "autonomous-remediation"
  );
}

function isAgentRunStatus(value: unknown): value is AgentRun["status"] {
  return (
    value === "queued" ||
    value === "running" ||
    value === "auth_required" ||
    value === "waiting_for_action" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
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

function isRequiredActionOutcome(
  value: unknown
): value is Exclude<
  Extract<AgentRuntimeStreamEvent, { event: "action_resolution" }>["data"]["outcome"],
  undefined
> {
  return (
    value === "resolved" ||
    value === "declined" ||
    value === "expired" ||
    value === "cancelled"
  );
}
