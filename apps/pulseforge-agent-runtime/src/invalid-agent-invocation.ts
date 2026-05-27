import { z } from "zod";
import type { AgentRunInvestigationSummary } from "../../../shared/pulseforge-domain/src/index.js";
import {
  appendRunItems,
  updateAgentRunStatus,
  type AppendRunItemInput,
} from "../../../shared/pulseforge-backend/src/index.js";

interface RuntimeSseChunk {
  event: string;
  data: unknown;
}

interface InvalidInvocationStorage {
  appendRunItems: typeof appendRunItems;
  updateAgentRunStatus: typeof updateAgentRunStatus;
}

const defaultInvalidInvocationStorage: InvalidInvocationStorage = {
  appendRunItems,
  updateAgentRunStatus,
};

export async function* runInvalidAgentInvocation(
  error: z.ZodError,
  payload?: unknown,
  storage: InvalidInvocationStorage = defaultInvalidInvocationStorage
): AsyncGenerator<RuntimeSseChunk> {
  const issues = error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  const message = `Invalid agent runtime payload: ${formatInvalidInvocationIssues(
    issues
  )}`;
  const investigation = buildInvalidInvocationInvestigation(issues);

  console.warn("[agent] invalid invocation payload", { issues });
  await persistInvalidInvocationFailure(payload, message, investigation, storage);

  yield toRuntimeSseChunk({
    event: "message",
    data: { text: message },
  });
  yield toRuntimeSseChunk({
    event: "summary",
    data: investigation,
  });
}

async function persistInvalidInvocationFailure(
  payload: unknown,
  message: string,
  investigation: AgentRunInvestigationSummary,
  storage: InvalidInvocationStorage
): Promise<void> {
  const agentRunId = getPayloadString(payload, "agentRunId");
  if (!agentRunId) {
    return;
  }

  try {
    const item: AppendRunItemInput = {
      runId: agentRunId,
      kind: "message",
      role: "system",
      source: { type: "system" },
      content: [{ type: "text", text: message }],
    };
    await storage.appendRunItems(agentRunId, [item]);
    await storage.updateAgentRunStatus(agentRunId, {
      status: "failed",
      summary: investigation.summary,
      investigation,
      errorMessage: message,
    });
  } catch (persistError) {
    console.warn("[agent] failed to persist invalid invocation", {
      agentRunId,
      error: persistError,
    });
  }
}

function getPayloadString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null || !(key in payload)) {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function buildInvalidInvocationInvestigation(
  issues: Array<{ path: string; message: string }>
): AgentRunInvestigationSummary {
  return {
    title: "Invalid runtime payload",
    summary:
      "The runtime request did not match the expected agent invocation shape.",
    findings: issues.map(
      (issue) => `${issue.path || "<root>"}: ${issue.message}`
    ),
    recommendedActions: [
      "Invoke with conversationId, agentRunId, prompt, agentKind, and optional incident/device ids.",
    ],
  };
}

function formatInvalidInvocationIssues(
  issues: Array<{ path: string; message: string }>
): string {
  return issues
    .map((issue) => `${issue.path || "<root>"} ${issue.message}`)
    .join("; ");
}

function toRuntimeSseChunk(event: {
  event: string;
  data: unknown;
}): RuntimeSseChunk {
  return {
    event: event.event,
    data: event.data,
  };
}
