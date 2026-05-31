import "../load-env.js";
import { randomUUID } from "node:crypto";
import type { AgentKind } from "../../../../shared/pulseforge-domain/src/index.js";
import {
  appendRunItems,
  createAgentRun,
  createConversation,
  createRuntimeSession,
} from "../../../../shared/pulseforge-backend/src/index.js";

interface CliOptions {
  userId?: string;
  prompt: string;
  agentKind: AgentKind;
  incidentId?: string;
  deviceId?: string;
  baseUrl: string;
}

const options = parseArgs(process.argv.slice(2).filter((arg) => arg !== "--"));

if (!options.userId) {
  console.error(
    "Missing required --user-id. Example: pnpm agent:invoke:local -- --user-id <cognito-sub> --incident-id inc-1001"
  );
  process.exit(1);
}

const userId = options.userId;
const conversationId = `local-conversation-${randomUUID()}`;
const agentRunId = `local-agent-run-${randomUUID()}`;
const runtimeSessionId = `local-runtime-session-${randomUUID()}`;
const providerSessionId = `local-provider-session-${randomUUID()}`;

await invokeLocalAgent(
  { ...options, userId },
  conversationId,
  agentRunId,
  runtimeSessionId,
  providerSessionId
);

async function invokeLocalAgent(
  options: CliOptions & { userId: string },
  conversationId: string,
  agentRunId: string,
  runtimeSessionId: string,
  providerSessionId: string
) {
  await createLocalLifecycleRecords({
    options,
    conversationId,
    agentRunId,
    runtimeSessionId,
    providerSessionId,
  });

  console.log("[agent:invoke:local] invoking local runtime", {
    baseUrl: options.baseUrl,
    conversationId,
    agentRunId,
    runtimeSessionId,
    providerSessionId,
    userId: options.userId,
    agentKind: options.agentKind,
    incidentId: options.incidentId,
    deviceId: options.deviceId,
  });

  const response = await fetch(new URL("/invocations", options.baseUrl), {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json",
      "x-amzn-bedrock-agentcore-runtime-session-id": providerSessionId,
      "x-amzn-bedrock-agentcore-runtime-custom-user-id": options.userId,
    },
    body: JSON.stringify({
      version: "2026-05-28",
      operation: "start_agent_run",
      conversationId,
      agentRunId,
      runtimeSessionId,
      providerSessionId,
      agentKind: options.agentKind,
      actor: { type: "user", userId: options.userId },
      trigger: {
        type: "operator_prompt",
        prompt: options.prompt,
        incidentId: options.incidentId,
        deviceId: options.deviceId,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Runtime returned HTTP ${response.status}: ${body}`);
  }

  if (!response.body) {
    throw new Error("Runtime response did not include a readable body.");
  }

  await printSseStream(response.body);
}

async function createLocalLifecycleRecords(details: {
  options: CliOptions & { userId: string };
  conversationId: string;
  agentRunId: string;
  runtimeSessionId: string;
  providerSessionId: string;
}) {
  if (!process.env.MONGODB_URI) {
    throw new Error(
      "Local direct runtime invocation requires MONGODB_URI so this script and the running runtime share lifecycle records. Start MongoDB and run with the same .env.local as the runtime, or invoke through the web backend instead."
    );
  }
  if (details.options.agentKind !== "ops-copilot") {
    throw new Error(
      "agent:invoke:local sends an operator_prompt trigger and currently only supports --agent-kind ops-copilot."
    );
  }

  await createConversation({
    id: details.conversationId,
    rootAgentKind: details.options.agentKind,
  });
  await createRuntimeSession({
    id: details.runtimeSessionId,
    provider: "aws-agentcore",
    runtimeIdentity: "local-runtime",
    providerSessionId: details.providerSessionId,
    conversationId: details.conversationId,
    status: "active",
  });
  await createAgentRun({
    id: details.agentRunId,
    conversationId: details.conversationId,
    incidentId: details.options.incidentId,
    deviceId: details.options.deviceId,
    runtimeSessionId: details.runtimeSessionId,
    agentKind: details.options.agentKind,
    relationship: "root",
    status: "running",
    requestedByUserId: details.options.userId,
  });
  await appendRunItems(details.agentRunId, [
    {
      runId: details.agentRunId,
      kind: "message",
      role: "user",
      source: { type: "user", userId: details.options.userId },
      content: [{ type: "text", text: details.options.prompt }],
    },
  ]);
}

async function printSseStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\n\n+/);
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      printSseChunk(chunk);
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    printSseChunk(buffer);
  }
}

function printSseChunk(chunk: string) {
  const lines = chunk.split(/\r?\n/);
  const event =
    lines
      .find((line) => line.startsWith("event:"))
      ?.slice("event:".length)
      .trim() ?? "message";
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n");

  if (!data) {
    return;
  }

  try {
    console.log(`[${event}]`, JSON.stringify(JSON.parse(data), null, 2));
  } catch {
    console.log(`[${event}]`, data);
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    prompt: "Investigate incident inc-1001",
    agentKind: "ops-copilot",
    baseUrl: "http://localhost:8080",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    index += 1;

    switch (arg) {
      case "--user-id":
        options.userId = next;
        break;
      case "--prompt":
        options.prompt = next;
        break;
      case "--agent-kind":
        options.agentKind = parseAgentKind(next);
        break;
      case "--incident-id":
        options.incidentId = next;
        break;
      case "--device-id":
        options.deviceId = next;
        break;
      case "--base-url":
        options.baseUrl = next;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function parseAgentKind(value: string): AgentKind {
  if (value === "ops-copilot" || value === "incident-responder") {
    return value;
  }
  throw new Error(`Unsupported agent kind: ${value}`);
}

function printHelp() {
  console.log(`Invoke the local PulseForge AgentCore runtime.

This direct-runtime smoke path creates matching Conversation, AgentRun, and
RuntimeSession records before invocation. It requires MONGODB_URI so this script
and the running runtime share the same lifecycle store.

Required:
  --user-id <cognito-sub>        Cognito user id to pass as the runtime actor and local AgentCore custom user header.

Optional:
  --prompt <text>                Prompt to send. Defaults to "Investigate incident inc-1001".
  --agent-kind <kind>            Defaults to ops-copilot. Only ops-copilot is supported by this prompt-based local path.
  --incident-id <id>             Incident id to include.
  --device-id <id>               Device id to include.
  --base-url <url>               Runtime URL. Defaults to http://localhost:8080.

Example:
  pnpm agent:invoke:local -- --user-id 34885428-1061-702c-4d76-9b3d38ed26e7 --incident-id inc-1001
`);
}
