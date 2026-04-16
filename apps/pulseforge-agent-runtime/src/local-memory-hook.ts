import {
  AfterInvocationEvent,
  type HookProvider,
  type HookRegistry,
  type Message,
  type MessageData,
} from "@strands-agents/sdk";

export class LocalMemoryHook implements HookProvider {
  private sessionId = "";
  private readonly conversations = new Map<string, MessageData[]>();

  setSessionId(sessionId: string) {
    this.sessionId = sessionId;
  }

  async loadConversation(sessionId: string): Promise<MessageData[]> {
    return this.conversations.get(sessionId) ?? [];
  }

  registerCallbacks(registry: HookRegistry): void {
    registry.addCallback(
      AfterInvocationEvent,
      this.onAfterInvocation.bind(this)
    );
  }

  private async onAfterInvocation(event: AfterInvocationEvent): Promise<void> {
    const messages = event.agent.messages;
    if (messages.length === 0 || !this.sessionId) {
      return;
    }

    const conversation = messages
      .map((message) => this.toMessageData(message))
      .filter((message): message is MessageData => message !== null);

    this.conversations.set(this.sessionId, conversation);
  }

  private toMessageData(message: Message): MessageData | null {
    const text = message.content
      .filter((block): block is { type: "textBlock"; text: string } =>
        block.type === "textBlock"
      )
      .map((block) => block.text)
      .join("\n");

    if (!text) {
      return null;
    }

    return {
      role: message.role,
      content: [{ text }],
    };
  }
}
