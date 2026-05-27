import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import {
  SessionManager,
  type Plugin,
  type SnapshotStorage,
} from "@strands-agents/sdk";
import {
  AgentCoreLongTermMemoryPlugin,
  type RetrievalConfigMap,
} from "./agentcore-long-term-memory-plugin.js";
import type { RuntimeConfig } from "./runtime-config.js";
import {
  AgentCoreSnapshotStorage,
  InMemorySnapshotStorage,
} from "./agentcore-snapshot-storage.js";

export interface AgentMemoryProjectionConfig {
  runtimeConfig: RuntimeConfig;
  memoryClient?: BedrockAgentCoreClient;
  localSnapshotStorage?: SnapshotStorage;
  longTermRetrievalConfig?: RetrievalConfigMap;
}

export interface PrepareAgentMemoryInput {
  actorId: string;
  sessionId: string;
}

export interface PreparedAgentMemory {
  plugins: Plugin[];
}

export class AgentMemoryProjection {
  private readonly runtimeConfig: RuntimeConfig;
  private readonly memoryClient?: BedrockAgentCoreClient;
  private readonly localSnapshotStorage: SnapshotStorage;
  private readonly longTermRetrievalConfig: RetrievalConfigMap;

  constructor(config: AgentMemoryProjectionConfig) {
    this.runtimeConfig = config.runtimeConfig;
    this.memoryClient = config.memoryClient;
    this.localSnapshotStorage =
      config.localSnapshotStorage ?? new InMemorySnapshotStorage();
    this.longTermRetrievalConfig =
      config.longTermRetrievalConfig ??
      getLongTermRetrievalConfig(this.runtimeConfig);
  }

  async prepare(input: PrepareAgentMemoryInput): Promise<PreparedAgentMemory> {
    return {
      plugins: [
        this.createSessionManager(input),
        ...this.createLongTermMemoryPlugins(input),
      ],
    };
  }

  private createSessionManager(input: PrepareAgentMemoryInput): SessionManager {
    return new SessionManager({
      sessionId: input.sessionId,
      saveLatestOn: "invocation",
      storage: {
        snapshot:
          this.runtimeConfig.memoryId && this.memoryClient
            ? new AgentCoreSnapshotStorage({
                client: this.memoryClient,
                memoryId: this.runtimeConfig.memoryId,
                actorId: input.actorId,
              })
            : this.localSnapshotStorage,
      },
    });
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
