import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { fromIni } from "@aws-sdk/credential-providers";
import { randomUUID } from "crypto";
import { parseArgs } from "util";

const { values } = parseArgs({
  options: {
    "agent-runtime-arn": { type: "string" },
    prompt: { type: "string" },
    profile: { type: "string" },
  },
  strict: true,
});

const agentRuntimeArn = values["agent-runtime-arn"];
const prompt = values.prompt;

if (!agentRuntimeArn || !prompt) {
  console.error(
    "Usage: invoke-agent --agent-runtime-arn <arn> --prompt <prompt> [--profile <aws-profile>]"
  );
  process.exit(1);
}

const client = new BedrockAgentCoreClient({
  region: "us-east-1",
  ...(values.profile && { credentials: fromIni({ profile: values.profile }) }),
});

const command = new InvokeAgentRuntimeCommand({
  agentRuntimeArn,
  runtimeSessionId: randomUUID(),
  payload: JSON.stringify({ prompt }),
  contentType: "application/json",
  qualifier: "DEFAULT",
});

try {
  const response = await client.send(command);
  const textResponse = await response.response?.transformToString();
  console.log("Response:", textResponse);
} catch (error) {
  if (error instanceof Error) {
    console.error(`Error: ${error.name}: ${error.message}`);
  } else {
    console.error("Error:", error);
  }
  process.exit(1);
}
