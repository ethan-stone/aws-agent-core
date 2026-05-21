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
  type ToolAccessTokenConfig,
  type ToolCredentialProvider,
} from "../../../shared/pulseforge-tools/src/index.js";
import {
  getPulseForgeAgentConfig,
  getPulseForgeAgentToolAuthorizationGroups,
  getPulseForgeAgentToolDefinitions,
  pulseForgeAgentKindSchema,
} from "../../../shared/pulseforge-agent/src/index.js";
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
const agentRequestSchema = z.object({
  agentRunId: z.string(),
  prompt: z.string(),
  agentKind: pulseForgeAgentKindSchema.default("ops-copilot"),
  incidentId: z.string().optional(),
  deviceId: z.string().optional(),
  actorId: z.string().optional(),
});

type RuntimeStreamEvent =
  | { event: "auth_required"; data: AuthRequiredEventData }
  | { event: "message"; data: { text: unknown } }
  | { event: "summary"; data: ReturnType<typeof buildInvestigationSummary> };

type AuthRequiredEventData = {
  providerName: string;
  providerDisplayName: string;
  authUrl: string;
  scopes: string[];
  agentRunId: string;
};

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
      const agentConfig = getPulseForgeAgentConfig(request.agentKind);
      const authEvents = new AsyncEventQueue<RuntimeStreamEvent>();
      const tools = await createAgentTools(request, context, {
        onAuthorizationRequired: (details) => {
          authEvents.push({ event: "auth_required", data: details });
        },
      });

      const agent = new Agent({
        model: bedrockModel,
        id: agentConfig.id,
        name: agentConfig.label,
        systemPrompt: agentConfig.systemPrompt,
        messages: initialMessages,
        tools,
        conversationManager: new SlidingWindowConversationManager({
          windowSize: 40,
        }),
        plugins,
      });

      const agentInvocation = (async (): Promise<RuntimeStreamEvent[]> => {
        const enrichedPrompt = buildAgentPrompt(request);
        const result = await agent.invoke(enrichedPrompt);
        return [
          { event: "message", data: { text: result } },
          {
            event: "summary",
            data: buildInvestigationSummary(request, String(result)),
          },
        ];
      })();

      let finalEvents: RuntimeStreamEvent[] | undefined;
      let invocationError: unknown;
      agentInvocation
        .then((events) => {
          finalEvents = events;
        })
        .catch((error) => {
          invocationError = error;
        })
        .finally(() => authEvents.close());

      while (finalEvents === undefined && invocationError === undefined) {
        const event = await authEvents.next();
        if (event) {
          yield event;
        }
      }

      await persistSessionMessages(
        shortTermMemoryStore,
        context.sessionId,
        actorId,
        agent.messages
      );

      if (invocationError) {
        console.log(invocationError);
        return;
      }

      for (const event of finalEvents ?? []) {
        yield event;
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

function buildAgentPrompt(request: z.infer<typeof agentRequestSchema>): string {
  const contextLines = [
    `Agent kind: ${request.agentKind}`,
    `Agent run ID: ${request.agentRunId}`,
    request.incidentId ? `Incident ID: ${request.incidentId}` : null,
    request.deviceId ? `Device ID: ${request.deviceId}` : null,
    "",
    request.prompt,
    "",
    "Return a concise operator-ready response. If an ID is provided, use the available tools to gather operational evidence before answering.",
  ].filter(Boolean);

  return contextLines.join("\n");
}

function buildInvestigationSummary(
  request: z.infer<typeof agentRequestSchema>,
  result: string
) {
  return {
    title: `${getPulseForgeAgentConfig(request.agentKind).label} summary`,
    summary: truncate(result, 220),
    findings: [],
    recommendedActions: [],
  };
}

async function createAgentTools(
  request: z.infer<typeof agentRequestSchema>,
  context: {
    headers: Record<string, string>;
    workloadAccessToken?: string;
    oauth2CallbackUrl?: string;
  },
  options?: {
    onAuthorizationRequired?: (details: AuthRequiredEventData) => void | Promise<void>;
  }
) {
  if (!runtimeConfig.tools.enabled) {
    return [];
  }

  const toolDefinitions = getPulseForgeAgentToolDefinitions(request.agentKind);
  if (toolDefinitions.length === 0) {
    return [];
  }

  const authorizationGroups =
    getPulseForgeAgentToolAuthorizationGroups(request.agentKind);
  const authorizationScopeByProviderKey = new Map(
    authorizationGroups.map((group) => [group.provider.key, group.scopes])
  );
  console.info("[tools] wiring agent tools", {
    agentKind: request.agentKind,
    agentRunId: request.agentRunId,
    tools: toolDefinitions.map((definition) => definition.name),
    authorizationGroups: authorizationGroups.map((group) => ({
      providerKey: group.provider.key,
      providerDisplayName: group.provider.displayName,
      scopes: group.scopes,
      tools: group.tools,
    })),
    oauthCallbackUrlSource: context.oauth2CallbackUrl
      ? "runtime-context"
      : runtimeConfig.tools.oauthCallbackUrl
        ? "env-fallback"
        : "missing",
  });

  const credentialProvider = await createToolCredentialProvider(request, context);
  return createPulseForgeStrandsTools(toolDefinitions, {
    backendUrl: runtimeConfig.tools.backendUrl,
    agentRunId: request.agentRunId,
    providers: {
      "pulseforge-backend": {
        providerName: runtimeConfig.tools.providerName,
        resourceServerIdentifier: runtimeConfig.tools.resourceServerIdentifier,
        oauthCallbackUrl:
          context.oauth2CallbackUrl ?? runtimeConfig.tools.oauthCallbackUrl,
        credentialProvider,
      },
    },
    getAuthorizationScopes: (provider) =>
      authorizationScopeByProviderKey.get(provider.key) ?? [],
    onAuthorizationRequired: options?.onAuthorizationRequired,
  });
}

async function createToolCredentialProvider(
  request: z.infer<typeof agentRequestSchema>,
  context: {
    headers: Record<string, string>;
    workloadAccessToken?: string;
    oauth2CallbackUrl?: string;
  }
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
  constructor(private readonly workloadIdentityToken?: string) { }

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

class AsyncEventQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(item: T | null) => void> = [];
  private closed = false;

  push(item: T) {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }

    this.items.push(item);
  }

  next(): Promise<T | null> {
    const item = this.items.shift();
    if (item) {
      return Promise.resolve(item);
    }

    if (this.closed) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter(null);
    }
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
