import test from "node:test";
import assert from "node:assert/strict";
import { Message } from "@strands-agents/sdk";
import {
  AgentMemoryProjection,
  getLongTermRetrievalConfig,
} from "./agent-memory-projection.js";
import type { RuntimeConfig } from "./runtime-config.js";
import type { ShortTermMemoryStore } from "./short-term-memory-store.js";

test("AgentMemoryProjection loads and persists local short-term memory", async () => {
  const store = new MockShortTermMemoryStore([
    Message.fromMessageData({
      role: "user",
      content: [{ text: "previous question" }],
    }),
  ]);
  const projection = new AgentMemoryProjection({
    runtimeConfig: createRuntimeConfig({ memoryId: undefined }),
    localShortTermMemoryStore: store,
  });

  const prepared = await projection.prepare({
    actorId: "user-123",
    sessionId: "session-123",
  });

  assert.equal(store.loadedSessionIds[0], "session-123");
  assert.equal(prepared.initialMessages.length, 1);
  assert.equal(prepared.plugins.length, 0);

  const nextMessages = [
    ...prepared.initialMessages,
    Message.fromMessageData({
      role: "assistant",
      content: [{ text: "fresh answer" }],
    }),
  ];
  await prepared.persistMessages(nextMessages);

  assert.equal(store.savedMessages.length, 2);
  assert.equal(store.savedSessionIds[0], "session-123");
});

test("AgentMemoryProjection creates long-term memory plugins when AgentCore memory is configured", async () => {
  const projection = new AgentMemoryProjection({
    runtimeConfig: createRuntimeConfig({ memoryId: "memory-123" }),
    memoryClient: { send: async () => ({}) } as never,
    localShortTermMemoryStore: new MockShortTermMemoryStore([]),
  });

  const prepared = await projection.prepare({
    actorId: "user-123",
    sessionId: "session-123",
  });

  assert.equal(prepared.plugins.length, 1);
});

test("AgentMemoryProjection skips long-term memory plugins when disabled", async () => {
  const projection = new AgentMemoryProjection({
    runtimeConfig: createRuntimeConfig({
      memoryId: "memory-123",
      longTermMemoryEnabled: false,
    }),
    memoryClient: { send: async () => ({}) } as never,
    localShortTermMemoryStore: new MockShortTermMemoryStore([]),
  });

  const prepared = await projection.prepare({
    actorId: "user-123",
    sessionId: "session-123",
  });

  assert.equal(prepared.plugins.length, 0);
});

test("getLongTermRetrievalConfig follows runtime config", () => {
  assert.deepEqual(
    getLongTermRetrievalConfig({ longTermMemoryEnabled: false }),
    {}
  );
  assert.deepEqual(
    Object.keys(getLongTermRetrievalConfig({ longTermMemoryEnabled: true })),
    ["/preferences/{actorId}/", "/facts/{actorId}/", "/summaries/{actorId}/{sessionId}/"]
  );
});

class MockShortTermMemoryStore implements ShortTermMemoryStore {
  readonly loadedSessionIds: string[] = [];
  readonly savedSessionIds: string[] = [];
  savedMessages: Message[] = [];

  constructor(private readonly messages: Message[]) {}

  async loadMessages(sessionId: string): Promise<Message[]> {
    this.loadedSessionIds.push(sessionId);
    return this.messages;
  }

  async saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    this.savedSessionIds.push(sessionId);
    this.savedMessages = messages;
  }
}

function createRuntimeConfig(options: {
  memoryId?: string;
  longTermMemoryEnabled?: boolean;
}): RuntimeConfig {
  return {
    runtimeEnv: "local",
    memoryId: options.memoryId,
    awsRegion: "us-east-1",
    longTermMemoryEnabled: options.longTermMemoryEnabled ?? true,
    longTermMemoryContextTag: "agentcore-memory-context",
    tools: {
      enabled: false,
      reason: "not needed in tests",
    },
  };
}
