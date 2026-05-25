import {
  Agent,
  BedrockModel,
  SlidingWindowConversationManager,
} from "@strands-agents/sdk";
import {
  BedrockAgentCoreClient,
  GetWorkloadAccessTokenForUserIdCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { withAccessToken } from "bedrock-agentcore/identity";
import { z } from "zod";
import {
  getPulseForgeAgentConfig,
  getPulseForgeAgentToolAuthorizationGroups,
  getPulseForgeAgentToolDefinitions,
  pulseForgeAgentKindSchema,
} from "../../../shared/pulseforge-agent/src/index.js";
import type {
  AgentRuntimeInvocation,
  AgentRuntimeStreamEvent,
} from "../../../shared/pulseforge-domain/src/index.js";
import {
  createPulseForgeStrandsTools,
  type ToolAccessTokenConfig,
  type ToolCredentialProvider,
} from "../../../shared/pulseforge-tools/src/index.js";
import type { AgentMemoryProjection } from "./agent-memory-projection.js";
import type { RuntimeConfig } from "./runtime-config.js";

interface RuntimeSseChunk {
  event: string;
  data: unknown;
}

export const agentRuntimeRequestSchema = z.object({
  agentRunId: z.string(),
  prompt: z.string(),
  agentKind: pulseForgeAgentKindSchema.default("ops-copilot"),
  incidentId: z.string().optional(),
  deviceId: z.string().optional(),
  actorId: z.string().optional(),
  investigationContext:
    z.custom<AgentRuntimeInvocation["investigationContext"]>().optional(),
});

export async function* runInvalidAgentInvocation(
  error: z.ZodError
): AsyncGenerator<RuntimeSseChunk> {
  const issues = error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  console.warn("[agent] invalid invocation payload", { issues });
  yield toRuntimeSseChunk({
    event: "message",
    data: {
      text: `Invalid agent runtime payload: ${issues
        .map((issue) => `${issue.path || "<root>"} ${issue.message}`)
        .join("; ")}`,
    },
  });
  yield toRuntimeSseChunk({
    event: "summary",
    data: {
      title: "Invalid runtime payload",
      summary: "The runtime request did not match the expected agent invocation shape.",
      findings: issues.map((issue) => `${issue.path || "<root>"}: ${issue.message}`),
      recommendedActions: [
        "Invoke with agentRunId, prompt, agentKind, and optional domain context.",
      ],
    },
  });
}

export interface AgentRuntimeContext {
  sessionId: string;
  headers: Record<string, string>;
  workloadAccessToken?: string;
  oauth2CallbackUrl?: string;
}

export interface PulseForgeAgentInvocationDependencies {
  model: BedrockModel;
  runtimeConfig: RuntimeConfig;
  memoryProjection: AgentMemoryProjection;
  workloadTokenClient: BedrockAgentCoreClient;
}

export async function* runPulseForgeAgentInvocation(
  request: AgentRuntimeInvocation,
  context: AgentRuntimeContext,
  dependencies: PulseForgeAgentInvocationDependencies
): AsyncGenerator<RuntimeSseChunk> {
  const actorId = request.actorId ?? context.sessionId;
  const memory = await dependencies.memoryProjection.prepare({
    actorId,
    sessionId: context.sessionId,
  });
  const agentConfig = getPulseForgeAgentConfig(request.agentKind);
  const runtimeEvents = new AsyncEventQueue<AgentRuntimeStreamEvent>();
  const tools = await createAgentTools(request, context, dependencies, {
    onAuthorizationRequired: (details) => {
      runtimeEvents.push({ event: "auth_required", data: details });
    },
    onAuthorizationResolved: (details) => {
      runtimeEvents.push({
        event: "action_resolution",
        data: {
          requiredActionId: details.requiredActionId,
          outcome: "resolved",
          content: [
            {
              type: "text",
              text: `${details.providerName} authorization completed.`,
            },
          ],
          data: {
            providerName: details.providerName,
            scopes: details.scopes,
            agentRunId: details.agentRunId,
          },
        },
      });
    },
    onToolCallStarted: (details) => {
      runtimeEvents.push({
        event: "tool_call",
        data: {
          toolCallId: details.toolCallId,
          toolName: details.toolName,
          arguments: details.input,
          status: "pending",
        },
      });
    },
    onToolCallCompleted: (details) => {
      runtimeEvents.push({
        event: "tool_result",
        data: {
          toolCallId: details.toolCallId,
          toolName: details.toolName,
          content: details.output,
        },
      });
    },
    onToolCallFailed: (details) => {
      runtimeEvents.push({
        event: "tool_result",
        data: {
          toolCallId: details.toolCallId,
          toolName: details.toolName,
          content: details.error,
          isError: true,
        },
      });
    },
  });

  const agent = new Agent({
    model: dependencies.model,
    id: agentConfig.id,
    name: agentConfig.label,
    systemPrompt: agentConfig.systemPrompt,
    messages: memory.initialMessages,
    tools,
    conversationManager: new SlidingWindowConversationManager({
      windowSize: 40,
    }),
    plugins: memory.plugins,
  });

  const agentInvocation = (async (): Promise<AgentRuntimeStreamEvent[]> => {
    const result = await agent.invoke(buildAgentPrompt(request));
    const text = stripThinkingBlocks(String(result));

    console.info("[agent] invocation completed", {
      agentRunId: request.agentRunId,
      agentKind: request.agentKind,
      stopReason: result.stopReason,
    });

    return [
      { event: "message", data: { text } },
      {
        event: "summary",
        data: buildInvestigationSummary(agentConfig.label, text),
      },
    ];
  })();

  let finalEvents: AgentRuntimeStreamEvent[] | undefined;
  let invocationError: unknown;
  agentInvocation
    .then((events) => {
      finalEvents = events;
    })
    .catch((error) => {
      invocationError = error;
    })
    .finally(() => runtimeEvents.close());

  while (finalEvents === undefined && invocationError === undefined) {
    const event = await runtimeEvents.next();
    if (event) {
      yield toRuntimeSseChunk(event);
    }
  }

  await memory.persistMessages(agent.messages);

  if (invocationError) {
    throw invocationError;
  }

  for (const event of finalEvents ?? []) {
    yield toRuntimeSseChunk(event);
  }
}

function toRuntimeSseChunk(event: AgentRuntimeStreamEvent): RuntimeSseChunk {
  return {
    event: event.event,
    data: event.data,
  };
}

function buildAgentPrompt(request: AgentRuntimeInvocation): string {
  const contextLines = [
    `Agent kind: ${request.agentKind}`,
    `Agent run ID: ${request.agentRunId}`,
    request.incidentId ? `Incident ID: ${request.incidentId}` : null,
    request.deviceId ? `Device ID: ${request.deviceId}` : null,
    request.investigationContext
      ? `Backend investigation context:\n${JSON.stringify(request.investigationContext, null, 2)}`
      : null,
    "",
    request.prompt,
    "",
    "Return a concise operator-ready response. If an ID is provided, use the available tools to gather operational evidence before answering.",
  ].filter(Boolean);

  return contextLines.join("\n");
}

function buildInvestigationSummary(agentLabel: string, result: string) {
  return {
    title: `${agentLabel} summary`,
    summary: truncate(result, 220),
    findings: [],
    recommendedActions: [],
  };
}

async function createAgentTools(
  request: AgentRuntimeInvocation,
  context: AgentRuntimeContext,
  dependencies: PulseForgeAgentInvocationDependencies,
  options?: {
    onToolCallStarted?: (details: {
      toolCallId: string;
      toolName: string;
      input: unknown;
    }) => void | Promise<void>;
    onToolCallCompleted?: (details: {
      toolCallId: string;
      toolName: string;
      output: unknown;
    }) => void | Promise<void>;
    onToolCallFailed?: (details: {
      toolCallId: string;
      toolName: string;
      error: unknown;
    }) => void | Promise<void>;
    onAuthorizationRequired?: (details: {
      requiredActionId: string;
      providerName: string;
      providerDisplayName: string;
      authUrl: string;
      scopes: string[];
      agentRunId: string;
    }) => void | Promise<void>;
    onAuthorizationResolved?: (details: {
      requiredActionId: string;
      providerName: string;
      scopes: string[];
      agentRunId: string;
    }) => void | Promise<void>;
  }
) {
  if (!dependencies.runtimeConfig.tools.enabled) {
    return [];
  }

  const toolDefinitions = getPulseForgeAgentToolDefinitions(request.agentKind);
  if (toolDefinitions.length === 0) {
    return [];
  }

  const authorizationGroups = getPulseForgeAgentToolAuthorizationGroups(
    request.agentKind
  );
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
      : dependencies.runtimeConfig.tools.oauthCallbackUrl
        ? "env-fallback"
        : "missing",
  });

  const credentialProvider = await createToolCredentialProvider(
    request,
    context,
    dependencies
  );
  return createPulseForgeStrandsTools(toolDefinitions, {
    backendUrl: dependencies.runtimeConfig.tools.backendUrl,
    agentRunId: request.agentRunId,
    providers: {
      "pulseforge-backend": {
        providerName: dependencies.runtimeConfig.tools.providerName,
        resourceServerIdentifier:
          dependencies.runtimeConfig.tools.resourceServerIdentifier,
        oauthCallbackUrl:
          context.oauth2CallbackUrl ??
          dependencies.runtimeConfig.tools.oauthCallbackUrl,
        credentialProvider,
      },
    },
    getAuthorizationScopes: (provider) =>
      authorizationScopeByProviderKey.get(provider.key) ?? [],
    onToolCallStarted: options?.onToolCallStarted,
    onToolCallCompleted: options?.onToolCallCompleted,
    onToolCallFailed: options?.onToolCallFailed,
    onAuthorizationRequired: options?.onAuthorizationRequired,
    onAuthorizationResolved: options?.onAuthorizationResolved,
  });
}

async function createToolCredentialProvider(
  request: AgentRuntimeInvocation,
  context: AgentRuntimeContext,
  dependencies: PulseForgeAgentInvocationDependencies
): Promise<ToolCredentialProvider> {
  if (!dependencies.runtimeConfig.tools.enabled) {
    throw new Error("PulseForge tools are not configured.");
  }

  if (dependencies.runtimeConfig.tools.authMode === "agentcore-runtime") {
    return new AgentCoreIdentityCredentialProvider(context.workloadAccessToken);
  }

  const userId =
    context.headers["x-amzn-bedrock-agentcore-runtime-custom-user-id"] ??
    dependencies.runtimeConfig.tools.localUserId ??
    request.actorId;

  if (!userId) {
    throw new Error(
      "PULSEFORGE_TOOL_AUTH_MODE=local-user-id requires x-amzn-bedrock-agentcore-runtime-custom-user-id, PULSEFORGE_LOCAL_USER_ID, or actorId."
    );
  }

  const response = await dependencies.workloadTokenClient.send(
    new GetWorkloadAccessTokenForUserIdCommand({
      workloadName: dependencies.runtimeConfig.tools.workloadName,
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

function stripThinkingBlocks(value: string): string {
  return value
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<\/?thinking>/gi, "")
    .trim();
}
