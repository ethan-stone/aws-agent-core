import {
  BeforeModelCallEvent,
  TextBlock,
  type Plugin,
} from "@strands-agents/sdk";
import {
  BedrockAgentCoreClient,
  RetrieveMemoryRecordsCommand,
} from "@aws-sdk/client-bedrock-agentcore";

export type RetrievalConfig = {
  topK?: number;
  relevanceScore?: number;
  memoryStrategyId?: string;
};

export type RetrievalConfigMap = Record<string, RetrievalConfig>;

type AgentCoreLongTermMemoryPluginConfig = {
  client: BedrockAgentCoreClient;
  memoryId: string;
  actorId: string;
  sessionId: string;
  retrievalConfig?: RetrievalConfigMap;
  contextTag?: string;
};

export class AgentCoreLongTermMemoryPlugin implements Plugin {
  readonly name = "pulseforge:agentcore-long-term-memory";

  private readonly client: BedrockAgentCoreClient;
  private readonly memoryId: string;
  private readonly actorId: string;
  private readonly sessionId: string;
  private readonly retrievalConfig: RetrievalConfigMap;
  private readonly contextTag: string;
  private injectedContext = false;

  constructor(config: AgentCoreLongTermMemoryPluginConfig) {
    this.client = config.client;
    this.memoryId = config.memoryId;
    this.actorId = config.actorId;
    this.sessionId = config.sessionId;
    this.retrievalConfig = config.retrievalConfig ?? {};
    this.contextTag = config.contextTag ?? "agentcore-memory-context";
  }

  initAgent(agent: Parameters<Plugin["initAgent"]>[0]): void {
    agent.addHook(BeforeModelCallEvent, async (event) => {
      if (
        this.injectedContext ||
        Object.keys(this.retrievalConfig).length === 0 ||
        event.agent.cancelSignal.aborted
      ) {
        return;
      }

      const lastMessage = event.agent.messages.at(-1);
      if (!lastMessage || lastMessage.role !== "user") {
        return;
      }

      const userText = lastMessage.content
        .filter((block) => block.type === "textBlock")
        .map((block) => block.text)
        .join("\n")
        .trim();

      if (!userText) {
        return;
      }

      const contextItems = await this.retrieveLongTermContext(userText);
      if (contextItems.length === 0) {
        return;
      }

      lastMessage.content.unshift(
        new TextBlock(
          `<${this.contextTag}>${contextItems.join(
            "\n"
          )}</${this.contextTag}>`
        )
      );
      this.injectedContext = true;
    });
  }

  private async retrieveLongTermContext(query: string): Promise<string[]> {
    const contextItems: string[] = [];

    for (const [namespaceTemplate, config] of Object.entries(
      this.retrievalConfig
    )) {
      const namespace = namespaceTemplate
        .replaceAll("{actorId}", this.actorId)
        .replaceAll("{sessionId}", this.sessionId)
        .replaceAll("{memoryId}", this.memoryId);

      try {
        const response = await this.client.send(
          new RetrieveMemoryRecordsCommand({
            memoryId: this.memoryId,
            namespace,
            searchCriteria: {
              searchQuery: query,
              topK: config.topK ?? 5,
              ...(config.memoryStrategyId
                ? { memoryStrategyId: config.memoryStrategyId }
                : {}),
            },
          })
        );

        for (const record of response.memoryRecordSummaries ?? []) {
          if (
            typeof config.relevanceScore === "number" &&
            typeof record.score === "number" &&
            record.score < config.relevanceScore
          ) {
            continue;
          }

          const text =
            record.content && "text" in record.content
              ? record.content.text
              : undefined;

          if (text) {
            contextItems.push(text);
          }
        }
      } catch (error) {
        console.error(
          `Failed to retrieve long-term memories for namespace ${namespace}:`,
          error
        );
      }
    }

    return contextItems;
  }
}
