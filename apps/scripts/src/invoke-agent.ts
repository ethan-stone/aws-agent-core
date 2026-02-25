import { randomUUID } from "crypto";
import { parseArgs } from "util";

const ENDPOINT_URL =
  process.env.BEDROCK_AGENT_CORE_ENDPOINT_URL ??
  "https://bedrock-agentcore.us-east-1.amazonaws.com";

const { values } = parseArgs({
  options: {
    "agent-runtime-arn": { type: "string" },
    prompt: { type: "string" },
    token: { type: "string" },
    "session-id": { type: "string" },
  },
  strict: true,
});

const agentRuntimeArn = values["agent-runtime-arn"];
const prompt = values.prompt;
const token = values.token;

if (!agentRuntimeArn || !prompt || !token) {
  console.error(
    "Usage: invoke-agent --agent-runtime-arn <arn> --prompt <prompt> --token <cognito-access-token> [--session-id <id>]"
  );
  process.exit(1);
}

const escapedArn = encodeURIComponent(agentRuntimeArn);
const sessionId = values["session-id"] ?? randomUUID();
const url = `${ENDPOINT_URL}/runtimes/${escapedArn}/invocations?qualifier=DEFAULT`;

try {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
    },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Error: ${response.status} ${response.statusText}`);
    console.error(body);
    process.exit(1);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    console.error("Error: no response body");
    process.exit(1);
  }

  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    process.stdout.write(decoder.decode(value, { stream: true }));
  }
  process.stdout.write("\n");
} catch (error) {
  if (error instanceof Error) {
    console.error(`Error: ${error.name}: ${error.message}`);
  } else {
    console.error("Error:", error);
  }
  process.exit(1);
}
