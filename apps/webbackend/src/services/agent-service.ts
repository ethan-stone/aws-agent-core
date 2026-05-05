import { randomUUID } from "node:crypto";
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { fromIni } from "@aws-sdk/credential-providers";
import type {
  AgentRun,
  AgentRunMessage,
  AgentRunResult,
  AgentRuntimeInvocation,
  AuthenticatedAppUser,
  CreateAgentRunRequest,
} from "../../../../shared/pulseforge-domain/src/index.js";
import {
  completeAgentRun,
  createAgentRun,
  failAgentRun,
  requireAgentRunAuth,
} from "./pulseforge-service.js";

const region = process.env.AWS_REGION ?? "us-east-1";
const isDebugLoggingEnabled =
  process.env.API_LOG_LEVEL === "debug" || process.env.API_LOG_LEVEL === "info";
let client: BedrockAgentCoreClient | null = null;

function getClient(): BedrockAgentCoreClient {
  if (!client) {
    client = new BedrockAgentCoreClient({
      region,
      ...(process.env.AWS_PROFILE
        ? { credentials: fromIni({ profile: process.env.AWS_PROFILE }) }
        : {}),
    });
  }

  return client;
}

export async function runAgent(
  request: CreateAgentRunRequest,
  user?: AuthenticatedAppUser | null
): Promise<AgentRun> {
  const runId = randomUUID();
  const sessionId = request.sessionId ?? `agent-run-${runId}`;
  const runtimeUserId = user?.sub ?? "pulseforge-webbackend";

  const queued = await createAgentRun({
    ...request,
    id: runId,
    sessionId,
    requestedByUserId: user?.sub,
  });

  try {
    const result = await invokeRuntime(request, runId, sessionId, runtimeUserId);
    if (result.authRequired) {
      const authRequired = await requireAgentRunAuth(runId, result.authRequired);
      return authRequired ?? queued;
    }

    const completed = await completeAgentRun(runId, result);
    return completed ?? queued;
  } catch (error) {
    const message = formatAgentInvocationError(error);
    console.error("[agent] invocation failed", {
      runId,
      sessionId,
      agentKind: request.agentKind,
      incidentId: request.incidentId,
      deviceId: request.deviceId,
      runtimeUserId,
      error: message,
    });
    const failed = await failAgentRun(runId, message);
    return failed ?? queued;
  }
}

async function invokeRuntime(
  request: CreateAgentRunRequest,
  runId: string,
  sessionId: string,
  runtimeUserId: string
): Promise<AgentRunResult> {
  const runtimeArn = process.env.AGENT_RUNTIME_ARN;
  const qualifier = process.env.AGENT_RUNTIME_QUALIFIER;
  if (!runtimeArn) {
    throw new Error("AGENT_RUNTIME_ARN is not configured for the API.");
  }
  if (!qualifier) {
    throw new Error("AGENT_RUNTIME_QUALIFIER is not configured for the API.");
  }

  const invocation = buildInvocationPayload(request, runId, runtimeUserId);
  if (isDebugLoggingEnabled) {
    console.info("[agent] invoking aws runtime", {
      runtimeArn,
      qualifier,
      sessionId,
      runtimeUserId,
      agentKind: request.agentKind,
      incidentId: request.incidentId,
      deviceId: request.deviceId,
    });
  }

  const response = await getClient().send(
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn: runtimeArn,
      qualifier,
      contentType: "application/json",
      accept: "text/event-stream",
      runtimeSessionId: sessionId,
      runtimeUserId,
      payload: new TextEncoder().encode(
        JSON.stringify(invocation)
      ),
    })
  );

  const rawText = response.response
    ? await response.response.transformToString()
    : "";

  if (isDebugLoggingEnabled) {
    console.info("[agent] runtime response received", {
      sessionId,
      bytes: rawText.length,
    });
  }

  return parseAgentRuntimeResponse(rawText);
}

function formatAgentInvocationError(error: unknown) {
  if (error instanceof Error) {
    const parts = [error.message];
    const metadata = (error as Error & { $metadata?: { httpStatusCode?: number; requestId?: string } }).$metadata;
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

function buildInvocationPayload(
  request: CreateAgentRunRequest,
  runId: string,
  runtimeUserId: string
): AgentRuntimeInvocation {
  return {
    agentRunId: runId,
    agentKind: request.agentKind,
    prompt: request.prompt,
    incidentId: request.incidentId,
    deviceId: request.deviceId,
    actorId: runtimeUserId,
  };
}

function parseAgentRuntimeResponse(rawText: string): AgentRunResult {
  const events = parseSse(rawText);

  const messages: AgentRunMessage[] = [];
  let summary = "Agent run completed.";
  let investigation: AgentRunResult["investigation"];
  let authRequired: AgentRunResult["authRequired"];

  for (const event of events) {
    const maybeText = asEventText(event.data);
    if (event.event === "message" && maybeText) {
      messages.push({ role: "assistant", content: maybeText });
    }

    if (event.event === "summary" && event.data) {
      const data = event.data as {
        summary?: string;
        title?: string;
        findings?: string[];
        recommendedActions?: string[];
      };
      if (data.summary) {
        summary = data.summary;
      }
      investigation = {
        title: data.title ?? "Investigation summary",
        summary: data.summary ?? summary,
        findings: data.findings ?? [],
        recommendedActions: data.recommendedActions ?? [],
      };
    }

    if (event.event === "auth_required" && event.data) {
      const data = event.data as AgentRunResult["authRequired"];
      if (
        data &&
        typeof data.providerName === "string" &&
        typeof data.authUrl === "string" &&
        Array.isArray(data.scopes) &&
        typeof data.agentRunId === "string"
      ) {
        authRequired = data;
        summary = "Agent run requires delegated tool authorization.";
      }
    }
  }

  if (messages.length === 0) {
    messages.push({ role: "assistant", content: summary });
  }

  return {
    summary,
    messages,
    investigation,
    authRequired,
  };
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

function parseSse(rawText: string): Array<{ event: string; data: unknown }> {
  const chunks = rawText.split(/\n\n+/).map((chunk) => chunk.trim()).filter(Boolean);

  return chunks.map((chunk) => {
    let event = "message";
    const dataLines: string[] = [];

    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }

    const dataText = dataLines.join("\n");
    try {
      return { event, data: JSON.parse(dataText) };
    } catch {
      return { event, data: { text: dataText } };
    }
  });
}
