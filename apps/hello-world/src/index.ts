import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { Agent, BedrockModel } from "@strands-agents/sdk";
import { fromIni } from "@aws-sdk/credential-providers";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { MemoryHook } from "./memory-hook.js";
import { LocalMemoryHook } from "./local-memory-hook.js";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config({
  quiet: true,
});

const memoryId = process.env.MEMORY_ID;
const sharedAwsConfig = process.env.AWS_PROFILE
  ? {
      credentials: fromIni({
        profile: process.env.AWS_PROFILE,
      }),
    }
  : undefined;

const bedrockAgentCoreClient = memoryId
  ? new BedrockAgentCoreClient({
      region: process.env.AWS_REGION,
      ...sharedAwsConfig,
    })
  : undefined;

const memoryHook =
  memoryId && bedrockAgentCoreClient
    ? new MemoryHook({
        client: bedrockAgentCoreClient,
        memoryId,
      })
    : new LocalMemoryHook();

if (!memoryId) {
  console.warn(
    "MEMORY_ID is not set. Using in-process memory for local development."
  );
}

const bedrockModel = new BedrockModel({
  modelId: "amazon.nova-pro-v1:0",
  clientConfig: sharedAwsConfig,
});
const agentKindSchema = z.enum([
  "ops-copilot",
  "anomaly-investigation",
  "remediation-planner",
  "autonomous-remediation",
]);

const agentRequestSchema = z.object({
  prompt: z.string(),
  agentKind: agentKindSchema.default("ops-copilot"),
  incidentId: z.string().optional(),
  deviceId: z.string().optional(),
});

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: agentRequestSchema,
    process: async function* (request, context) {
      const prompt = request.prompt;
      console.log(`Session ${context.sessionId} - Received prompt:`, prompt);

      memoryHook.setSessionId(context.sessionId);

      const messages = await memoryHook.loadConversation(context.sessionId);

      console.log(
        `Loaded ${messages.length} messages from memory for session ${context.sessionId}`
      );

      const agent = new Agent({
        model: bedrockModel,
        hooks: [memoryHook],
        messages,
      });

      try {
        const enrichedPrompt = buildAgentPrompt(request);
        const result = await agent.invoke(enrichedPrompt);
        yield { event: "message", data: { text: result } };
        yield {
          event: "summary",
          data: buildInvestigationSummary(request, String(result)),
        };
      } catch (error) {
        console.log(error);
      }
    },
  },
});

app.run();

function buildAgentPrompt(request: z.infer<typeof agentRequestSchema>): string {
  const contextLines = [
    `Agent kind: ${request.agentKind}`,
    request.incidentId ? `Incident ID: ${request.incidentId}` : null,
    request.deviceId ? `Device ID: ${request.deviceId}` : null,
    "",
    request.prompt,
  ].filter(Boolean);

  return contextLines.join("\n");
}

function buildInvestigationSummary(
  request: z.infer<typeof agentRequestSchema>,
  result: string
) {
  return {
    title: `${labelForAgentKind(request.agentKind)} summary`,
    summary: truncate(result, 220),
    findings: [
      request.incidentId
        ? `Incident ${request.incidentId} was included in the analysis context.`
        : "No incident id was provided in the request.",
      request.deviceId
        ? `Device ${request.deviceId} was included in the analysis context.`
        : "No device id was provided in the request.",
    ],
    recommendedActions:
      request.agentKind === "autonomous-remediation"
        ? [
            "Verify whether the proposed remediation is allowlisted before execution.",
            "Create or update an incident ticket if the issue remains unresolved.",
          ]
        : [
            "Review the investigation summary in the API response.",
            "Escalate to the remediation planner if an operational change is required.",
          ],
  };
}

function labelForAgentKind(kind: z.infer<typeof agentKindSchema>): string {
  switch (kind) {
    case "ops-copilot":
      return "Ops Copilot";
    case "anomaly-investigation":
      return "Anomaly Investigation";
    case "remediation-planner":
      return "Remediation Planner";
    case "autonomous-remediation":
      return "Autonomous Remediation";
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
