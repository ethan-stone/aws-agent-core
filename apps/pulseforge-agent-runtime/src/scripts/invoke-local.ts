import { randomUUID } from "node:crypto";

interface CliOptions {
  userId?: string;
  prompt: string;
  agentKind: string;
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
const sessionId = `local-session-${randomUUID()}`;

await invokeLocalAgent(
  { ...options, userId },
  conversationId,
  agentRunId,
  sessionId
);

async function invokeLocalAgent(
  options: CliOptions & { userId: string },
  conversationId: string,
  agentRunId: string,
  sessionId: string
) {
  console.log("[agent:invoke:local] invoking local runtime", {
    baseUrl: options.baseUrl,
    conversationId,
    agentRunId,
    sessionId,
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
      "x-amzn-bedrock-agentcore-runtime-session-id": sessionId,
      "x-amzn-bedrock-agentcore-runtime-custom-user-id": options.userId,
    },
    body: JSON.stringify({
      version: "2026-05-28",
      operation: "start_agent_run",
      conversationId,
      agentRunId,
      providerSessionId: sessionId,
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
        options.agentKind = next;
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

function printHelp() {
  console.log(`Invoke the local PulseForge AgentCore runtime.

Required:
  --user-id <cognito-sub>        Cognito user id to pass as the runtime actor and local AgentCore custom user header.

Optional:
  --prompt <text>                Prompt to send. Defaults to "Investigate incident inc-1001".
  --agent-kind <kind>            Defaults to ops-copilot.
  --incident-id <id>             Incident id to include.
  --device-id <id>               Device id to include.
  --base-url <url>               Runtime URL. Defaults to http://localhost:8080.

Example:
  pnpm agent:invoke:local -- --user-id 34885428-1061-702c-4d76-9b3d38ed26e7 --incident-id inc-1001
`);
}
