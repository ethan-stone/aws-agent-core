import {
  AfterInvocationEvent,
  type HookProvider,
  type HookRegistry,
  type Message,
  type MessageData,
} from "@strands-agents/sdk";
import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  ListEventsCommand,
  type PayloadType,
} from "@aws-sdk/client-bedrock-agentcore";

export class MemoryHook implements HookProvider {
  private client: BedrockAgentCoreClient;
  private memoryId: string;
  private sessionId: string = "";

  constructor(opts: {
    client: BedrockAgentCoreClient;
    memoryId: string;
  }) {
    this.client = opts.client;
    this.memoryId = opts.memoryId;
  }

  setSessionId(sessionId: string) {
    this.sessionId = sessionId;
  }

  async loadConversation(sessionId: string): Promise<MessageData[]> {
    const messages: MessageData[] = [];
    let nextToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListEventsCommand({
          memoryId: this.memoryId,
          sessionId,
          actorId: sessionId,
          includePayloads: true,
          nextToken,
        })
      );

      for (const event of response.events ?? []) {
        for (const item of event.payload ?? []) {
          if (!item.conversational) continue;
          const text =
            item.conversational.content &&
            "text" in item.conversational.content
              ? item.conversational.content.text
              : undefined;
          if (!text) continue;

          const role =
            item.conversational.role === "USER" ? "user" : "assistant";
          messages.push({ role, content: [{ text }] });
        }
      }

      nextToken = response.nextToken;
    } while (nextToken);

    // ListEvents returns reverse chronological order
    messages.reverse();
    return messages;
  }

  registerCallbacks(registry: HookRegistry): void {
    registry.addCallback(
      AfterInvocationEvent,
      this.onAfterInvocation.bind(this)
    );
  }

  private async onAfterInvocation(event: AfterInvocationEvent): Promise<void> {
    const messages: Message[] = event.agent.messages;
    if (messages.length === 0) return;

    const payload: PayloadType[] = messages
      .map((msg) => {
        const text = msg.content
          .filter((block): block is { type: "textBlock"; text: string } =>
            block.type === "textBlock"
          )
          .map((block) => block.text)
          .join("\n");

        if (!text) return null;

        return {
          conversational: {
            role: msg.role === "user" ? "USER" : "ASSISTANT",
            content: { text },
          },
        } as PayloadType;
      })
      .filter((item): item is PayloadType => item !== null);

    if (payload.length === 0) return;

    try {
      await this.client.send(
        new CreateEventCommand({
          memoryId: this.memoryId,
          actorId: this.sessionId,
          sessionId: this.sessionId,
          eventTimestamp: new Date(),
          payload,
        })
      );
      console.log(
        `Persisted ${payload.length} messages to memory (session: ${this.sessionId})`
      );
    } catch (error) {
      console.error("Failed to persist conversation to memory:", error);
    }
  }
}
