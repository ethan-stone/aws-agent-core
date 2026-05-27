import "./load-env.js";
import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { BedrockModel } from "@strands-agents/sdk";
import { fromIni } from "@aws-sdk/credential-providers";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { AgentMemoryProjection } from "./agent-memory-projection.js";
import {
  agentRuntimeRequestSchema,
  runPulseForgeAgentInvocation,
} from "./agent-invocation.js";
import { runInvalidAgentInvocation } from "./invalid-agent-invocation.js";
import { loadRuntimeConfig } from "./runtime-config.js";

const runtimeConfig = loadRuntimeConfig();
const memoryId = runtimeConfig.memoryId;
const sharedAwsConfig = runtimeConfig.awsProfile
  ? {
    credentials: fromIni({
      profile: runtimeConfig.awsProfile,
    }),
  }
  : undefined;

const bedrockAgentCoreClient = memoryId
  ? new BedrockAgentCoreClient({
    region: runtimeConfig.awsRegion,
    ...sharedAwsConfig,
  })
  : undefined;
const workloadTokenClient = new BedrockAgentCoreClient({
  region: runtimeConfig.awsRegion,
  ...sharedAwsConfig,
});

if (!memoryId) {
  console.warn(
    "MEMORY_ID is not set. Using in-process memory for local development."
  );
}
if (!runtimeConfig.tools.enabled) {
  console.warn(`[tools] disabled: ${runtimeConfig.tools.reason}`);
} else {
  console.info("[tools] enabled", {
    backendUrl: runtimeConfig.tools.backendUrl,
    authMode: runtimeConfig.tools.authMode,
    providerName: runtimeConfig.tools.providerName,
  });
}

const bedrockModel = new BedrockModel({
  modelId: "amazon.nova-pro-v1:0",
  clientConfig: sharedAwsConfig,
});
const memoryProjection = new AgentMemoryProjection({
  runtimeConfig,
  memoryClient: bedrockAgentCoreClient,
});

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    process: async function* (rawRequest, context) {
      const normalizedRequest = normalizeInvocationPayload(rawRequest);
      const parsedRequest =
        agentRuntimeRequestSchema.safeParse(normalizedRequest);
      if (!parsedRequest.success) {
        yield* runInvalidAgentInvocation(parsedRequest.error, normalizedRequest);
        return;
      }

      console.log(
        `Session ${context.sessionId} - Received prompt:`,
        parsedRequest.data.prompt
      );
      yield* runPulseForgeAgentInvocation(parsedRequest.data, context, {
        model: bedrockModel,
        runtimeConfig,
        memoryProjection,
        workloadTokenClient,
      });
    },
  },
});

app.run();

function normalizeInvocationPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  if ("request_payload" in value) {
    const requestPayload = value.request_payload;
    if (requestPayload && typeof requestPayload === "object" && "body" in requestPayload) {
      return requestPayload.body;
    }
    return requestPayload;
  }

  if ("body" in value) {
    const body = value.body;
    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    }
    return body;
  }

  return value;
}
