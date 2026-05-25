import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import type { Message, Plugin } from "@strands-agents/sdk";
import {
  AgentCoreLongTermMemoryPlugin,
  type RetrievalConfigMap,
} from "./agentcore-long-term-memory-plugin.js";
import type { RuntimeConfig } from "./runtime-config.js";
import {
  AgentCoreEventSessionStore,
  InMemoryShortTermMemoryStore,
  type ShortTermMemoryStore,
} from "./short-term-memory-store.js";

export interface AgentMemoryProjectionConfig {
  runtimeConfig: RuntimeConfig;
  memoryClient?: BedrockAgentCoreClient;
  localShortTermMemoryStore?: ShortTermMemoryStore;
  longTermRetrievalConfig?: RetrievalConfigMap;
}

export interface PrepareAgentMemoryInput {
  actorId: string;
  sessionId: string;
}

export interface PreparedAgentMemory {
  initialMessages: Message[];
  plugins: Plugin[];
  persistMessages(messages: Message[]): Promise<void>;
}

export class AgentMemoryProjection {
  private readonly runtimeConfig: RuntimeConfig;
  private readonly memoryClient?: BedrockAgentCoreClient;
  private readonly localShortTermMemoryStore: ShortTermMemoryStore;
  private readonly longTermRetrievalConfig: RetrievalConfigMap;

  constructor(config: AgentMemoryProjectionConfig) {
    this.runtimeConfig = config.runtimeConfig;
    this.memoryClient = config.memoryClient;
    this.localShortTermMemoryStore =
      config.localShortTermMemoryStore ?? new InMemoryShortTermMemoryStore();
    this.longTermRetrievalConfig =
      config.longTermRetrievalConfig ??
      getLongTermRetrievalConfig(this.runtimeConfig);
  }

  async prepare(input: PrepareAgentMemoryInput): Promise<PreparedAgentMemory> {
    const shortTermMemoryStore = this.createShortTermMemoryStore(input.actorId);
    const initialMessages = await this.loadSessionMessages(
      shortTermMemoryStore,
      input
    );

    return {
      initialMessages,
      plugins: this.createLongTermMemoryPlugins(input),
      persistMessages: (messages) =>
        this.persistSessionMessages(shortTermMemoryStore, input, messages),
    };
  }

  private createShortTermMemoryStore(actorId: string): ShortTermMemoryStore {
    if (this.runtimeConfig.memoryId && this.memoryClient) {
      return new AgentCoreEventSessionStore({
        client: this.memoryClient,
        memoryId: this.runtimeConfig.memoryId,
        actorId,
      });
    }

    return this.localShortTermMemoryStore;
  }

  private createLongTermMemoryPlugins(input: PrepareAgentMemoryInput): Plugin[] {
    if (
      !this.runtimeConfig.longTermMemoryEnabled ||
      !this.runtimeConfig.memoryId ||
      !this.memoryClient
    ) {
      return [];
    }

    return [
      new AgentCoreLongTermMemoryPlugin({
        client: this.memoryClient,
        memoryId: this.runtimeConfig.memoryId,
        actorId: input.actorId,
        sessionId: input.sessionId,
        retrievalConfig: this.longTermRetrievalConfig,
        contextTag: this.runtimeConfig.longTermMemoryContextTag,
      }),
    ];
  }

  private async loadSessionMessages(
    store: ShortTermMemoryStore,
    input: PrepareAgentMemoryInput
  ): Promise<Message[]> {
    try {
      return await store.loadMessages(input.sessionId);
    } catch (error) {
      console.error("[memory] failed to load session messages", {
        sessionId: input.sessionId,
        actorId: input.actorId,
        error,
      });
      return [];
    }
  }

  private async persistSessionMessages(
    store: ShortTermMemoryStore,
    input: PrepareAgentMemoryInput,
    messages: Message[]
  ): Promise<void> {
    try {
      await store.saveMessages(input.sessionId, messages);
    } catch (error) {
      console.error("[memory] failed to persist session messages", {
        sessionId: input.sessionId,
        actorId: input.actorId,
        error,
      });
    }
  }
}

export function getLongTermRetrievalConfig(
  runtimeConfig: Pick<RuntimeConfig, "longTermMemoryEnabled">
): RetrievalConfigMap {
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
