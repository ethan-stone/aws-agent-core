import { randomUUID } from "crypto";
import { parseArgs } from "util";

const { values } = parseArgs({
  options: {
    prompt: { type: "string" },
    "session-id": { type: "string" },
    port: { type: "string" },
    "workload-access-token": { type: "string" },
    "oauth2-callback-url": { type: "string" },
  },
  strict: true,
});

const prompt = values.prompt;
if (!prompt) {
  console.error(
    "Usage: invoke-local-agent --prompt <prompt> [--session-id <id>] [--port <port>] [--workload-access-token <token>] [--oauth2-callback-url <url>]"
  );
  process.exit(1);
}

const sessionId = values["session-id"] ?? randomUUID();
const port = values.port ?? "8080";
const url = `http://127.0.0.1:${port}/invocations`;

const headers: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "text/event-stream",
  "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
};

if (values["workload-access-token"]) {
  headers.WorkloadAccessToken = values["workload-access-token"];
}

if (values["oauth2-callback-url"]) {
  headers.OAuth2CallbackUrl = values["oauth2-callback-url"];
}

try {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    console.error(`Error: ${response.status} ${response.statusText}`);
    console.error(await response.text());
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
    if (done) {
      break;
    }

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
