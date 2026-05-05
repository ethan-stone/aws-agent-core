import "./load-env.js";
import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import {
  Agent,
  BedrockModel,
  SlidingWindowConversationManager,
} from "@strands-agents/sdk";
import { fromIni } from "@aws-sdk/credential-providers";
import {
  BedrockAgentCoreClient,
  GetWorkloadAccessTokenForUserIdCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { withAccessToken } from "bedrock-agentcore/identity";
import {
  createPulseForgeStrandsTools,
  ToolAuthorizationRequiredError,
  type ToolAccessTokenConfig,
  type ToolCredentialProvider,
} from "../../../shared/pulseforge-tools/src/index.js";
import {
  AgentCoreLongTermMemoryPlugin,
  type RetrievalConfigMap,
} from "./agentcore-long-term-memory-plugin.js";
import {
  AgentCoreEventSessionStore,
  InMemoryShortTermMemoryStore,
  type ShortTermMemoryStore,
} from "./short-term-memory-store.js";
import { loadRuntimeConfig } from "./runtime-config.js";
import { z } from "zod";

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

const localShortTermMemoryStore = new InMemoryShortTermMemoryStore();
const longTermRetrievalConfig = getLongTermRetrievalConfig();

if (!memoryId) {
  console.warn(
    "MEMORY_ID is not set. Using in-process memory for local development."
  );
}
if (!runtimeConfig.tools.enabled) {
  console.warn(`[tools] disabled: ${runtimeConfig.tools.reason}`);
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
  agentRunId: z.string(),
  prompt: z.string(),
  agentKind: agentKindSchema.default("ops-copilot"),
  incidentId: z.string().optional(),
  deviceId: z.string().optional(),
  actorId: z.string().optional(),
});

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: agentRequestSchema,
    process: async function* (request, context) {
      const prompt = request.prompt;
      console.log(`Session ${context.sessionId} - Received prompt:`, prompt);

      const actorId = request.actorId ?? context.sessionId;
      const shortTermMemoryStore = createShortTermMemoryStore(actorId);
      const initialMessages = await loadSessionMessages(
        shortTermMemoryStore,
        context.sessionId,
        actorId
      );

      const plugins =
        memoryId && bedrockAgentCoreClient
          ? [
              new AgentCoreLongTermMemoryPlugin({
                client: bedrockAgentCoreClient,
                memoryId,
                actorId,
                sessionId: context.sessionId,
                retrievalConfig: longTermRetrievalConfig,
                contextTag: runtimeConfig.longTermMemoryContextTag,
              }),
            ]
          : [];
      const tools = await createAgentTools(request, context);

      const agent = new Agent({
        model: bedrockModel,
        id: agentIdForKind(request.agentKind),
        name: labelForAgentKind(request.agentKind),
        systemPrompt: systemPromptForAgentKind(request.agentKind),
        messages: initialMessages,
        tools,
        conversationManager: new SlidingWindowConversationManager({
          windowSize: 40,
        }),
        plugins,
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
        if (error instanceof ToolAuthorizationRequiredError) {
          yield {
            event: "auth_required",
            data: {
              providerName: error.providerName,
              authUrl: error.authUrl,
              scopes: error.scopes,
              agentRunId: error.agentRunId,
            },
          };
          return;
        }

        console.log(error);
      } finally {
        await persistSessionMessages(
          shortTermMemoryStore,
          context.sessionId,
          actorId,
          agent.messages
        );
      }
    },
  },
});

app.run();

function getLongTermRetrievalConfig(): RetrievalConfigMap {
  if (!runtimeConfig.longTermMemoryEnabled) {
    return {};
  }

  return {
    "/preferences/{actorId}/": {
      topK: 5,
      relevanceScore: 0.7,
    },
    "/facts/{actorId}/": {
      topK: 10,
      relevanceScore: 0.3,
    },
    "/summaries/{actorId}/{sessionId}/": {
      topK: 5,
      relevanceScore: 0.5,
    },
  };
}

function createShortTermMemoryStore(actorId: string): ShortTermMemoryStore {
  if (memoryId && bedrockAgentCoreClient) {
    return new AgentCoreEventSessionStore({
      client: bedrockAgentCoreClient,
      memoryId,
      actorId,
    });
  }

  return localShortTermMemoryStore;
}

async function loadSessionMessages(
  store: ShortTermMemoryStore,
  sessionId: string,
  actorId: string
) {
  try {
    return await store.loadMessages(sessionId);
  } catch (error) {
    console.error("[memory] failed to load session messages", {
      sessionId,
      actorId,
      error,
    });
    return [];
  }
}

async function persistSessionMessages(
  store: ShortTermMemoryStore,
  sessionId: string,
  actorId: string,
  messages: Agent["messages"]
) {
  try {
    await store.saveMessages(sessionId, messages);
  } catch (error) {
    console.error("[memory] failed to persist session messages", {
      sessionId,
      actorId,
      error,
    });
  }
}

function agentIdForKind(kind: z.infer<typeof agentKindSchema>) {
  return `pulseforge-${kind}`;
}

function buildAgentPrompt(request: z.infer<typeof agentRequestSchema>): string {
  const contextLines = [
    `Agent kind: ${request.agentKind}`,
    `Agent run ID: ${request.agentRunId}`,
    request.incidentId ? `Incident ID: ${request.incidentId}` : null,
    request.deviceId ? `Device ID: ${request.deviceId}` : null,
    "",
    request.prompt,
    "",
    "Return a concise operator-ready response. Use available tools to gather operational evidence when IDs are provided.",
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
    findings: [],
    recommendedActions: [],
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

function systemPromptForAgentKind(kind: z.infer<typeof agentKindSchema>): string {
  switch (kind) {
    case "ops-copilot":
      return [
        "You are PulseForge Ops Copilot, an IoT operations assistant for device monitoring and incident response.",
        "Investigate user requests using available operational tools, ground conclusions in retrieved data, and keep responses concise enough for an on-call operator.",
        "When you create records, make the audit trail understandable: explain what you changed, why, and what remains uncertain.",
      ].join("\n");
    case "anomaly-investigation":
      return [
        "You are PulseForge Anomaly Investigation Agent.",
        "Analyze telemetry and incident patterns, identify likely contributing factors, and separate evidence from hypotheses.",
      ].join("\n");
    case "remediation-planner":
      return [
        "You are PulseForge Remediation Planner.",
        "Propose safe, reviewable remediation plans with risk notes and clear prerequisites before any operational change.",
      ].join("\n");
    case "autonomous-remediation":
      return [
        "You are PulseForge Autonomous Remediation Agent.",
        "Prefer safe, reversible actions, document all action attempts, and stop when confidence or authorization is insufficient.",
      ].join("\n");
  }
}

async function createAgentTools(
  request: z.infer<typeof agentRequestSchema>,
  context: { headers: Record<string, string>; workloadAccessToken?: string }
) {
  if (request.agentKind !== "ops-copilot") {
    return [];
  }

  if (!runtimeConfig.tools.enabled) {
    return [];
  }

  const credentialProvider = await createToolCredentialProvider(request, context);
  return createPulseForgeStrandsTools(request.agentKind, {
    backendUrl: runtimeConfig.tools.backendUrl,
    agentRunId: request.agentRunId,
    providerName: runtimeConfig.tools.providerName,
    credentialProvider,
  });
}

async function createToolCredentialProvider(
  request: z.infer<typeof agentRequestSchema>,
  context: { headers: Record<string, string>; workloadAccessToken?: string }
): Promise<ToolCredentialProvider> {
  if (!runtimeConfig.tools.enabled) {
    throw new Error("PulseForge tools are not configured.");
  }

  if (runtimeConfig.tools.authMode === "agentcore-runtime") {
    return new AgentCoreIdentityCredentialProvider(context.workloadAccessToken);
  }

  const userId =
    context.headers["x-amzn-bedrock-agentcore-runtime-custom-user-id"] ??
    runtimeConfig.tools.localUserId ??
    request.actorId;

  if (!userId) {
    throw new Error(
      "PULSEFORGE_TOOL_AUTH_MODE=local-user-id requires x-amzn-bedrock-agentcore-runtime-custom-user-id, PULSEFORGE_LOCAL_USER_ID, or actorId."
    );
  }

  const response = await workloadTokenClient.send(
    new GetWorkloadAccessTokenForUserIdCommand({
      workloadName: runtimeConfig.tools.workloadName,
      userId,
    })
  );

  if (!response.workloadAccessToken) {
    throw new Error("AgentCore did not return a workload access token.");
  }

  return new AgentCoreIdentityCredentialProvider(response.workloadAccessToken);
}

class AgentCoreIdentityCredentialProvider implements ToolCredentialProvider {
  constructor(private readonly workloadIdentityToken?: string) {}

  withAccessToken<TInput, TResult>(
    config: ToolAccessTokenConfig,
    fn: (input: TInput, accessToken: string) => Promise<TResult>
  ): (input: TInput) => Promise<TResult> {
    return withAccessToken({
      ...config,
      scopes: [...config.scopes],
      workloadIdentityToken: this.workloadIdentityToken,
    })(async (input: TInput, accessToken: string) => fn(input, accessToken));
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
